import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { validatePdfFile, getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { saveFile } from '@/lib/storage';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { extractLegendSymbolsRobust } from '@/lib/legend-extract';
import { cropPageRegion } from '@/lib/image-crop';
import { createHash } from 'crypto';
import { LegendSymbolSchema, validateTagPattern } from '@/lib/legend-schemas';
import { cropAndSaveSymbol } from '@/lib/legend-crop';
import { getTuning } from '@/lib/tuning';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const maxUploads = (await getTuning()).performance.rateLimitLegendUploads;
    const rl = checkRateLimit(`legend-upload:${ip}`, maxUploads, 60_000);
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

    // Per-page high-res render ΓåÆ Gemini vision (same as reparse)
    // Phase 1: scale 4.0 (samakan dengan detection) + validasi tag_pattern
    // + simpan reference crop per simbol untuk few-shot detection.
    let draft: { asset_type: string; symbol_name: string | null }[] = [];
    try {
      const pageCount = await getPdfPageCountFromBuffer(buf);
      for (let page = 1; page <= pageCount; page++) {
        let pngBase64: string;
        let pngW = 0;
        let pngH = 0;
        try {
          const rendered = await renderPageToPng(buf, page, 2.0);
          pngW = rendered.width;
          pngH = rendered.height;
          pngBase64 = rendered.png.toString('base64');
        } catch (e) {
          console.warn(`[legend/upload] page ${page} render failed:`, (e as Error).message?.slice(0, 200));
          continue;
        }
        let symbols: Awaited<ReturnType<typeof extractLegendSymbolsRobust>>['symbols'];
        try {
          // Robust path: full page first, automatic 2-column chunk fallback
          // when the page truncates, returns empty, or errors.
          const r = await extractLegendSymbolsRobust(
            pngBase64,
            page,
            async (b64, box) =>
              cropPageRegion(b64, box, pngW, pngH, 0) ?? null
          );
          symbols = r.symbols;
          if (r.strategy === 'chunked') {
            console.log(`[legend/upload] page ${page} used chunked fallback: ${symbols.length} symbols`);
          }
        } catch (e) {
          console.warn(`[legend/upload] page ${page} AI failed:`, (e as Error).message?.slice(0, 300));
          continue;
        }
        for (const s of symbols) {
          // Validasi schema + tag_pattern sebelum INSERT (cegah pattern salah ketik)
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
            console.warn(`[legend/upload] page ${page} invalid tag_pattern "${s.tag_pattern}" ΓåÆ nulled (${patternErr})`);
          }
          // Reference crop: potong simbol dari page PNG untuk few-shot detection.
let refUrl: string | null = null;
          let refHash: string | null = null;
          try {
            if (s.bbox_x != null && s.bbox_y != null && s.bbox_w != null && s.bbox_h != null && pngW > 0) {
              const cropB64 = await cropPageRegion(
                pngBase64,
                { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
                pngW, pngH, 0.05,
              );
              if (cropB64) {
                refHash = createHash('sha256').update(cropB64).digest('hex');
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
