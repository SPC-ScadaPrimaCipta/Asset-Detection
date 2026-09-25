const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pool } = require('pg');
const mupdf = require('mupdf');
const fs = require('fs');
const path = require('path');

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
  const r = await pool.query('SELECT gemini_api_key, gemini_model FROM settings WHERE id=1');
  await pool.end();
  const { gemini_api_key: KEY, gemini_model: MODEL } = r.rows[0];
  console.log('Model:', MODEL);

  // Read PDF
  const pdfPath = path.join('storage', 'legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
  const pdfBuf = fs.readFileSync(pdfPath);
  console.log('PDF size:', pdfBuf.length);

  // Render page 1 at scale 2.0
  const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
  const page = doc.loadPage(0);
  const matrix = mupdf.Matrix.scale(2.0, 2.0);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const pngBuf = Buffer.from(pixmap.asPNG());
  const pngBase64 = pngBuf.toString('base64');
  console.log('Rendered PNG size:', pngBuf.length, '| base64 length:', pngBase64.length);

  // Call Gemini
  const genai = new GoogleGenerativeAI(KEY);
  const model = genai.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }
  });

  console.log('Calling Gemini with rendered PNG...');
  try {
    const res = await model.generateContent([
      { text: 'List 3 symbols from this P&ID legend. Return JSON only: {"symbols":[{"name":"string","assetType":"string"}]}' },
      { inlineData: { mimeType: 'image/png', data: pngBase64 } }
    ]);
    const text = res.response.text();
    console.log('Response length:', text.length);
    console.log('Response preview:', text.slice(0, 500));
  } catch (e) {
    console.log('Gemini error:', e.message?.slice(0, 500));
  }
}

main().catch(e => console.error(e.message?.slice(0, 300) || e));
