const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT gemini_api_key, gemini_model FROM settings LIMIT 1').then(async s => {
  const key = s.rows[0].gemini_api_key;
  const model = s.rows[0].gemini_model;
  console.log('Testing model:', model);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({contents:[{parts:[{text:'Reply: OK'}]}], generationConfig:{temperature:0,maxOutputTokens:10}})
  });
  const j = await r.json();
  console.log('Full response:', JSON.stringify(j).slice(0, 500));
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
