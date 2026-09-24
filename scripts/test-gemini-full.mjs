import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';
import { readFileSync } from 'fs';

const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const r = await pool.query('SELECT gemini_api_key, gemini_model FROM settings WHERE id=1');
await pool.end();
const { gemini_api_key: KEY, gemini_model: MODEL } = r.rows[0];
console.log('Model:', MODEL, '| key:', KEY?.slice(0, 12) + '...');

// Use existing PNG (rendered at scale 2.0 previously)
const pngBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7-p1-ff5b69cc66bb.png');
const pngBase64 = pngBuf.toString('base64');
console.log('PNG size:', pngBuf.length, '| base64:', pngBase64.length);

const genai = new GoogleGenerativeAI(KEY);

// Test with same config as legend-extract.ts uses
const model = genai.getGenerativeModel({
  model: MODEL,
  generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' }
});

const PROMPT = `You are a P&ID legend digitizer. List ALL symbols from this legend page.
Return JSON ONLY: {"symbols":[{"name":"string","assetType":"string","tagPattern":"string or null","aliases":[],"bbox":[0,0,0,0]}]}`;

console.log('\nCalling Gemini with full prompt...');
try {
  const res = await model.generateContent([
    { text: PROMPT },
    { inlineData: { mimeType: 'image/png', data: pngBase64 } }
  ]);
  const text = res.response.text();
  console.log('Response length:', text.length);
  console.log('First 300 chars:', text.slice(0, 300));
  console.log('Last 100 chars:', text.slice(-100));
  
  // Try parse
  try {
    const j = JSON.parse(text);
    console.log('\nParse OK! Symbols count:', j.symbols?.length ?? 'N/A');
  } catch (pe) {
    console.log('\nParse FAILED:', pe.message);
    // Find position 165
    console.log('Char at 160-170:', JSON.stringify(text.slice(160, 170)));
  }
} catch (e) {
  console.log('Gemini error:', e.message?.slice(0, 500));
}
