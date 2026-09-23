const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const run = await pool.query("SELECT input_metadata, output_metadata, error, status FROM agent_runs WHERE job_id='9212f0f8-bbf6-4dc1-b4f3-26d5b7237afc'");
  console.log('agent run:', JSON.stringify(run.rows[0], null, 2));
  
  const p1 = await pool.query("SELECT COUNT(id) cnt FROM detections WHERE pid_page=1");
  const p2 = await pool.query("SELECT COUNT(id) cnt FROM detections WHERE pid_page=2");
  console.log('page 1 detections:', p1.rows[0].cnt);
  console.log('page 2 detections:', p2.rows[0].cnt);
  
  // Test current API key
  const settings = await pool.query('SELECT gemini_api_key, gemini_model FROM settings LIMIT 1');
  const key = settings.rows[0].gemini_api_key;
  const model = settings.rows[0].gemini_model;
  console.log('model:', model);
  
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }] })
  });
  const j = await resp.json();
  if (j.candidates) console.log('API STATUS: OK -', j.candidates[0].content.parts[0].text);
  else console.log('API STATUS: FAIL -', JSON.stringify(j.error).slice(0, 200));
  
  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
