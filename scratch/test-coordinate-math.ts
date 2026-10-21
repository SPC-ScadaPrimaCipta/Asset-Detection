import { pool } from '@/lib/db';
import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import sharp from 'sharp';

async function main() {
  const lRes = await pool.query('SELECT id FROM legends ORDER BY created_at DESC LIMIT 1');
  const pdfBuf = await getFile('legend-' + lRes.rows[0].id + '.pdf');
  const rendered = await renderPageToPng(pdfBuf, 1, 2.0);
  const imgW = rendered.width;
  const imgH = rendered.height;

  // Query database for symbol 'CENTRIFUGAL PUMP'
  const symRes = await pool.query(
    "SELECT symbol_name, bbox_x, bbox_y, bbox_w, bbox_h FROM legend_symbols WHERE symbol_name = 'CENTRIFUGAL PUMP' AND legend_id = $1 LIMIT 1",
    [lRes.rows[0].id]
  );
  const sym = symRes.rows[0];
  console.log('Stored DB Centrifugal Pump:', sym);

  // Region 0: r=0, c=0
  const cols = 6, rows = 4, overlap = 0.05;
  const colW = 1 / cols;
  const rowH = 1 / rows;
  const x = Math.max(0, 0 * colW - overlap);
  const y = Math.max(0, 0 * rowH - overlap);
  const x2 = Math.min(1, (0 + 1) * colW + overlap);
  const y2 = Math.min(1, (0 + 1) * rowH + overlap);
  const regW = x2 - x;
  const regH = y2 - y;

  const cropX = Math.round(x * imgW);
  const cropY = Math.round(y * imgH);
  const cropW = Math.max(10, Math.round(regW * imgW));
  const cropH = Math.max(10, Math.round(regH * imgH));

  console.log('Region 0: cropX=', cropX, 'cropY=', cropY, 'cropW=', cropW, 'cropH=', cropH);

  // If DB bbox_x was 100, what was rx in the crop?
  // fullX = Math.round((normX / imgW) * 1000) = 100
  // normX = (fullX / 1000) * imgW = 0.10 * 2358 = 235.8 px
  // normX = (rx / 1000) * cropW + cropX => rx = ((normX - cropX) / cropW) * 1000
  const rx = (( (sym.bbox_x / 1000) * imgW - cropX) / cropW) * 1000;
  const ry = (( (sym.bbox_y / 1000) * imgH - cropY) / cropH) * 1000;
  const rw = (( (sym.bbox_w / 1000) * imgW) / cropW) * 1000;
  const rh = (( (sym.bbox_h / 1000) * imgH) / cropH) * 1000;

  console.log('Calculated rx, ry in crop:', { rx, ry, rw, rh });

  // Now let's crop the actual rectangle from rendered.png using sym.bbox (in full page pixels)
  const fullPixelX = Math.round((sym.bbox_x / 1000) * imgW);
  const fullPixelY = Math.round((sym.bbox_y / 1000) * imgH);
  const fullPixelW = Math.round((sym.bbox_w / 1000) * imgW);
  const fullPixelH = Math.round((sym.bbox_h / 1000) * imgH);

  console.log('Full page pixel bbox:', { fullPixelX, fullPixelY, fullPixelW, fullPixelH });

  const symbolCrop = await sharp(rendered.png)
    .extract({ left: fullPixelX, top: fullPixelY, width: fullPixelW, height: fullPixelH })
    .png()
    .toBuffer();

  const { saveFile } = await import('@/lib/storage');
  await saveFile('debug-centrifugal-crop.png', symbolCrop);
  console.log('Saved debug-centrifugal-crop.png');
}

main().catch(console.error).finally(() => process.exit(0));
