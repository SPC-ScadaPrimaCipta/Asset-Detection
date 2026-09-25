import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { extractLegendSymbolsFromPng } from '@/lib/legend-extract';
import { cropAndSaveSymbol } from '@/lib/legend-crop';

export const maxDuration = 60;
const RENDER_SCALE = 3.5;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const leg = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (leg.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });

    let buf: Buffer;
    try { buf = await getFile(`legend-${id}.pdf`) as unknown as Buffer; }
    catch { return NextResponse.json({ error: 'Legend PDF not found in storage. Re-upload to re-parse.' }, { status: 404 }); }

    const pageCount = await getPdfPageCountFromBuffer(buf);
    await db.query("DELETE FROM legend_symbols WHERE legend_id=$1 AND status='DRAFT'", [id]);

    let totalInserted = 0;
    const diagnostics: { page: number; detected: number; error?: string }[] = [];

    for (let page = 1; page <= pageCount; page++) {
      let pngBase64: string;
      let pngW = 0;
      let pngH = 0;
      try {
        const rendered = await renderPageToPng(buf, page, RENDER_SCALE);
        pngBase64 = rendered.png.toString('base64');
        pngW = rendered.width;
        pngH = rendered.height;
      } catch (e: unknown) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        diagnostics.push({ page, detected: 0, error: `render: ${msg}` });
        continue;
      }
      try {
        const symbols = await extractLegendSymbolsFromPng(pngBase64, page);
        diagnostics.push({ page, detected: symbols.length });
        for (const s of symbols) {
          // Reference crops — same shared helper as upload (Stage 3.5 fix:
          // reparse previously skipped crops entirely, producing cropless rows).
          const { refUrl, refHash } = await cropAndSaveSymbol(
            pngBase64,
            { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
            pngW, pngH, id, page, 0.05
          );
          await db.query(
            `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14)`,
            [uuidv4(), id, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.aliases, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page, refUrl, refHash],
          );
          totalInserted++;
        }
      } catch (e: unknown) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        diagnostics.push({ page, detected: 0, error: msg.slice(0, 300) });
      }
    }

    return NextResponse.json({ inserted: totalInserted, pages: pageCount, diagnostics });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 500) }, { status: 500 });
  }
}
