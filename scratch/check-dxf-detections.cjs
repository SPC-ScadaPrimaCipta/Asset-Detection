const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const doc = (await pool.query(
    "SELECT id,filename FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 1"
  )).rows[0];
  console.log('Doc:', doc ? doc.filename : 'NONE');
  if (!doc) { await pool.end(); return; }

  const jobs = (await pool.query(
    'SELECT id,status,created_at FROM detection_jobs WHERE document_id=$1 ORDER BY created_at DESC LIMIT 3',
    [doc.id]
  )).rows;
  console.log('Jobs:', jobs.map(j => j.id + ' ' + j.status));
  if (!jobs[0]) { await pool.end(); return; }

  const jobId = jobs[0].id;
  const dets = (await pool.query(
    "SELECT asset_tag, asset_type, confidence, detection_status FROM detections WHERE job_id=$1 ORDER BY confidence DESC",
    [jobId]
  )).rows;
  console.log('\nTotal detections:', dets.length);
  for (const d of dets.slice(0, 40)) {
    console.log('  ' + (d.asset_tag || '(no tag)') + ' | ' + d.asset_type + ' | conf=' + (d.confidence ? d.confidence.toFixed(2) : '?'));
  }

  // Summary by asset_type
  const byType = {};
  for (const d of dets) {
    byType[d.asset_type] = (byType[d.asset_type] || 0) + 1;
  }
  console.log('\nBy asset_type:', byType);

  // No-tag count
  const noTag = dets.filter(d => !d.asset_tag).length;
  console.log('No-tag detections:', noTag, '/', dets.length);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
