import { readFile } from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const mupdf = await import('mupdf');
const { Document, Matrix, ColorSpace } = mupdf;
const pdfBuf = await readFile('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
const doc = Document.openDocument(pdfBuf, 'application/pdf');
const page = doc.loadPage(0);
const pixmap = page.toPixmap(Matrix.scale(2.0, 2.0), ColorSpace.DeviceRGB, false);
const pngBase64 = Buffer.from(pixmap.asPNG()).toString('base64');
console.log('PNG size:', (pngBase64.length / 1024 / 1024).toFixed(1) + 'MB');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

for (const modelName of models) {
  process.stdout.write(`${modelName}... `);
  try {
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } });
    const t0 = Date.now();
    const r = await model.generateContent([
      { text: 'Count how many pump symbols you see. Reply with just a number.' },
      { inlineData: { mimeType: 'image/png', data: pngBase64 } }
    ]);
    const text = r.response.text().trim();
    console.log(`OK (${Date.now()-t0}ms): "${text.slice(0,50)}"`);
    break;
  } catch(e) {
    console.log(`FAIL: ${e.message.slice(0,80)}`);
  }
}
