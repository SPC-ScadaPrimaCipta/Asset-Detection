import '../lib/env';
import db from '../lib/db';

async function findT01() {
  const r = await db.query(
    `SELECT d.id, d.document_id, doc.filename, d.asset_tag, d.asset_type, d.bbox_x, d.bbox_y
     FROM detections d
     JOIN documents doc ON doc.id = d.document_id
     WHERE d.asset_tag IN ('T01-004', 'IHD-006')`
  );
  console.log('Detections:', r.rows);
}
findT01().then(() => process.exit(0)).catch(console.error);
