const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const KEY = 'AQ.Ab8RN6LzpP9W9sO09iVrhrJLNzn9CyQeM8DG25EVFAPg8FQQgQ';

async function main() {
  // Test key dulu
  console.log('Testing key...');
  const genai = new GoogleGenerativeAI(KEY);
  try {
    const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const res = await model.generateContent('Say hello in one word');
    console.log('Key VALID. Response:', res.response.text().slice(0, 50));
  } catch (e) {
    console.log('Key test failed:', e.message?.slice(0, 200));
  }

  // Update DB regardless
  const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
  await pool.query('UPDATE settings SET gemini_api_key=$1 WHERE id=1', [KEY]);
  console.log('DB updated with new key');
  await pool.end();
}

main().catch(console.error);
