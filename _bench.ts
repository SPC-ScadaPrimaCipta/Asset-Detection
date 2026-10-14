import { renderPageToPng } from './lib/pdf-render';
import { readFileSync } from 'fs';

async function main() {
  const buf = readFileSync('./storage/cb0fb0c9-c20d-42ef-8ffc-b202243764cf-fire_water_sp_pdt.pdf');
  const r = await renderPageToPng(buf, 1, 3.0);
  const b64 = r.png.toString('base64');
  console.log('page png size:', (b64.length/1024).toFixed(0)+'KB base64');

  // Simulate one tile (crop top-left 1280x1280)
  const sharp = (await import('sharp')).default;
  const tilePng = await sharp(r.png).extract({ left:0, top:0, width:Math.min(1280,r.width), height:Math.min(1280,r.height) }).png().toBuffer();
  const tileB64 = tilePng.toString('base64');
  console.log('tile png size:', (tileB64.length/1024).toFixed(0)+'KB base64');

  // Call CV service
  const t = Date.now();
  const res = await fetch('http://127.0.0.1:8001/candidates', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ pngBase64: tileB64, pageNumber: 1, ocrProvider: 'tesseract', yoloClassMap: ['Gate_Valve','Control_Valve','Check_valve'] })
  });
  const data = await res.json() as any;
  console.log('CV /candidates time:', Date.now()-t, 'ms');
  console.log('candidates:', data.candidates?.length, '| warnings:', data.warnings);
  const timings = (data.timings as any[]) || [];
  timings.forEach((t:any) => console.log(' ', t.name, t.ms+'ms'));
}
main();
