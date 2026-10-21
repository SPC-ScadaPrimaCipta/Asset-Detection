import { pool } from '../lib/db';

async function main() {
  const docId = '7bef66d3-c814-4dd3-bed2-072797fe091b';
  const jobs = await pool.query('SELECT id, status, progress_pct, error_detail, created_at, completed_at FROM detection_jobs WHERE document_id = $1 ORDER BY created_at DESC', [docId]);
  console.log('All jobs for DXF doc:', jobs.rows);
  const jobId = jobs.rows[0]?.id;
  if (!jobId) return;
  const runs = await pool.query('SELECT * FROM agent_runs WHERE job_id = $1', [jobId]);
  console.log('Agent runs:', runs.rows);
  const layers = await pool.query('SELECT * FROM dxf_layer_analysis WHERE document_id = (SELECT document_id FROM detection_jobs WHERE id = $1)', [jobId]);
  console.log('DXF layers analyzed count:', layers.rowCount, layers.rows.slice(0, 5));
  const dets = await pool.query('SELECT detection_source, count(*) FROM detections WHERE job_id = $1 GROUP BY detection_source', [jobId]);
  console.log('Detections by source:', dets.rows);
  const sample = await pool.query('SELECT id, asset_tag, asset_type, detection_source, evidence, confidence FROM detections WHERE job_id = $1 LIMIT 10', [jobId]);
  const allDets = await pool.query('SELECT evidence FROM detections WHERE job_id = $1', [jobId]);
  let visionCount = 0;
  for (const row of allDets.rows) {
    const ev = JSON.stringify(row.evidence);
    if (ev.toLowerCase().includes('vision')) visionCount++;
  }
  console.log('Total dets:', allDets.rowCount, 'Dets with vision in evidence:', visionCount);
  await pool.end();
}

main().catch(console.error);
