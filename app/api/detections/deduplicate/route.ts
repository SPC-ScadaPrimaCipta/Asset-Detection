import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// POST /api/detections/deduplicate
// Removes duplicate detections per document — keeps highest-confidence row per
// (document_id, UPPER(asset_tag), UPPER(asset_type)) group.
// CONFIRMED/APPROVED rows are always kept; duplicates among them are resolved by
// keeping the one with the highest confidence (or latest created_at as tiebreak).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { document_id } = body as { document_id?: string };

  if (!document_id) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Find duplicate groups — keep the row with highest confidence (tiebreak: latest created_at)
    // Logic:
    //  1. For each (document_id, normalized_tag, normalized_type) group with >1 rows
    //  2. Pick winner: prefer APPROVED review_status, then highest confidence, then latest created_at
    //  3. Delete the rest
    const result = await client.query<{ deleted_count: number }>(`
      WITH ranked AS (
        SELECT
          id,
          document_id,
          UPPER(TRIM(COALESCE(asset_tag, '')))    AS norm_tag,
          UPPER(TRIM(COALESCE(asset_type, '')))   AS norm_type,
          confidence,
          review_status,
          created_at,
          ROW_NUMBER() OVER (
            PARTITION BY
              document_id,
              UPPER(TRIM(COALESCE(asset_tag, ''))),
              UPPER(TRIM(COALESCE(asset_type, '')))
            ORDER BY
              CASE WHEN review_status = 'APPROVED' THEN 0 ELSE 1 END ASC,
              COALESCE(confidence, 0) DESC,
              created_at DESC
          ) AS rn
        FROM detections
        WHERE document_id = $1
      ),
      to_delete AS (
        SELECT id FROM ranked WHERE rn > 1
      ),
      deleted AS (
        DELETE FROM detections WHERE id IN (SELECT id FROM to_delete)
        RETURNING id
      )
      SELECT COUNT(*)::int AS deleted_count FROM deleted
    `, [document_id]);

    await client.query('COMMIT');

    const deleted_count = result.rows[0]?.deleted_count ?? 0;
    return NextResponse.json({ ok: true, deleted_count });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[deduplicate]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
