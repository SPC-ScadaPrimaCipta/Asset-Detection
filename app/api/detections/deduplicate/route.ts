import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { findDuplicates, type DuplicateRow } from '@/lib/detection/duplicate-detection';

// GET /api/detections/deduplicate?document_id=...
//
// Dry-run preview of duplicates for a document. Returns count and groups for user inspection.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const document_id = searchParams.get('document_id');

  if (!document_id) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  try {
    const rows = await db.query<{
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
    }>(
      `SELECT id, asset_tag, asset_type, confidence, review_status, created_at,
              pid_page, bbox_x, bbox_y, bbox_w, bbox_h
       FROM detections
       WHERE document_id = $1
         AND detection_status != 'REJECTED'
       ORDER BY pid_page ASC, created_at DESC`,
      [document_id],
    );

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

    let unreviewed_count = 0;
    let reviewed_count = 0;
    for (const row of candidates) {
      if (duplicateIds.has(row.id)) {
        if (row.reviewStatus === 'APPROVED' || row.reviewStatus === 'REVIEWED') {
          reviewed_count++;
        } else {
          unreviewed_count++;
        }
      }
    }

    // Build preview groups (limit to first 50 groups for responsive modal rendering)
    const previewGroups = groups.slice(0, 50).map((g) => {
      const winner = candidates.find((c) => c.id === g.winnerId);
      const dupes = g.duplicateIds.map((id) => candidates.find((c) => c.id === id));
      return {
        winnerId: g.winnerId,
        winner: {
          id: winner?.id,
          assetTag: winner?.assetTag,
          assetType: winner?.assetType,
          confidence: winner?.confidence,
          reviewStatus: winner?.reviewStatus,
          page: winner?.page,
        },
        duplicates: dupes.map((d) => ({
          id: d?.id,
          assetTag: d?.assetTag,
          assetType: d?.assetType,
          confidence: d?.confidence,
          reviewStatus: d?.reviewStatus,
          page: d?.page,
        })),
      };
    });

    return NextResponse.json({
      ok: true,
      total_detections: candidates.length,
      duplicate_count: duplicateIds.size,
      groups_count: groups.length,
      unreviewed_count,
      reviewed_count,
      groups: previewGroups,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[deduplicate:GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/detections/deduplicate
//
// Geometry-first duplicate removal — see lib/detection/duplicate-detection.ts.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { document_id, include_reviewed } = body as {
    document_id?: string;
    include_reviewed?: boolean;
  };

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
    }>(
      `SELECT id, asset_tag, asset_type, confidence, review_status, created_at,
              pid_page, bbox_x, bbox_y, bbox_w, bbox_h
       FROM detections
       WHERE document_id = $1
         AND detection_status != 'REJECTED'`,
      [document_id],
    );

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
      if (include_reviewed) {
        const result = await client.query<{ id: string }>(
          `DELETE FROM detections
           WHERE id = ANY($1::uuid[])
           RETURNING id`,
          [ids],
        );
        deleted_count = result.rowCount ?? 0;
        kept_reviewed_count = 0;
      } else {
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
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      deleted_count,
      kept_reviewed_count,
      total_duplicates: duplicateIds.size,
      groups_count: groups.length,
    });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[deduplicate:POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
