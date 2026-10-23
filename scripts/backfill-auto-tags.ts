import db from '../lib/db';
import {
  applyProjectAutoTagging,
  loadProjectExistingTags,
  LegendSymbolTagPatternRef,
} from '../lib/tag-generator';

async function main() {
  console.log('[Backfill] Starting auto-tag allocation for untagged detections...');

  // 1. Get all documents that have untagged detections
  const docRows = await db.query<{ id: string; filename: string; project_id: string }>(
    `SELECT DISTINCT doc.id, doc.filename, doc.project_id
     FROM documents doc
     JOIN detections d ON d.document_id = doc.id
     WHERE d.asset_tag IS NULL OR TRIM(d.asset_tag) = ''
     ORDER BY doc.id`
  );

  console.log(`[Backfill] Found ${docRows.rows.length} document(s) with untagged detections.`);

  let grandTotal = 0;

  for (const doc of docRows.rows) {
    const documentId = doc.id;
    const projectId = doc.project_id;

    // Fetch untagged detections for this doc
    const detRes = await db.query<{
      id: string;
      asset_type: string;
      asset_tag: string | null;
      legend_symbol_id: string | null;
      evidence: any;
      det_evidence?: any;
    }>(
      `SELECT id, asset_type, asset_tag, legend_symbol_id, evidence, det_evidence
       FROM detections
       WHERE document_id = $1
         AND (asset_tag IS NULL OR TRIM(asset_tag) = '')
       ORDER BY pid_page ASC, created_at ASC`,
      [documentId]
    );

    if (detRes.rows.length === 0) continue;

    // Load existing project tags
    const existingProjectTags = await loadProjectExistingTags(db, projectId);

    // Load legend symbols
    let legendSymbols: LegendSymbolTagPatternRef[] = [];
    try {
      const symRes = await db.query<LegendSymbolTagPatternRef>(
        `SELECT id, asset_type, symbol_name, tag_pattern
         FROM legend_symbols
         WHERE status = 'ACTIVE'`
      );
      legendSymbols = symRes.rows;
    } catch {
      // ignore
    }

    // Map into auto-taggable items
    const taggableList = detRes.rows.map((r) => {
      let evList: string[] = [];
      if (Array.isArray(r.evidence)) {
        evList = [...r.evidence];
      } else if (typeof r.evidence === 'string') {
        try {
          const parsed = JSON.parse(r.evidence);
          evList = Array.isArray(parsed) ? parsed : [];
        } catch {
          evList = [r.evidence];
        }
      }

      return {
        id: r.id,
        assetTag: r.asset_tag,
        assetType: r.asset_type,
        legendSymbol: r.legend_symbol_id,
        evidence: evList,
        detEvidence: r.det_evidence && typeof r.det_evidence === 'object' ? r.det_evidence : {},
      };
    });

    const { generatedCount } = applyProjectAutoTagging(taggableList, {
      existingProjectTags,
      legendSymbols,
      allowGeneratedTags: true,
    });

    // Update in DB
    for (const item of taggableList) {
      if (item.assetTag) {
        await db.query(
          `UPDATE detections
           SET asset_tag = $1,
               evidence = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [item.assetTag, JSON.stringify(item.evidence), item.id]
        );

        await db.query(
          `UPDATE detection_mdo_records
           SET tag_no_proposed = $1,
               updated_at = NOW()
           WHERE detection_id = $2
             AND (tag_no_proposed IS NULL OR TRIM(tag_no_proposed) = '')`,
          [item.assetTag, item.id]
        );
      }
    }

    console.log(`[Backfill] Document "${doc.filename}" (${documentId}): Auto-tagged ${generatedCount} / ${taggableList.length} detections.`);
    grandTotal += generatedCount;
  }

  console.log(`[Backfill] Completed! Total assets auto-tagged: ${grandTotal}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill Error]', err);
  process.exit(1);
});
