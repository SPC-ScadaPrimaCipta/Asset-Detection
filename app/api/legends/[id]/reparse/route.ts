import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { extractLegendSymbolsFromPng } from '@/lib/legend-extract';
import { cropAndSaveSymbol } from '@/lib/legend-crop';

export const maxDuration = 300;

// Scale 3.0 = ~216 DPI — lebih detail untuk legend dengan simbol kecil.
const RENDER_SCALE = 3.0;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const leg = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (leg.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });

    let buf: Buffer;
    try { buf = await getFile(`legend-${id}.pdf`) as unknown as Buffer; }
    catch { return NextResponse.json({ error: 'Legend PDF not found in storage. Re-upload to re-parse.' }, { status: 404 }); }

    const pageCount = await getPdfPageCountFromBuffer(buf);

    // Delete ALL existing symbols (DRAFT + ACTIVE) — reparse is a full replacement.
    await db.query('DELETE FROM legend_symbols WHERE legend_id=$1', [id]);

    let totalInserted = 0;
    const diagnostics: { page: number; detected: number; refined: number; error?: string }[] = [];

    for (let page = 1; page <= pageCount; page++) {
      let pngBuffer: Buffer;
      let pngBase64: string;
      let pngW = 0;
      let pngH = 0;
      try {
console.log(`[legend/reparse] page ${page} rendering...`);
        const rendered = await renderPageToPng(buf, page, RENDER_SCALE);
        const { png } = rendered;
        pngBuffer = png;
        pngBase64 = png.toString('base64');
        pngW = rendered.width;
        pngH = rendered.height;
        console.log(`[legend/reparse] page ${page} render OK, png size: ${png.length} bytes`);
      } catch (e: unknown) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        diagnostics.push({ page, detected: 0, refined: 0, error: `render: ${msg}` });
        continue;
      }

      try {
        console.log(`[legend/reparse] page ${page} running two-pass extraction...`);
        // Pass pngBuffer for two-pass refinement
        const symbols = await extractLegendSymbolsFromPng(pngBase64, page, pngBuffer);
        const refinedCount = symbols.filter(s => s.bbox_x !== null).length;
        diagnostics.push({ page, detected: symbols.length, refined: refinedCount });
        console.log(`[legend/reparse] page ${page}: ${symbols.length} symbols, ${refinedCount} with bbox`);

        for (const s of symbols) {
          // Reference crops — same shared helper as upload (Stage 3.5 fix:
          // reparse previously skipped crops entirely, producing cropless rows).
          const { refUrl, refHash } = await cropAndSaveSymbol(
            pngBase64,
            { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
            pngW, pngH, id, page, 0.05
          );
          await db.query(
`INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash)\n             VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14)`,\n            [uuidv4(), id, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.aliases ?? [], s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page, refUrl, refHash],
          );
          totalInserted++;
        }
      } catch (e: unknown) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        console.error(`[legend/reparse] page ${page} FAILED: ${msg}`);
        diagnostics.push({ page, detected: 0, refined: 0, error: msg });
      }
    }

    return NextResponse.json({ inserted: totalInserted, pages: pageCount, diagnostics });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 500) }, { status: 500 });
  }
}
