import { pool } from '../lib/db';

async function main() {
  console.log('--- LATEST DETECTION JOBS ---');
  const jobs = await pool.query(`
    SELECT id, document_id, status, error_detail, progress_pct, created_at, started_at, completed_at
    FROM detection_jobs
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(jobs.rows, null, 2));

  console.log('\n--- LATEST AGENT RUNS ---');
  const runs = await pool.query(`
    SELECT id, job_id, model, status, error, started_at, completed_at
    FROM agent_runs
    ORDER BY started_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(runs.rows, null, 2));

  console.log('\n--- SETTINGS / AI CONFIG ---');
  const settings = await pool.query(`
    SELECT key, value
    FROM settings
    WHERE key LIKE 'ai%' OR key LIKE 'model%'
  `);
  console.log(JSON.stringify(settings.rows, null, 2));

  await pool.end();
}

main().catch(console.error);
