import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';
import { buildMdoRecord } from '@/lib/mdo-enrichment';
import { buildPidGraph, classifyPortDirection, detectArrowheads } from '@/lib/pid-graph';

async function main() {
  const docs = (await db.query(`SELECT id, file_path FROM documents WHERE file_type='dxf'`)).rows;
  let count = 0;
  let removed = 0;
  for (const doc of docs) {
    const parsed = parseDxf((await getFile(doc.file_path)) as Buffer);
    const regions = splitDxfRegions(parsed);
    const bad = await db.query(
      `DELETE FROM detections
       WHERE document_id=$1 AND UPPER(asset_type)='UNKNOWN' AND asset_tag IS NULL
         AND detection_source='DXF'
         AND evidence::text ~* '^(.*CIRCLE|.*ARC).*No nearby tag text.*No legend match'
       RETURNING id`, [doc.id],
    );
    removed += bad.rowCount ?? 0;
    const detections = (await db.query(
      `SELECT id, asset_tag, asset_type, description, size, pid_page, bbox_x, bbox_y FROM detections
       WHERE document_id=$1 AND detection_status != 'REJECTED'
         AND candidate_status IN ('FINAL','APPROVED')`, [doc.id],
    )).rows;
    for (const d of detections) {
      const region = regions.find((r) => r.index + 1 === (d.pid_page ?? 1)) ?? regions[0];
      if (!region) continue;
      const x = d.bbox_x ?? 500, y = d.bbox_y ?? 500;
      const center = {
        x: region.extents.minX + (x / 1000) * region.extents.width,
        y: region.extents.maxY - (y / 1000) * region.extents.height,
      };
      const anchors = region.entities
        .filter((e): e is Extract<typeof e, { kind: 'TEXT' | 'MTEXT' }> => e.kind === 'TEXT' || e.kind === 'MTEXT')
        .map((e) => ({ text: e.text, x: e.position.x, y: e.position.y }));
      const graph = buildPidGraph(region.entities, Math.max(region.extents.width, region.extents.height) * 0.002);
      const arrows = detectArrowheads(region.entities, Math.max(region.extents.width, region.extents.height) * 0.08);
      const arrowDirection = arrows.map((arrow) => classifyPortDirection(arrow, center, Math.max(region.extents.width, region.extents.height) * 0.08)).find((value) => value !== 'UNKNOWN') ?? 'UNKNOWN';
      const mdo = buildMdoRecord({ assetTag: d.asset_tag, assetType: d.asset_type, description: d.description, size: d.size, rawPosition: center, relationRadius: Math.max(region.extents.width, region.extents.height) * 0.08, graph, graphTolerance: Math.max(region.extents.width, region.extents.height) * 0.05, arrowDirection }, anchors);
      await db.query(
        `INSERT INTO detection_mdo_records
          (detection_id, document_id, tag_no_proposed, equipment_type, component_name, size,
           from_value, to_value, of_value, at_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (detection_id) DO UPDATE SET
           tag_no_proposed=EXCLUDED.tag_no_proposed, equipment_type=EXCLUDED.equipment_type,
           component_name=EXCLUDED.component_name, size=EXCLUDED.size,
           from_value=EXCLUDED.from_value, to_value=EXCLUDED.to_value,
           of_value=EXCLUDED.of_value, at_value=EXCLUDED.at_value, updated_at=NOW()`,
        [d.id, doc.id, mdo.tagNoProposed, mdo.equipmentType, mdo.componentName, mdo.size,
          mdo.from, mdo.to, mdo.of, mdo.at],
      );
      count++;
    }
  }
  const remaining = await db.query(`SELECT count(*) FROM detections WHERE UPPER(asset_type)='UNKNOWN'`);
  console.log(JSON.stringify({ documents: docs.length, mdoRecords: count, removedFalsePositives: removed, remainingUnknown: remaining.rows[0].count }));
  await db.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
