import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const pdfPath = join(__dirname, '..', 'storage', 'd086fdeb-e92c-48c1-bc2c-a50f8a2a3ff8-fire_water_sp_pdt.pdf');
  const buf = readFileSync(pdfPath);
  console.log('PDF size:', buf.length, 'bytes');

  // Render page 1
  const mupdf = await import('mupdf');
  const { Document, Matrix, ColorSpace } = mupdf;
  const doc = Document.openDocument(buf, 'application/pdf');
  console.log('Pages:', doc.countPages());

  const page = doc.loadPage(0);
  const mat = Matrix.scale(3.0, 3.0);
  const pixmap = page.toPixmap(mat, ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pixmap.asPNG());
  const pngBase64 = png.toString('base64');
  console.log('PNG:', pixmap.w, 'x', pixmap.h, '=', png.length, 'bytes');

  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.error('No GEMINI_API_KEY'); process.exit(1); }

  const ai = new GoogleGenerativeAI(key);

  // Test model availability
  for (const modelName of ['gemini-3.6-flash', 'gemini-2.5-flash']) {
    try {
      console.log(`\nTrying ${modelName}...`);
      const model = ai.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' }
      });

      const result = await model.generateContent([
        { text: `Detect ALL equipment symbols in this P&ID page. Return JSON: {"page":1,"detections":[{"assetType":"...","assetTag":"...","confidence":0.9,"bbox":{"x":0,"y":0,"width":100,"height":100},"evidence":["..."]}]}` },
        { inlineData: { mimeType: 'image/png', data: pngBase64 } }
      ]);

      const raw = result.response.text();
      console.log(`${modelName} response (500 chars):`, raw.slice(0, 500));

      // Try parse
      try {
        const j = JSON.parse(raw);
        console.log(`Detections: ${j.detections?.length ?? 0}`);
        if (j.detections?.length > 0) {
          console.log('First detection:', JSON.stringify(j.detections[0]));
        }
      } catch (pe) {
        console.log('Parse error:', pe.message);
      }
      break; // stop on first success
    } catch (e) {
      console.log(`${modelName} failed:`, e.message.slice(0, 200));
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
