const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function renderPage(pdfBuf, pageNum, scale) {
  const mupdf = await import('mupdf');
  const { Document, Matrix, ColorSpace } = mupdf;
  const doc = Document.openDocument(pdfBuf, 'application/pdf');
  const page = doc.loadPage(pageNum - 1);
  const matrix = Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, ColorSpace.DeviceRGB, false);
  return { png: Buffer.from(pixmap.asPNG()), width: pixmap.getWidth(), height: pixmap.getHeight() };
}

async function run() {
  const settings = await pool.query('SELECT gemini_api_key, gemini_model FROM settings LIMIT 1');
  const key = settings.rows[0].gemini_api_key;
  const model = settings.rows[0].gemini_model;

  const doc = await pool.query("SELECT file_path FROM documents WHERE id='9ddfe31d-078c-4b74-b3ae-816a45267771'");
  const filePath = path.join(process.cwd(), 'storage', doc.rows[0].file_path);
  const pdfBuf = fs.readFileSync(filePath);

  console.log('Rendering page 1 at scale 4.0...');
  const { png, width, height } = await renderPage(pdfBuf, 1, 4.0);
  console.log(`PNG: ${width}x${height}px, ${Math.round(png.length/1024)}KB`);

  const b64 = png.toString('base64');

  // Simple direct test — no legend, just detect everything
  const prompt = `You are a P&ID expert. Look at this industrial P&ID drawing carefully.

List EVERY equipment item you can see. Include:
- All pumps (look for pump symbols, tagged PDT-11, PDT-12, PDT-13, PDT-19)
- All tanks/vessels (D-12, D-13, D-19)  
- All valves (gate valves, check valves, ball valves — there are many)
- All instruments (pressure gauges, etc)
- Junction boxes (JB-03)
- Panels (MCFA, Local Control Panel)

Image is ${width}x${height}px. Return bbox in 0-1000 normalized space.
x_norm = round((x_pixel/${width})*1000), y_norm = round((y_pixel/${height})*1000)

Return ONLY JSON: {"page":1,"detections":[{"assetType":"...","assetTag":"...","confidence":0.9,"bbox":{"x":0,"y":0,"width":50,"height":50},"evidence":["..."]}]}`;

  console.log('Calling Gemini...');
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/png', data: b64 } }
      ]}],
      generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' }
    })
  });

  const j = await resp.json();
  if (!j.candidates) {
    console.log('API ERROR:', JSON.stringify(j.error));
    await pool.end(); return;
  }

  const raw = j.candidates[0].content.parts[0].text;
  console.log('Response length:', raw.length, 'chars');
  
  try {
    const parsed = JSON.parse(raw);
    const dets = parsed.detections || [];
    console.log(`\nDETECTED: ${dets.length} items\n`);
    dets.forEach((d, i) => {
      console.log(`${i+1}. ${d.assetTag || 'no-tag'} | ${d.assetType} | conf:${Math.round((d.confidence||0)*100)}% | bbox:${JSON.stringify(d.bbox)}`);
    });
  } catch(e) {
    console.log('Parse error:', e.message);
    console.log('Raw response:', raw.slice(0, 500));
  }

  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
