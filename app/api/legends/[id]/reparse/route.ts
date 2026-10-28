import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { extractLegendSymbolsFromPng } from '@/lib/legend-extract';
import { cropAndSaveSymbol } from '@/lib/legend-crop';

export const maxDuration = 300;

// Scale 2.0 = ~144-180 DPI — tajam untuk legend dan jauh lebih cepat dirender/diproses.
const RENDER_SCALE = 2.0;

async function resolveLegendPdf(id: string, description?: string): Promise<Buffer | null> {
  try {
    return (await getFile(`legend-${id}.pdf`)) as unknown as Buffer;
  } catch {
    if (description) {
      const m = description.match(/^Imported from (.+)$/);
      if (m) {
        const safe = m[1].replace(/[^a-zA-Z0-9._-]/g, '_');
        try {
          return (await getFile(`legend-${safe}`)) as unknown as Buffer;
        } catch {}
      }
    }
    return null;
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const legCheck = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (legCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Legend not found' }, { status: 404 });
    }

    const buf = await resolveLegendPdf(id, legCheck.rows[0]?.description);
    if (!buf) {
      return NextResponse.json(
        { error: 'Legend PDF not found in storage. Re-upload to re-parse.' },
        { status: 404 }
      );
    }

    const isStream =
      _req.nextUrl.searchParams.get('stream') === 'true' ||
      _req.headers.get('accept')?.includes('text/event-stream');

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
          await send({ stage: 'start', pct: 5, message: 'Memulai proses Re-parse...' });

          const pageCount = await getPdfPageCountFromBuffer(buf);
          if (pageCount !== 1) {
            await send({
              stage: 'error',
              error: `Dokumen Legend harus tepat 1 halaman. Dokumen memiliki ${pageCount} halaman.`,
            });
            return;
          }

          const page = 1;
          await send({ stage: 'render', pct: 15, message: 'Rendering halaman legend ke resolusi tinggi...' });
          const rendered = await renderPageToPng(buf, page, RENDER_SCALE);
          const pngBuffer = rendered.png;
          const pngBase64 = pngBuffer.toString('base64');
          const pngW = rendered.width;
          const pngH = rendered.height;

          await send({ stage: 'ai', pct: 25, message: 'Menganalisis simbol dengan AI vision...' });
          const rawSymbols = await extractLegendSymbolsFromPng(
            pngBase64,
            page,
            pngBuffer,
            async (info) => {
              await send({ stage: info.stage, pct: info.pct ?? 50, message: info.message });
            }
          );

          await send({
            stage: 'crop',
            pct: 85,
            message: `Memotong & mengekstrak ${rawSymbols.length} simbol referensi...`,
          });

          const BATCH_SIZE = 5;
          const itemsToInsert: Array<{
            id: string;
            asset_type: string;
            symbol_name: string | null;
            tag_pattern: string | null;
            description: string | null;
            aliases: string[];
            bbox_x: number | null;
            bbox_y: number | null;
            bbox_w: number | null;
            bbox_h: number | null;
            pid_page: number;
            refUrl: string | null;
            refHash: string | null;
          }> = [];

          for (let i = 0; i < rawSymbols.length; i += BATCH_SIZE) {
            const batch = rawSymbols.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
              batch.map(async (s) => {
                const { refUrl, refHash } = await cropAndSaveSymbol(
                  pngBase64,
                  { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
                  pngW,
                  pngH,
                  id,
                  page,
                  0.05
                );
                return {
                  id: uuidv4(),
                  asset_type: s.asset_type.slice(0, 120),
                  symbol_name: s.symbol_name,
                  tag_pattern: s.tag_pattern,
                  description: s.description,
                  aliases: s.aliases ?? [],
                  bbox_x: s.bbox_x,
                  bbox_y: s.bbox_y,
                  bbox_w: s.bbox_w,
                  bbox_h: s.bbox_h,
                  pid_page: page,
                  refUrl,
                  refHash,
                };
              })
            );
            itemsToInsert.push(...batchResults);
          }

          await send({
            stage: 'save',
            pct: 95,
            message: `Menyimpan ${itemsToInsert.length} simbol ke database...`,
          });

          const client = await db.connect();
          try {
            await client.query('BEGIN');
            const verify = await client.query('SELECT id FROM legends WHERE id=$1 FOR UPDATE', [id]);
            if (verify.rows.length === 0) {
              await client.query('ROLLBACK');
              await send({ stage: 'error', error: 'Legend record not found during transaction' });
              return;
            }

            await client.query('DELETE FROM legend_symbols WHERE legend_id=$1', [id]);

            for (const item of itemsToInsert) {
              await client.query(
                `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14)`,
                [
                  item.id,
                  id,
                  item.asset_type,
                  item.symbol_name,
                  item.tag_pattern,
                  item.description,
                  item.aliases,
                  item.bbox_x,
                  item.bbox_y,
                  item.bbox_w,
                  item.bbox_h,
                  item.pid_page,
                  item.refUrl,
                  item.refHash,
                ]
              );
            }

            await client.query('UPDATE legends SET updated_at=NOW() WHERE id=$1', [id]);
            await client.query('COMMIT');
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }

          await send({
            stage: 'done',
            pct: 100,
            message: `Re-parse selesai! ${itemsToInsert.length} simbol berhasil diekstrak.`,
            result: { inserted: itemsToInsert.length },
          });
        } catch (streamErr) {
          const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          console.error(`[legend/reparse] stream error: ${msg}`);
          await send({ stage: 'error', error: msg });
        } finally {
          try {
            await writer.close();
          } catch {}
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
    const pageCount = await getPdfPageCountFromBuffer(buf);
    if (pageCount !== 1) {
      return NextResponse.json(
        { error: `Dokumen Legend harus tepat 1 halaman. Dokumen memiliki ${pageCount} halaman.` },
        { status: 400 }
      );
    }

    const page = 1;
    const rendered = await renderPageToPng(buf, page, RENDER_SCALE);
    const pngBuffer = rendered.png;
    const pngBase64 = pngBuffer.toString('base64');
    const pngW = rendered.width;
    const pngH = rendered.height;

    const rawSymbols = await extractLegendSymbolsFromPng(pngBase64, page, pngBuffer);
    const BATCH_SIZE = 5;
    const itemsToInsert: Array<{
      id: string;
      asset_type: string;
      symbol_name: string | null;
      tag_pattern: string | null;
      description: string | null;
      aliases: string[];
      bbox_x: number | null;
      bbox_y: number | null;
      bbox_w: number | null;
      bbox_h: number | null;
      pid_page: number;
      refUrl: string | null;
      refHash: string | null;
    }> = [];

    for (let i = 0; i < rawSymbols.length; i += BATCH_SIZE) {
      const batch = rawSymbols.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (s) => {
          const { refUrl, refHash } = await cropAndSaveSymbol(
            pngBase64,
            { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
            pngW,
            pngH,
            id,
            page,
            0.05
          );
          return {
            id: uuidv4(),
            asset_type: s.asset_type.slice(0, 120),
            symbol_name: s.symbol_name,
            tag_pattern: s.tag_pattern,
            description: s.description,
            aliases: s.aliases ?? [],
            bbox_x: s.bbox_x,
            bbox_y: s.bbox_y,
            bbox_w: s.bbox_w,
            bbox_h: s.bbox_h,
            pid_page: page,
            refUrl,
            refHash,
          };
        })
      );
      itemsToInsert.push(...batchResults);
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const verify = await client.query('SELECT id FROM legends WHERE id=$1 FOR UPDATE', [id]);
      if (verify.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Legend record not found during transaction' }, { status: 404 });
      }

      await client.query('DELETE FROM legend_symbols WHERE legend_id=$1', [id]);

      for (const item of itemsToInsert) {
        await client.query(
          `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14)`,
          [
            item.id,
            id,
            item.asset_type,
            item.symbol_name,
            item.tag_pattern,
            item.description,
            item.aliases,
            item.bbox_x,
            item.bbox_y,
            item.bbox_w,
            item.bbox_h,
            item.pid_page,
            item.refUrl,
            item.refHash,
          ]
        );
      }

      await client.query('UPDATE legends SET updated_at=NOW() WHERE id=$1', [id]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    return NextResponse.json({ inserted: itemsToInsert.length, pages: 1 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[legend/reparse] error: ${msg}`);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 500) }, { status: 500 });
  }
}
