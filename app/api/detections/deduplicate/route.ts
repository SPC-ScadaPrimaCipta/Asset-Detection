import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { findDuplicates, type DuplicateRow } from '@/lib/detection/duplicate-detection';

// POST /api/detections/deduplicate
//
// Geometry-first duplicate removal — see lib/detection/duplicate-detection.ts.
// The previous tag+type-only rule left duplicates behind whenever the same
// symbol was labelled differently by the YOLO / Gemini / vector lanes
// (Valve vs iso, Instrument vs Flow Element, PCV-003 vs PCV-003B, UNK-###).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { document_id } = body as { document_id?: string };

  if (!document_id) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const rows = await client.query<{
      id: string;
      asset_tag: string | null;
      asset_type: string;
      confidence: number | null;
      review_status: string;
      created_at: string;
      pid_page: number | null;
      bbox_x: number | null;
      bbox_y: number | null;
      bbox_w: number | null;
      bbox_h: number | null;
    }>(`
      SELECT id, asset_tag, asset_type, confidence, review_status, created_at,
             pid_page, bbox_x, bbox_y, bbox_w, bbox_h
      FROM detections
      WHERE document_id = $1
        AND detection_status != 'REJECTED'
    `, [document_id]);

    const candidates: DuplicateRow[] = rows.rows.map((r) => ({
      id: r.id,
      assetTag: r.asset_tag,
      assetType: r.asset_type,
      confidence: r.confidence,
      reviewStatus: r.review_status,
      createdAt: r.created_at,
      page: r.pid_page,
      bbox:
        r.bbox_x !== null && r.bbox_y !== null && r.bbox_w !== null && r.bbox_h !== null
          ? { x: r.bbox_x, y: r.bbox_y, width: r.bbox_w, height: r.bbox_h }
          : null,
    }));

    const { duplicateIds, groups } = findDuplicates(candidates);

    let deleted_count = 0;
    let kept_reviewed_count = 0;
    if (duplicateIds.size > 0) {
      const ids = Array.from(duplicateIds);
      const result = await client.query<{ id: string }>(
        `DELETE FROM detections
         WHERE id = ANY($1::uuid[])
           AND review_status NOT IN ('APPROVED', 'REVIEWED')
         RETURNING id`,
        [ids],
      );
      deleted_count = result.rowCount ?? 0;
      kept_reviewed_count = ids.length - deleted_count;
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      deleted_count,
      kept_reviewed_count,
      groups: groups.length,
    });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[deduplicate]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
