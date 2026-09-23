import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { validatePdfFile, getPdfPageCountFromBuffer, renderPageToPng, extractPdfTextByPage } from '@/lib/pdf-render';
import { saveFile } from '@/lib/storage';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { extractLegendSymbolsFromPng, extractLegendSymbolsFromOcr, type ParsedSymbol } from '@/lib/legend-extract';
import { LegendSymbolSchema, validateTagPattern } from '@/lib/legend-schemas';
import { getAiConfig } from '@/lib/ai-config';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rl = checkRateLimit(`legend-upload:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many legend uploads. Try again later.' }, { status: 429, headers: rateLimitHeaders(rl) });
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const name = (form.get('name') as string) || file?.name?.replace(/\.pdf$/i, '') || 'Uploaded Legend';
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const v = validatePdfFile(file);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    await getPdfPageCountFromBuffer(buf);

    const legendId = uuidv4();
    await saveFile(`legend-${legendId}.pdf`, buf);
    await db.query("INSERT INTO legends (id, name, description, status) VALUES ($1,$2,$3,'DRAFT')", [legendId, name, `Imported from ${file.name}`]);

    // Per-page AI parse: Gemini vision (default) or DeepSeek OCR (text-only)
    // + reference crop per symbol for few-shot detection (Gemini vision path only)
    let draft: { asset_type: string; symbol_name: string | null }[] = [];
    try {
      const cfg = await getAiConfig();
      const useDeepSeek = cfg.provider === 'deepseek';
      const pageCount = await getPdfPageCountFromBuffer(buf);
      const { cropPageRegion } = await import('@/lib/image-crop');
      const { hashImage } = await import('@/lib/symbol-cache');

      // Pre-extract OCR text — needed for DeepSeek provider and as Gemini fallback
      let ocrPages: string[] = [];
      try {
        ocrPages = await extractPdfTextByPage(buf);
      } catch (e) {
        console.warn('[legend/upload] OCR extraction failed (non-fatal):', (e as Error).message?.slice(0, 200));
      }

      for (let page = 1; page <= pageCount; page++) {
        const pageOcr = ocrPages[page - 1] ?? '';

        // Declare page-level render state — used by ref crop section below
        let pngBase64: string | null = null;
        let pngW = 0;
        let pngH = 0;

        let symbols: ParsedSymbol[];

        if (useDeepSeek) {
          // DeepSeek: text-only via OCR — no image understanding
          if (!pageOcr.trim()) {
            console.warn(`[legend/upload] page ${page} skipped — DeepSeek requires OCR text but none available`);
            continue;
          }
          try {
            symbols = await extractLegendSymbolsFromOcr(pageOcr, page);
          } catch (e) {
            console.warn(`[legend/upload] page ${page} DeepSeek OCR failed:`, (e as Error).message?.slice(0, 300));
            continue;
          }
        } else {
          // Gemini: vision-first, OCR text fallback
          try {
            const rendered = await renderPageToPng(buf, page, 4.0);
            pngW = rendered.width;
            pngH = rendered.height;
            pngBase64 = rendered.png.toString('base64');
          } catch (e) {
            console.warn(`[legend/upload] page ${page} render failed:`, (e as Error).message?.slice(0, 200));
          }

          if (pngBase64) {
            try {
              symbols = await extractLegendSymbolsFromPng(pngBase64, page);
            } catch (e) {
              console.warn(`[legend/upload] page ${page} Gemini vision failed, trying OCR fallback:`, (e as Error).message?.slice(0, 300));
              pngBase64 = null; pngW = 0; pngH = 0; // no ref crop if vision failed
              if (pageOcr.trim()) {
                try {
                  symbols = await extractLegendSymbolsFromOcr(pageOcr, page);
                } catch (e2) {
                  console.warn(`[legend/upload] page ${page} OCR fallback also failed:`, (e2 as Error).message?.slice(0, 200));
                  continue;
                }
              } else {
                continue;
              }
            }
          } else if (pageOcr.trim()) {
            // Render failed — try OCR fallback
            try {
              symbols = await extractLegendSymbolsFromOcr(pageOcr, page);
            } catch (e) {
              console.warn(`[legend/upload] page ${page} OCR fallback failed:`, (e as Error).message?.slice(0, 200));
              continue;
            }
          } else {
            console.warn(`[legend/upload] page ${page} skipped — render failed and no OCR text`);
            continue;
          }
        }

        for (const s of symbols) {
          // Schema + tag_pattern validation before INSERT
          const parsed = LegendSymbolSchema.safeParse({
            asset_type: s.asset_type.slice(0, 120),
            symbol_name: s.symbol_name,
            tag_pattern: s.tag_pattern,
            description: s.description,
            aliases: s.aliases ?? [],
            status: 'DRAFT',
            bbox_x: s.bbox_x, bbox_y: s.bbox_y, bbox_w: s.bbox_w, bbox_h: s.bbox_h,
            pid_page: page,
          });
          if (!parsed.success) {
            console.warn(`[legend/upload] page ${page} symbol skipped (schema):`, JSON.stringify(parsed.error.flatten()).slice(0, 200));
            continue;
          }
          const patternErr = validateTagPattern(parsed.data.tag_pattern);
          const safePattern = patternErr ? null : parsed.data.tag_pattern;
          if (patternErr) {
            console.warn(`[legend/upload] page ${page} invalid tag_pattern "${s.tag_pattern}" → nulled (${patternErr})`);
          }

          // Reference crop: cut symbol from page PNG for few-shot detection.
          // Best-effort — crop failure does not block insert.
          // Only available when pngBase64 is set (Gemini vision path).
          let refUrl: string | null = null;
          let refHash: string | null = null;
          try {
            if (pngBase64 && s.bbox_x != null && s.bbox_y != null && s.bbox_w != null && s.bbox_h != null && pngW > 0) {
              const cropB64 = await cropPageRegion(
                pngBase64,
                { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
                pngW, pngH, 0.05,
              );
              if (cropB64) {
                refHash = hashImage(cropB64);
                const refName = `legend-${legendId}-p${page}-${refHash.slice(0, 12)}.png`;
                await saveFile(refName, Buffer.from(cropB64, 'base64'));
                refUrl = refName;
              }
            }
          } catch (cropErr) {
            console.warn(`[legend/upload] page ${page} ref crop failed (non-fatal):`, (cropErr as Error).message?.slice(0, 150));
          }

          await db.query(
            `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status, reference_image_url, reference_crop_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT',$13,$14)`,
            [uuidv4(), legendId, parsed.data.asset_type, parsed.data.symbol_name, safePattern, parsed.data.description, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page, parsed.data.aliases, refUrl, refHash],
          );
        }
        draft.push(...symbols.map(s => ({ asset_type: s.asset_type, symbol_name: s.symbol_name })));
      }
    } catch (e: unknown) {
      console.warn('[legend/upload] AI parse failed:', (e instanceof Error ? e.message : String(e)).slice(0, 300));
    }

    return NextResponse.json({ id: legendId, name, symbols: draft }, { status: 201, headers: rateLimitHeaders(rl) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend/upload]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
