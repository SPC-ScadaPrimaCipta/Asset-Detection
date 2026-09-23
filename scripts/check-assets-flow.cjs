require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Latest 5 jobs
  const jobs = await p.query('SELECT id, status, error_detail, progress_pct, created_at FROM detection_jobs ORDER BY created_at DESC LIMIT 5');
  console.log('=== Latest Jobs ===');
  jobs.rows.forEach(r => console.log(JSON.stringify(r)));

  // Total detections
  const dets = await p.query('SELECT COUNT(id) as total, review_status FROM detections GROUP BY review_status');
  console.log('\n=== Detections by review_status ===');
  dets.rows.forEach(r => console.log(JSON.stringify(r)));

  // Total assets
  const assets = await p.query('SELECT COUNT(id) as total FROM assets');
  console.log('\n=== Assets table ===');
  console.log('Total assets:', assets.rows[0].total);

  // What does /api/detections return?
  const apiDets = await p.query('SELECT id, asset_tag, asset_type, detection_status, review_status, job_id FROM detections ORDER BY created_at DESC LIMIT 5');
  console.log('\n=== Sample detections ===');
  apiDets.rows.forEach(r => console.log(JSON.stringify(r)));

  // Check if detections are linked to latest completed job
  const latestCompleted = await p.query("SELECT id FROM detection_jobs WHERE status='COMPLETED' ORDER BY created_at DESC LIMIT 1");
  if (latestCompleted.rows.length) {
    const jobId = latestCompleted.rows[0].id;
    const jobDets = await p.query('SELECT COUNT(id) as cnt FROM detections WHERE job_id=$1', [jobId]);
    console.log('\n=== Detections for latest COMPLETED job (' + jobId.slice(0,8) + '...) ===');
    console.log('Count:', jobDets.rows[0].cnt);
  }

  // Check assets API query - what does the assets page query?
  const assetsQuery = await p.query(`
    SELECT d.id, d.asset_tag, d.asset_type, d.detection_status, d.review_status
    FROM detections d
    WHERE d.detection_status != 'REJECTED'
    LIMIT 10
  `);
  console.log('\n=== Detections visible to assets page (not REJECTED) ===');
  console.log('Count:', assetsQuery.rows.length);
  assetsQuery.rows.forEach(r => console.log(JSON.stringify(r)));

  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
