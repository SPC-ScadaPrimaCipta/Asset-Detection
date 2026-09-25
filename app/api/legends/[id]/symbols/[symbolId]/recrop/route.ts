import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile, saveFile, fileExists } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import { cropPageRegion } from '@/lib/image-crop';
import { hashImage } from '@/lib/symbol-cache';

/**
 * POST /api/legends/[id]/symbols/[symbolId]/recrop — versioned re-crop.
 *
 * Body: { bbox_x, bbox_y, bbox_w, bbox_h } in 0–1000 page space.
 * Renders the legend PDF page server-side, crops the new region, saves a
 * VERSIONED file (never overwrites the raw crop), INSERTs a new
 * legend_symbols row (DRAFT, quality NULL = not assessed), and links the old
 * row via superseded_by. Raw reference is preserved for audit.
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
    let refName = `legend-${legendId}-p${page}-${hash.slice(0, 12)}-v2.png`;
    let v = 2;
    while (await fileExists(refName)) {
      v++;
      refName = `legend-${legendId}-p${page}-${hash.slice(0, 12)}-v${v}.png`;
    }
    await saveFile(refName, Buffer.from(cropB64, 'base64'));

    const newId = uuidv4();
    await db.query(
      `INSERT INTO legend_symbols
        (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status,
         bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash,
         quality_status, pipeline_version, class_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14,NULL,NULL,$15)`,
      [newId, legendId, cur.asset_type, cur.symbol_name, cur.tag_pattern, cur.description,
       cur.aliases ?? [], bx, by, bw, bh, page, refName, hash, cur.class_id ?? null]
    );
    await db.query('UPDATE legend_symbols SET superseded_by=$1, updated_at=NOW() WHERE id=$2', [newId, symbolId]);
    const created = await db.query('SELECT * FROM legend_symbols WHERE id=$1', [newId]);
    return NextResponse.json({ old: { id: symbolId, superseded_by: newId }, new: created.rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend recrop POST]', msg.slice(0, 300));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
