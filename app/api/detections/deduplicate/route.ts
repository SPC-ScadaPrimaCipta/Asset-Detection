import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// POST /api/detections/deduplicate
// Spatial-aware deduplication: a detection is a TRUE duplicate only when
//   SAME asset_tag (normalized) AND SAME asset_type (normalized)
//   AND bounding boxes overlap (IoU ≥ 0.3) OR centroids are very close (< 80 units in 0-1000 space).
//
// Same tag but different type = different component (e.g. P-101 pump vs P-101 label) → NOT duplicate.
// Same tag+type but different location (different page region) → NOT duplicate.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { document_id } = body as { document_id?: string };

  if (!document_id) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Fetch all non-rejected detections with bbox for this document
    const rows = await client.query<{
      id: string;
      asset_tag: string | null;
      asset_type: string;
      confidence: number | null;
      review_status: string;
      created_at: string;
      bbox_x: number | null;
      bbox_y: number | null;
      bbox_w: number | null;
      bbox_h: number | null;
    }>(`
      SELECT id, asset_tag, asset_type, confidence, review_status, created_at,
             bbox_x, bbox_y, bbox_w, bbox_h
      FROM detections
      WHERE document_id = $1
        AND detection_status != 'REJECTED'
      ORDER BY
        CASE WHEN review_status = 'APPROVED' THEN 0 ELSE 1 END ASC,
        COALESCE(confidence, 0) DESC,
        created_at DESC
    `, [document_id]);

    const detections = rows.rows;
    if (detections.length === 0) {
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, deleted_count: 0 });
    }

    // Compute IoU between two bbox objects (0-1000 normalized space)
    function iou(
      ax: number, ay: number, aw: number, ah: number,
      bx: number, by: number, bw: number, bh: number
    ): number {
      const ax2 = ax + aw, ay2 = ay + ah;
      const bx2 = bx + bw, by2 = by + bh;
      const ix0 = Math.max(ax, bx), iy0 = Math.max(ay, by);
      const ix1 = Math.min(ax2, bx2), iy1 = Math.min(ay2, by2);
      const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
      const inter = iw * ih;
      if (inter === 0) return 0;
      const union = aw * ah + bw * bh - inter;
      return union > 0 ? inter / union : 0;
    }

    function centroidDist(
      ax: number, ay: number, aw: number, ah: number,
      bx: number, by: number, bw: number, bh: number
    ): number {
      const acx = ax + aw / 2, acy = ay + ah / 2;
      const bcx = bx + bw / 2, bcy = by + bh / 2;
      return Math.hypot(acx - bcx, acy - bcy);
    }

    const IOU_THRESHOLD = 0.3;       // bbox overlap to consider spatially identical
    const CENTROID_THRESHOLD = 80;   // 0-1000 units; ~8% page width — same symbol region

    // Find duplicate pairs: same tag + same type + spatial overlap
    const toDelete = new Set<string>();
    const kept = new Set<string>(); // already selected as winner

    for (let i = 0; i < detections.length; i++) {
      const a = detections[i];
      if (toDelete.has(a.id)) continue; // already marked as duplicate

      const aTag = (a.asset_tag ?? '').toUpperCase().trim();
      const aType = (a.asset_type ?? '').toUpperCase().trim();

      for (let j = i + 1; j < detections.length; j++) {
        const b = detections[j];
        if (toDelete.has(b.id)) continue;

        const bTag = (b.asset_tag ?? '').toUpperCase().trim();
        const bType = (b.asset_type ?? '').toUpperCase().trim();

        // Must match tag (both non-empty) AND type
        if (!aTag || !bTag) continue;         // no tag → can't determine duplicate by tag
        if (aTag !== bTag) continue;           // different tag → different asset
        if (aType && bType && aType !== bType) continue; // different component type → not duplicate

        // Spatial check — need both bboxes present
        const aHasBbox = a.bbox_x !== null && a.bbox_y !== null && a.bbox_w !== null && a.bbox_h !== null;
        const bHasBbox = b.bbox_x !== null && b.bbox_y !== null && b.bbox_w !== null && b.bbox_h !== null;

        let isSpatialDuplicate = false;
        if (aHasBbox && bHasBbox) {
          const overlapScore = iou(a.bbox_x!, a.bbox_y!, a.bbox_w!, a.bbox_h!, b.bbox_x!, b.bbox_y!, b.bbox_w!, b.bbox_h!);
          const cdist = centroidDist(a.bbox_x!, a.bbox_y!, a.bbox_w!, a.bbox_h!, b.bbox_x!, b.bbox_y!, b.bbox_w!, b.bbox_h!);
          isSpatialDuplicate = overlapScore >= IOU_THRESHOLD || cdist < CENTROID_THRESHOLD;
        } else {
          // No bbox info — fall back to tag+type match alone (conservative)
          isSpatialDuplicate = true;
        }

        if (isSpatialDuplicate) {
          // i is already winner (sorted highest confidence first)
          toDelete.add(b.id);
        }
      }
    }

    let deleted_count = 0;
    if (toDelete.size > 0) {
      const ids = Array.from(toDelete);
      const result = await client.query<{ count: string }>(
        `DELETE FROM detections WHERE id = ANY($1::uuid[]) RETURNING id`,
        [`{${ids.join(',')}}`]
      );
      deleted_count = result.rowCount ?? 0;
    }

    await client.query('COMMIT');
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
