/**
 * Dry-run preview of Remove Duplicates (geometry-first rules), per document.
 * Read-only.
 */
import db from '@/lib/db';
import { findDuplicates, type DuplicateRow } from '@/lib/detection/duplicate-detection';

async function main() {
  const docs = (await db.query<{ id: string; filename: string }>(
    `SELECT id, filename FROM documents ORDER BY created_at DESC`,
  )).rows;

  for (const doc of docs) {
    const rows = (await db.query<{
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
       WHERE document_id = $1 AND detection_status <> 'REJECTED'`,
      [doc.id],
    )).rows;

    const candidates: DuplicateRow[] = rows.map((r) => ({
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
    if (duplicateIds.size === 0) continue;

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const samples = groups.slice(0, 4).map((g) => {
      const a = byId.get(g.winnerId)!;
      const b = byId.get(g.duplicateIds[0])!;
      return `${a.assetTag ?? '—'}/${a.assetType} (keep) ← ${b.assetTag ?? '—'}/${b.assetType}`;
    });

    console.log(
      `${doc.filename.slice(0, 46)}  rows=${rows.length}  duplicates=${duplicateIds.size}  groups=${groups.length}`,
    );
    for (const s of samples) console.log(`    ${s}`);
  }
}

main()
  .then(() => db.end())
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
