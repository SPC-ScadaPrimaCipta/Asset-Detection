require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

const jobId = '2b5df23e-8faa-4395-aa40-caef7f6b1f88';

async function main() {
  const ar = await p.query('SELECT status, error, output_metadata, input_metadata FROM agent_runs WHERE job_id = $1', [jobId]);
  console.log('agent_runs:', JSON.stringify(ar.rows, null, 2));

  const det = await p.query('SELECT COUNT(*) as cnt FROM detections WHERE job_id = $1', [jobId]);
  console.log('detections count:', det.rows[0].cnt);

  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
