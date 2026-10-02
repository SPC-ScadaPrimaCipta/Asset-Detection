import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { deleteFile, getFile, saveFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import { cropPageRegion } from '@/lib/image-crop';
import { hashImage } from '@/lib/symbol-cache';

/**
 * POST /api/legends/[id]/symbols/[symbolId]/recrop — replace reference crop.
 *
 * Body: { bbox_x, bbox_y, bbox_w, bbox_h } in 0–1000 page space.
 * Renders the legend PDF page server-side, replaces the stored crop, and
 * updates the existing legend_symbols row in place.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id: legendId, symbolId } = await params;
  try {
    const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]).catch(() => ({ rows: [] }));
    if ((legendRow as { rows: Record<string, unknown>[] }).rows[0]?.is_builtin) {
      return NextResponse.json({ error: 'Built-in legends cannot be modified.' }, { status: 403 });
    }
    const body = await request.json();
    const bx = parseInt(String(body.bbox_x), 10);
    const by = parseInt(String(body.bbox_y), 10);
    const bw = parseInt(String(body.bbox_w), 10);
    const bh = parseInt(String(body.bbox_h), 10);
    if (![bx, by, bw, bh].every((n) => Number.isFinite(n)) || bw <= 0 || bh <= 0) {
      return NextResponse.json({ error: 'Valid bbox_x/y/w/h required' }, { status: 400 });
    }
    const old = await db.query('SELECT * FROM legend_symbols WHERE id=$1 AND legend_id=$2', [symbolId, legendId]);
    if (old.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cur = old.rows[0];
    const page = Number(cur.pid_page ?? 1);

    const pdf = (await getFile(`legend-${legendId}.pdf`)) as unknown as Buffer;
    const rendered = await renderPageToPng(pdf, page, 4.0);
    const cropB64 = await cropPageRegion(
      rendered.png.toString('base64'),
      { x: bx, y: by, width: bw, height: bh },
      rendered.width, rendered.height, 0.05
    );
    if (!cropB64) return NextResponse.json({ error: 'Crop failed for this bbox' }, { status: 422 });
    const hash = hashImage(cropB64);
    const refName = `legend-${legendId}-p${page}-${hash.slice(0, 12)}.png`;
    await saveFile(refName, Buffer.from(cropB64, 'base64'));

    await db.query(
      `UPDATE legend_symbols SET
        asset_type = $1,
        symbol_name = $2,
        tag_pattern = $3,
        description = $4,
        aliases = $5::text[],
        status = 'DRAFT',
        bbox_x = $6,
        bbox_y = $7,
        bbox_w = $8,
        bbox_h = $9,
        pid_page = $10,
        reference_image_url = $11,
        reference_crop_hash = $12,
        quality_status = NULL,
        pipeline_version = NULL,
        review_reason = NULL,
        superseded_by = NULL,
        updated_at = NOW()
       WHERE id = $13 AND legend_id = $14`,
      [cur.asset_type, cur.symbol_name, cur.tag_pattern, cur.description,
       cur.aliases ?? [], bx, by, bw, bh, page, refName, hash, symbolId, legendId]
    );
    const previousRef = typeof cur.reference_image_url === 'string' ? cur.reference_image_url : null;
    if (
      previousRef &&
      previousRef !== refName &&
      previousRef.startsWith(`legend-${legendId}-`) &&
      !previousRef.includes('/') &&
      !previousRef.includes('\\')
    ) {
      try { await deleteFile(previousRef); }
      catch (e: unknown) { console.warn('[legend recrop POST] old crop cleanup failed:', e instanceof Error ? e.message : String(e)); }
    }
    const updated = await db.query('SELECT * FROM legend_symbols WHERE id=$1 AND legend_id=$2', [symbolId, legendId]);
    return NextResponse.json({ replaced: true, symbol: updated.rows[0] }, { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend recrop POST]', msg.slice(0, 300));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
