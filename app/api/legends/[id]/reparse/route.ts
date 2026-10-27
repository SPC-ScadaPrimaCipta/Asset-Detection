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

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const legCheck = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (legCheck.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });

    let buf: Buffer;
    try {
      buf = (await getFile(`legend-${id}.pdf`)) as unknown as Buffer;
    } catch {
      return NextResponse.json({ error: 'Legend PDF not found in storage. Re-upload to re-parse.' }, { status: 404 });
    }

    const pageCount = await getPdfPageCountFromBuffer(buf);
    if (pageCount !== 1) {
      return NextResponse.json(
        { error: `Dokumen Legend harus tepat 1 halaman. Dokumen memiliki ${pageCount} halaman.` },
        { status: 400 }
      );
    }

    const diagnostics: { page: number; detected: number; refined: number; error?: string }[] = [];
    const page = 1;

    let pngBuffer: Buffer;
    let pngBase64: string;
    let pngW = 0;
    let pngH = 0;

    try {
      console.log(`[legend/reparse] rendering page ${page} (scale ${RENDER_SCALE})...`);
      const rendered = await renderPageToPng(buf, page, RENDER_SCALE);
      pngBuffer = rendered.png;
      pngBase64 = pngBuffer.toString('base64');
      pngW = rendered.width;
      pngH = rendered.height;
      console.log(`[legend/reparse] page ${page} render OK: ${pngW}x${pngH}, ${pngBuffer.length} bytes`);
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      return NextResponse.json({ error: `Render failed: ${msg}` }, { status: 500 });
    }

    console.log(`[legend/reparse] running symbol extraction for legend ${id}...`);
    const rawSymbols = await extractLegendSymbolsFromPng(pngBase64, page, pngBuffer);
    const refinedCount = rawSymbols.filter((s) => s.bbox_x !== null).length;
    diagnostics.push({ page, detected: rawSymbols.length, refined: refinedCount });
    console.log(`[legend/reparse] extracted ${rawSymbols.length} symbols (${refinedCount} with bbox)`);

    // Generate crops in parallel batches of 5
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

    // Atomic Database Transaction: replace symbols safely without FK violation
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Verify legend exists under row lock
      const verify = await client.query('SELECT id FROM legends WHERE id=$1 FOR UPDATE', [id]);
      if (verify.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Legend record not found during transaction' }, { status: 404 });
      }

      // Delete existing symbols atomically
      await client.query('DELETE FROM legend_symbols WHERE legend_id=$1', [id]);

      // Insert fresh symbols
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

      // Update legend updated_at timestamp
      await client.query('UPDATE legends SET updated_at=NOW() WHERE id=$1', [id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    console.log(`[legend/reparse] successfully committed ${itemsToInsert.length} symbols for legend ${id}`);
    return NextResponse.json({ inserted: itemsToInsert.length, pages: 1, diagnostics });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[legend/reparse] error: ${msg}`);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 500) }, { status: 500 });
  }
}
