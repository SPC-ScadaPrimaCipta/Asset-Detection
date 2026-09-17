require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

async function renderPage(pdfBuf) {
  const payload = JSON.stringify({ pdf: pdfBuf.toString('base64'), page: 1, scale: 2.0 });
  return new Promise((resolve, reject) => {
    const child = execFile('node', ['scripts/render-page.mjs'], { maxBuffer: 100 * 1024 * 1024 });
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('close', () => {
      try { resolve(JSON.parse(out)); } catch(e) { reject(new Error('Parse failed: ' + out.slice(0,200))); }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function main() {
  console.log('Model:', process.env.GEMINI_MODEL || 'gemini-2.0-flash');
  console.log('API Key prefix:', process.env.GEMINI_API_KEY?.slice(0,8) + '...');

  const storageDir = path.resolve('./storage');
  const files = fs.readdirSync(storageDir).filter(f => f.endsWith('.pdf') && !f.startsWith('legend'));
  if (!files.length) { console.error('No PDF found'); return; }

  const pdfPath = path.join(storageDir, files[0]);
  console.log('PDF:', path.basename(pdfPath));

  const pdfBuf = fs.readFileSync(pdfPath);
  const png = await renderPage(pdfBuf);
  console.log('PNG size:', png.png?.length, 'width:', png.width, 'height:', png.height);

  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });

  const result = await model.generateContent([
    { text: 'Detect ALL equipment from this P&ID. Return JSON: {"page":1,"detections":[{"assetType":"string","assetTag":"string or null","confidence":0.9,"bbox":{"x":0,"y":0,"width":100,"height":100},"evidence":["reason"]}]}. Coords 0-1000 normalized.' },
    { inlineData: { mimeType: 'image/png', data: png.png } },
  ]);

  const raw = result.response.text();
  console.log('\nRAW (500 chars):', raw.slice(0, 500));

  try {
    const parsed = JSON.parse(raw);
    console.log('\nDetections:', parsed.detections?.length ?? 0);
    if (parsed.detections?.[0]) console.log('First:', JSON.stringify(parsed.detections[0]));
  } catch(e) {
    console.error('Parse error:', e.message);
  }
}

main().catch(e => { console.error('ERROR:', e.message); });
