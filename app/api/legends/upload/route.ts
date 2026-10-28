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

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const maxUploads = 10;
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
    const pageCount = await getPdfPageCountFromBuffer(buf);
    if (pageCount !== 1) {
      return NextResponse.json(
        {
          error: `Dokumen Legend harus tepat 1 halaman. File yang diunggah memiliki ${pageCount} halaman. Harap pisahkan halaman legend terlebih dahulu sebelum diunggah.`,
        },
        { status: 400 }
      );
    }

    const legendId = uuidv4();
    await saveFile(`legend-${legendId}.pdf`, buf);
    await db.query("INSERT INTO legends (id, name, description, status) VALUES ($1,$2,$3,'DRAFT')", [legendId, name, `Imported from ${file.name}`]);

    const isStream = request.nextUrl.searchParams.get('stream') === 'true' || request.headers.get('accept')?.includes('text/event-stream');

    if (isStream) {
      const encoder = new TextEncoder();
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      const send = async (data: Record<string, unknown>) => {
        try {
          await writer.write(encoder.encode(JSON.stringify(data) + '\n'));
        } catch {}
      };

      (async () => {
        try {
          await send({ stage: 'render', pct: 20, message: 'Rendering halaman legend ke resolusi tinggi...' });
          const rendered = await renderPageToPng(buf, 1, 2.0);
          const pngW = rendered.width;
          const pngH = rendered.height;
          const pngBase64 = rendered.png.toString('base64');

          await send({ stage: 'ai', pct: 35, message: 'Menganalisis simbol dengan AI vision...' });
          const r = await extractLegendSymbolsRobust(
            pngBase64,
            1,
            async (b64, box) => cropPageRegion(b64, box, pngW, pngH, 0) ?? null
          );
          const symbols = r.symbols;

          await send({ stage: 'crop', pct: 85, message: `Memotong & mengekstrak ${symbols.length} simbol referensi...` });
          const BATCH_SIZE = 5;
          const draft: { asset_type: string; symbol_name: string | null }[] = [];

          for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
            const batch = symbols.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map(async (s) => {
                const parsed = LegendSymbolSchema.safeParse({
                  asset_type: s.asset_type.slice(0, 120),
                  symbol_name: s.symbol_name,
                  tag_pattern: s.tag_pattern,
                  description: s.description,
                  aliases: s.aliases ?? [],
                  status: 'DRAFT',
                  bbox_x: s.bbox_x, bbox_y: s.bbox_y, bbox_w: s.bbox_w, bbox_h: s.bbox_h,
                  pid_page: 1,
                });
                if (!parsed.success) return;
                const patternErr = validateTagPattern(parsed.data.tag_pattern);
                const safePattern = patternErr ? null : parsed.data.tag_pattern;

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
                      const refName = `legend-${legendId}-p1-${refHash.slice(0, 12)}.png`;
                      await saveFile(refName, Buffer.from(cropB64, 'base64'));
                      refUrl = refName;
                    }
                  }
                } catch {}

                await db.query(
                  `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status, reference_image_url, reference_crop_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT',$13,$14)`,
                  [uuidv4(), legendId, parsed.data.asset_type, parsed.data.symbol_name, safePattern, parsed.data.description, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, 1, parsed.data.aliases, refUrl, refHash],
                );
              })
            );
            draft.push(...batch.map(s => ({ asset_type: s.asset_type, symbol_name: s.symbol_name })));
          }

          await send({
            stage: 'done',
            pct: 100,
            message: `Scan selesai! ${symbols.length} simbol diekstrak.`,
            result: { id: legendId, name, symbols: draft },
          });
        } catch (streamErr) {
          const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          console.error('[legend/upload] stream error:', msg);
          await send({ stage: 'error', error: msg });
        } finally {
          try { await writer.close(); } catch {}
        }
      })();

      return new Response(stream.readable, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // Non-streaming fallback
    let draft: { asset_type: string; symbol_name: string | null }[] = [];
    try {
      const rendered = await renderPageToPng(buf, 1, 2.0);
      const pngW = rendered.width;
      const pngH = rendered.height;
      const pngBase64 = rendered.png.toString('base64');

      const r = await extractLegendSymbolsRobust(
        pngBase64,
        1,
        async (b64, box) => cropPageRegion(b64, box, pngW, pngH, 0) ?? null
      );
      const symbols = r.symbols;
      const BATCH_SIZE = 5;
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (s) => {
            const parsed = LegendSymbolSchema.safeParse({
              asset_type: s.asset_type.slice(0, 120),
              symbol_name: s.symbol_name,
              tag_pattern: s.tag_pattern,
              description: s.description,
              aliases: s.aliases ?? [],
              status: 'DRAFT',
              bbox_x: s.bbox_x, bbox_y: s.bbox_y, bbox_w: s.bbox_w, bbox_h: s.bbox_h,
              pid_page: 1,
            });
            if (!parsed.success) return;
            const patternErr = validateTagPattern(parsed.data.tag_pattern);
            const safePattern = patternErr ? null : parsed.data.tag_pattern;

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
                  const refName = `legend-${legendId}-p1-${refHash.slice(0, 12)}.png`;
                  await saveFile(refName, Buffer.from(cropB64, 'base64'));
                  refUrl = refName;
                }
              }
            } catch {}

            await db.query(
              `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status, reference_image_url, reference_crop_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT',$13,$14)`,
              [uuidv4(), legendId, parsed.data.asset_type, parsed.data.symbol_name, safePattern, parsed.data.description, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, 1, parsed.data.aliases, refUrl, refHash],
            );
          })
        );
      }
      draft.push(...symbols.map(s => ({ asset_type: s.asset_type, symbol_name: s.symbol_name })));
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
