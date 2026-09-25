import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';
import { readFileSync } from 'fs';

const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const r = await pool.query('SELECT gemini_api_key FROM settings WHERE id=1');
await pool.end();
const KEY = r.rows[0].gemini_api_key;

const pngBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7-p1-ff5b69cc66bb.png');
const pngBase64 = pngBuf.toString('base64');

const genai = new GoogleGenerativeAI(KEY);

// Try these models in order
const candidates = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

for (const modelName of candidates) {
  process.stdout.write(`Testing ${modelName}... `);
  try {
    const model = genai.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1, maxOutputTokens: 200, responseMimeType: 'application/json' }
    });
    const res = await model.generateContent([
      { text: 'Return JSON only: {"symbols":[{"name":"Pump","assetType":"Pump"}]}' },
      { inlineData: { mimeType: 'image/png', data: pngBase64 } }
    ]);
    const text = res.response.text();
    console.log(`OK (${text.length} chars): ${text.slice(0, 80)}`);
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 120)}`);
  }
}
