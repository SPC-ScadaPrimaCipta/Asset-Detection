// Test Gemini directly dengan key dari DB
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  // Get key from DB
  const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
  const r = await pool.query('SELECT gemini_api_key, gemini_model FROM settings WHERE id=1');
  await pool.end();
  
  const { gemini_api_key: key, gemini_model: model } = r.rows[0];
  console.log('Model:', model);
  console.log('Key prefix:', key?.slice(0, 12) + '...');

  // Simple text-only test first
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genai = new GoogleGenerativeAI(key);
  
  console.log('\n--- Test 1: text only ---');
  try {
    const m = genai.getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 100 } });
    const res = await m.generateContent('Return JSON: {"test": true}');
    const text = res.response.text();
    console.log('Response:', text.slice(0, 200));
  } catch (e) {
    console.log('Error:', e.message?.slice(0, 300));
  }

  // Test with PNG
  const pngPath = path.join(__dirname, '..', 'storage', 'legend-7045609b-cede-4509-b480-4d5a555f3fd7-p1-ff5b69cc66bb.png');
  if (!fs.existsSync(pngPath)) {
    console.log('\nNo cached PNG found, skipping image test');
    return;
  }
  
  console.log('\n--- Test 2: with image ---');
  try {
    const pngData = fs.readFileSync(pngPath).toString('base64');
    console.log('PNG size (base64):', pngData.length);
    const m = genai.getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 200 } });
    const res = await m.generateContent([
      { text: 'List 2 symbols from this P&ID legend. Return JSON: {"symbols":[{"name":"string"}]}' },
      { inlineData: { mimeType: 'image/png', data: pngData } },
    ]);
    const text = res.response.text();
    console.log('Response length:', text.length);
    console.log('Response preview:', text.slice(0, 500));
  } catch (e) {
    console.log('Error:', e.message?.slice(0, 500));
  }
}

main().catch(console.error);
