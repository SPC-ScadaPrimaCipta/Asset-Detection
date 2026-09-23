require('dotenv').config({ path: '.env.local' });
const path = require('path');
const fs = require('fs');

// Test: render page 1 from the PDF and send to gemini-3.6-flash
// Check what detections come back

async function main() {
  // Load the PDF
  const storagePath = path.join(__dirname, '..', 'storage', 'd086fdeb-e92c-48c1-bc2c-a50f8a2a3ff8-fire_water_sp_pdt.pdf');
  if (!fs.existsSync(storagePath)) {
    console.error('PDF not found:', storagePath);
    process.exit(1);
  }
  const buf = fs.readFileSync(storagePath);
  console.log('PDF size:', buf.length, 'bytes');

  // Render using mupdf
  let MuPDF;
  try {
    MuPDF = require('mupdf');
  } catch (e) {
    console.error('mupdf not available:', e.message);
    process.exit(1);
  }

  const doc = MuPDF.Document.openDocument(buf, 'application/pdf');
  const page = doc.loadPage(0);
  const scale = 3.0;
  const mat = MuPDF.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(mat, MuPDF.ColorSpace.DeviceRGB, false, true);
  const pngBuf = pixmap.asPNG();
  const pngBase64 = Buffer.from(pngBuf).toString('base64');
  console.log('PNG size:', pngBuf.length, 'bytes, base64 len:', pngBase64.length);
  console.log('Width:', pixmap.getWidth(), 'Height:', pixmap.getHeight());

  // Send to Gemini
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.error('No GEMINI_API_KEY'); process.exit(1); }

  const ai = new GoogleGenerativeAI(key);
  const model = ai.getGenerativeModel({
    model: 'gemini-3.6-flash',
    generationConfig: { temperature: 0, maxOutputTokens: 16384, responseMimeType: 'application/json' }
  });

  const prompt = `Detect ALL equipment symbols in this P&ID page image.
Return ONLY valid JSON: {"page":1,"detections":[{"assetType":"...","assetTag":"...","confidence":0.9,"bbox":{"x":0,"y":0,"width":100,"height":100},"evidence":["..."]}]}`;

  console.log('Sending to gemini-3.6-flash...');
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: pngBase64 } }
  ]);
  const raw = result.response.text();
  console.log('Raw response (first 2000 chars):');
  console.log(raw.slice(0, 2000));
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
