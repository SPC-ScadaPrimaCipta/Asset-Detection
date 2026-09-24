const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
  const r = await pool.query('SELECT gemini_api_key, gemini_model FROM settings WHERE id=1');
  await pool.end();
  const { gemini_api_key: KEY, gemini_model: MODEL } = r.rows[0];
  console.log('Using model:', MODEL, '| key prefix:', KEY?.slice(0, 12));

  const genai = new GoogleGenerativeAI(KEY);

  // Use existing cached PNG
  const pngPath = path.join('storage', 'legend-7045609b-cede-4509-b480-4d5a555f3fd7-p1-ff5b69cc66bb.png');
  if (!fs.existsSync(pngPath)) { console.log('PNG not found at', pngPath); return; }

  const pngData = fs.readFileSync(pngPath).toString('base64');
  console.log('PNG base64 length:', pngData.length);

  const model = genai.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }
  });

  const prompt = `List 3 symbols from this P&ID legend. Return JSON only: {"symbols":[{"name":"string","assetType":"string"}]}`;

  try {
    console.log('Calling Gemini...');
    const res = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: 'image/png', data: pngData } }
    ]);
    const text = res.response.text();
    console.log('RAW response length:', text.length);
    console.log('RAW response:\n', text.slice(0, 1000));
  } catch (e) {
    console.log('ERROR:', e.message?.slice(0, 500));
  }
}

main().catch(console.error);
