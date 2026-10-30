import '../lib/env';
import db from '../lib/db';
import { bboxIoU, bboxContainment, bboxCentroidDistance, typeCompatible } from '../lib/detection/duplicate-detection';

async function analyze80() {
  const docId = 'ebe251a9-b858-4ce3-93d5-9315086dae59';
  const res = await db.query(
    `SELECT id, asset_tag, asset_type, pid_page, bbox_x, bbox_y, bbox_w, bbox_h, confidence
     FROM detections
     WHERE document_id = $1 AND detection_status != 'REJECTED'
     ORDER BY bbox_y, bbox_x`,
    [docId]
  );
  
  const rows = res.rows;
  console.log('Total detections:', rows.length);

  // Check the known overlapping pairs visible in Image 1
  const pairsToCheck = [
    ['V-033', 'V-019'],
    ['V-034', 'V-028'],
    ['V-065', 'V-013'],
    ['V-045', 'V-062'],
    ['V-008', 'V-029'],
    ['V-006', 'V-030'],
    ['V-042', 'V-018'],
    ['V-059', 'V-068'],
    ['V-060', 'V-069'],
    ['V-061', 'V-005'],
    ['V-066', 'V-050'],
  ];

  for (const [tagA, tagB] of pairsToCheck) {
    const a = rows.find(r => r.asset_tag === tagA);
    const b = rows.find(r => r.asset_tag === tagB);
    if (!a || !b) {
      console.log(`Missing pair: ${tagA} (${!!a}) vs ${tagB} (${!!b})`);
      continue;
    }
    const boxA = { x: a.bbox_x, y: a.bbox_y, width: a.bbox_w, height: a.bbox_h };
    const boxB = { x: b.bbox_x, y: b.bbox_y, width: b.bbox_w, height: b.bbox_h };
    const iou = bboxIoU(boxA, boxB);
    const cont = bboxContainment(boxA, boxB);
    const dist = bboxCentroidDistance(boxA, boxB);
    const compat = typeCompatible(a.asset_type, b.asset_type);
    console.log(`Pair [${tagA}] vs [${tagB}]:`);
    console.log(`  Types: '${a.asset_type}' vs '${b.asset_type}' (compat: ${compat})`);
    console.log(`  BoxA: [${boxA.x}, ${boxA.y}, ${boxA.width}, ${boxA.height}]`);
    console.log(`  BoxB: [${boxB.x}, ${boxB.y}, ${boxB.width}, ${boxB.height}]`);
    console.log(`  iou=${iou.toFixed(3)}, containment=${cont.toFixed(3)}, dist=${dist.toFixed(1)}px`);
  }
}

analyze80().then(() => process.exit(0)).catch(console.error);

