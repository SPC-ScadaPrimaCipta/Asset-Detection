import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { HUMAN_VALIDATED_PIPELINE_VERSION } from '@/lib/detection/legend/legend-classes';

/**
 * POST /api/legends/[id]/symbols/[symbolId]/validate — human confirms a
 * corrected reference as matcher-eligible.
 *
 * Sets quality_status='validated', pipeline_version=HUMAN_VALIDATED_PIPELINE_VERSION,
 * keeps computed_features/quality_reasons as-is (CV evidence stays visible).
 * An automated diagnostics pass must skip human-validated rows on re-run, so a
 * machine assessment never overwrites this decision.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id: legendId, symbolId } = await params;

  try {
    const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]);
    if (legendRow.rows[0]?.is_builtin) {
      return NextResponse.json({ error: 'Built-in legends cannot be modified.' }, { status: 403 });
    }
  } catch { /* is_builtin column missing — allow */ }

  try {
    const cur = await db.query(
      'SELECT reference_image_url FROM legend_symbols WHERE id=$1 AND legend_id=$2',
      [symbolId, legendId]
    );
    if (cur.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!cur.rows[0].reference_image_url) {
      return NextResponse.json({ error: 'Cannot validate: symbol has no reference crop' }, { status: 422 });
    }
    await db.query(
      `UPDATE legend_symbols SET quality_status='validated', pipeline_version=$1, updated_at=NOW()
       WHERE id=$2 AND legend_id=$3`,
      [HUMAN_VALIDATED_PIPELINE_VERSION, symbolId, legendId]
    );
    let row;
    try {
      row = await db.query(
        `SELECT ls.*, lc.label AS class_label, lc.normalized_label AS class_key
         FROM legend_symbols ls LEFT JOIN legend_classes lc ON lc.id = ls.class_id
         WHERE ls.id=$1`,
        [symbolId]
      );
    } catch {
      row = await db.query('SELECT * FROM legend_symbols WHERE id=$1', [symbolId]);
    }
    return NextResponse.json(row.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend validate POST]', msg.slice(0, 300));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
