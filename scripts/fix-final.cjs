const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const KEY = 'AQ.Ab8RN6LzpP9W9sO09iVrhrJLNzn9CyQeM8DG25EVFAPg8FQQgQ';
const MODEL = 'gemini-3.6-flash';

async function main() {
  // Update DB
  const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
  await pool.query('UPDATE settings SET gemini_api_key=$1, gemini_model=$2 WHERE id=1', [KEY, MODEL]);
  console.log('DB updated: key + model =', MODEL);
  await pool.end();

  // Test text + json
  const genai = new GoogleGenerativeAI(KEY);
  const model = genai.getGenerativeModel({ model: MODEL, generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 100 } });
  console.log('Testing JSON response...');
  try {
    const r = await model.generateContent('Return JSON: {"ok": true}');
    console.log('SUCCESS:', r.response.text().slice(0, 200));
  } catch (e) {
    console.log('Error:', e.message?.slice(0, 300));
  }
}

main().catch(console.error);
