require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

async function renderPage(pdfBuf, page) {
  const payload = JSON.stringify({ pdf: pdfBuf.toString('base64'), page, scale: 3.0 });
  return new Promise((resolve, reject) => {
    const child = execFile('node', ['scripts/render-page.mjs'], { maxBuffer: 200 * 1024 * 1024 });
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('close', () => {
      try { resolve(JSON.parse(out)); } catch(e) { reject(new Error('Parse: ' + out.slice(0,200))); }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];

async function tryModel(modelName, pngBase64, w, h) {
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });

  const prompt = `Detect ALL equipment from this P&ID image. Return JSON: {"page":1,"detections":[{"assetType":"string","assetTag":"string or null","confidence":0.9,"bbox":{"x":0,"y":0,"width":100,"height":100},"evidence":["reason"]}]}. Coords 0-1000 normalized (not pixels). Image is ${w}x${h}px.`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: pngBase64 } },
  ]);

  const raw = result.response.text();
  const parsed = JSON.parse(raw);
  return { model: modelName, count: parsed.detections?.length ?? 0, first: parsed.detections?.[0] };
}

async function main() {
  const storageDir = path.resolve('./storage');
  const files = fs.readdirSync(storageDir).filter(f => f.endsWith('.pdf') && !f.startsWith('legend'));
  const pdfBuf = fs.readFileSync(path.join(storageDir, files[0]));
  
  console.log('Rendering page 1...');
  const png = await renderPage(pdfBuf, 1);
  console.log('PNG:', png.width, 'x', png.height, 'size:', Math.round(png.png?.length * 0.75 / 1024), 'KB');

  for (const m of MODELS) {
    try {
      console.log(`\nTrying ${m}...`);
      const r = await tryModel(m, png.png, png.width, png.height);
      console.log(`✓ ${r.model}: ${r.count} detections`);
      if (r.first) console.log('  First:', JSON.stringify(r.first));
      break; // stop at first success
    } catch(e) {
      console.log(`✗ ${m}: ${e.message.slice(0, 150)}`);
    }
  }
}

main().catch(e => console.error('FATAL:', e.message));
