import { pool } from '../lib/db';

async function main() {
  const jobs = await pool.query(
    'SELECT id, status, document_id, progress_pct, error_detail, created_at, completed_at FROM detection_jobs ORDER BY created_at DESC LIMIT 5'
  );
  console.log('Recent jobs:', jobs.rows);
  if (jobs.rows.length > 0) {
    const latestJobId = jobs.rows[0].id;
    const runs = await pool.query(
      'SELECT id, job_id, model, status, error, input_metadata, output_metadata FROM agent_runs WHERE job_id = $1',
      [latestJobId]
    );
    console.log('Agent run for latest job:', runs.rows);
    const dets = await pool.query(
      'SELECT detection_source, count(*) FROM detections WHERE job_id = $1 GROUP BY detection_source',
      [latestJobId]
    );
    console.log('Detection sources for latest job:', dets.rows);
  }
  await pool.end();
}

main().catch(console.error);
