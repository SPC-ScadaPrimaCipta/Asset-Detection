import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { HUMAN_VALIDATED_PIPELINE_VERSION } from '@/lib/detection/legend/legend-classes';

/**
 * POST /api/legends/[id]/symbols/bulk-validate — human bulk-confirms references.
 *
 * Same eligibility rule as the per-symbol validate route, applied in one
 * statement instead of N round trips. A row is left alone when:
 *   - it has no reference crop — `isMatcherEligible` rejects a missing crop, so
 *     validating it would record a decision the matcher cannot honour,
 *   - it is already validated (nothing to do),
 *   - it was rejected, in either column. `status='REJECTED'` matters as much as
 *     `quality_status='rejected'` here: eligibility is derived from
 *     quality_status alone, so validating a status-rejected row would silently
 *     put a human-rejected symbol back into the matcher.
 *
 * The response reports every bucket so the UI can explain a 0-row run instead
 * of appearing to do nothing.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: legendId } = await params;

  try {
    const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]);
    if (legendRow.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });
    if (legendRow.rows[0]?.is_builtin) {
      return NextResponse.json({ error: 'Built-in legends cannot be modified.' }, { status: 403 });
    }
  } catch { /* is_builtin column missing — allow */ }

  // Same predicate in the count and in the UPDATE, so the reported numbers
  // always describe the rows that were actually written.
  const ELIGIBLE = `reference_image_url IS NOT NULL
      AND quality_status IS DISTINCT FROM 'validated'
      AND quality_status IS DISTINCT FROM 'rejected'
      AND status IS DISTINCT FROM 'REJECTED'`;

  try {
    const before = await db.query(
      `SELECT
         count(*) FILTER (WHERE ${ELIGIBLE}) AS pending,
         count(*) FILTER (WHERE quality_status = 'validated') AS already,
         count(*) FILTER (WHERE reference_image_url IS NULL) AS no_crop,
         count(*) FILTER (WHERE quality_status = 'rejected' OR status = 'REJECTED') AS rejected
       FROM legend_symbols WHERE legend_id = $1`,
      [legendId]
    );
    const c = before.rows[0] as Record<string, string>;
    const counts = {
      pending: Number(c.pending),
      already: Number(c.already),
      noCrop: Number(c.no_crop),
      rejected: Number(c.rejected),
    };

    const result = await db.query(
      `UPDATE legend_symbols
          SET quality_status = 'validated',
              pipeline_version = $2,
              updated_at = NOW()
        WHERE legend_id = $1 AND ${ELIGIBLE}
        RETURNING id`,
      [legendId, HUMAN_VALIDATED_PIPELINE_VERSION]
    );
    const validated = result.rowCount ?? result.rows.length;

    console.log(
      `[legend/bulk-validate] legend=${legendId} validated=${validated} pending=${counts.pending} already=${counts.already} noCrop=${counts.noCrop} rejected=${counts.rejected}`,
    );
    return NextResponse.json({ validated, ...counts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend/bulk-validate]', msg.slice(0, 300));
    return NextResponse.json({ error: 'Bulk validate failed' }, { status: 500 });
  }
}