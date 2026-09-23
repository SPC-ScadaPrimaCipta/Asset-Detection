require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const settings = await p.query('SELECT ai_provider, gemini_model, deepseek_model FROM settings WHERE id=1');
  console.log('Settings:', JSON.stringify(settings.rows[0]));

  const cnt = await p.query("SELECT COUNT(*) FROM detections WHERE job_id = '003bd186-cb7a-4485-81ae-3fdf3ee9b9c0'");
  console.log('Detections for latest job:', cnt.rows[0].count);

  const total = await p.query('SELECT COUNT(*) FROM detections');
  console.log('Total detections:', total.rows[0].count);

  const byDoc = await p.query('SELECT document_id, COUNT(*) as cnt FROM detections GROUP BY document_id');
  console.log('By document:', JSON.stringify(byDoc.rows));

  // Check agent run output for latest job
  const ar = await p.query("SELECT output_metadata, error FROM agent_runs WHERE job_id = '003bd186-cb7a-4485-81ae-3fdf3ee9b9c0'");
  console.log('Agent run output:', JSON.stringify(ar.rows[0]));

  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
