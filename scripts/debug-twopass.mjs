import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import * as mupdf from 'mupdf';

const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const r = await pool.query('SELECT gemini_api_key, gemini_model FROM settings WHERE id=1');
await pool.end();
const { gemini_api_key: KEY, gemini_model: MODEL } = r.rows[0];

// Render PDF at scale 2.5
const pdfBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
const page = doc.loadPage(0);
const matrix = mupdf.Matrix.scale(2.5, 2.5);
const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
const pngBuf = Buffer.from(pixmap.asPNG());
const pngBase64 = pngBuf.toString('base64');
const meta = await sharp(pngBuf).metadata();
const W = meta.width, H = meta.height;
console.log(`Full PNG: ${W}x${H} px`);

const genai = new GoogleGenerativeAI(KEY);
const model = genai.getGenerativeModel({ model: MODEL, generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' } });

// Pass 1 - just first 3 symbols
const p1res = await model.generateContent([
  { text: `List first 5 symbols from this P&ID legend. Return JSON: {"symbols":[{"name":"string","assetType":"string","bbox":[ymin,xmin,ymax,xmax]}]}` },
  { inlineData: { mimeType: 'image/png', data: pngBase64 } }
]);
const p1text = p1res.response.text();
const p1 = JSON.parse(p1text);
console.log('\nPass 1 results (0-1000 coords):');
p1.symbols?.slice(0, 3).forEach(s => {
  const [ymin,xmin,ymax,xmax] = s.bbox;
  console.log(`  "${s.name}": bbox=[${ymin},${xmin},${ymax},${xmax}]`);
  console.log(`    → pixel: x=${Math.round(xmin/1000*W)}, y=${Math.round(ymin/1000*H)}, w=${Math.round((xmax-xmin)/1000*W)}, h=${Math.round((ymax-ymin)/1000*H)}`);
});

// Pass 2 - crop first symbol and refine
const first = p1.symbols[0];
const [fymin,fxmin,fymax,fxmax] = first.bbox;
const px = Math.round(fxmin/1000*W), py = Math.round(fymin/1000*H);
const pw = Math.round((fxmax-fxmin)/1000*W), ph = Math.round((fymax-fymin)/1000*H);
const pad = Math.round(Math.max(pw,ph)*0.3);
const cx = Math.max(0,px-pad), cy = Math.max(0,py-pad);
const cw = Math.min(W-cx, pw+pad*2), ch = Math.min(H-cy, ph+pad*2);
const targetW = Math.max(200, cw*2);

console.log(`\nPass 2 crop for "${first.name}": pixel(${px},${py} ${pw}x${ph}), with pad: (${cx},${cy} ${cw}x${ch}), resized to w=${targetW}`);

const cropBuf = await sharp(pngBuf).extract({left:cx,top:cy,width:cw,height:ch}).resize(targetW,null,{kernel:'lanczos3'}).sharpen({sigma:0.8}).png().toBuffer();
const cropBase64 = cropBuf.toString('base64');

const p2res = await model.generateContent([
  { text: `Find exact bbox of the symbol graphic in this crop. Coords 0-1000 relative to THIS image. Return JSON: {"bbox":[ymin,xmin,ymax,xmax],"confirmed":true}` },
  { inlineData: { mimeType: 'image/png', data: cropBase64 } }
]);
const p2text = p2res.response.text();
const p2 = JSON.parse(p2text);
console.log(`Pass 2 raw: ${p2text}`);

// Convert back
if (p2.bbox) {
  const [b_ymin,b_xmin,b_ymax,b_xmax] = p2.bbox;
  const origX = cx + (b_xmin/1000)*cw;
  const origY = cy + (b_ymin/1000)*ch;
  const origX2 = cx + (b_xmax/1000)*cw;
  const origY2 = cy + (b_ymax/1000)*ch;
  const finalX = Math.round((origX/W)*1000);
  const finalY = Math.round((origY/H)*1000);
  const finalW = Math.round(((origX2-origX)/W)*1000);
  const finalH = Math.round(((origY2-origY)/H)*1000);
  console.log(`\nFinal refined (0-1000): x=${finalX} y=${finalY} w=${finalW} h=${finalH}`);
  console.log(`vs rough: x=${Math.round(fxmin)} y=${Math.round(fymin)} w=${Math.round(fxmax-fxmin)} h=${Math.round(fymax-fymin)}`);
}
