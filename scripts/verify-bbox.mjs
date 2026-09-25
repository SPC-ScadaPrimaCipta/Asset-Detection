import sharp from 'sharp';
import { Pool } from 'pg';
import * as mupdf from 'mupdf';
import { readFileSync, writeFileSync } from 'fs';

// Render PDF at scale 2.5 (same as reparse)
const pdfBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
const page = doc.loadPage(0);
const pixmap = page.toPixmap(mupdf.Matrix.scale(2.5, 2.5), mupdf.ColorSpace.DeviceRGB, false);
const pngBuf = Buffer.from(pixmap.asPNG());
const W = pixmap.getWidth(), H = pixmap.getHeight();
console.log(`Full render: ${W}x${H}`);

// Get symbols from DB
const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const r = await pool.query(
  "SELECT symbol_name, bbox_x, bbox_y, bbox_w, bbox_h FROM legend_symbols WHERE legend_id='7045609b-cede-4509-b480-4d5a555f3fd7' AND bbox_x IS NOT NULL ORDER BY bbox_y, bbox_x"
);
await pool.end();
console.log(`Symbols: ${r.rows.length}`);

// Build SVG overlay
const rects = r.rows.map(s => {
  const x = Math.round((s.bbox_x / 1000) * W);
  const y = Math.round((s.bbox_y / 1000) * H);
  const w = Math.max(4, Math.round((s.bbox_w / 1000) * W));
  const h = Math.max(4, Math.round((s.bbox_h / 1000) * H));
  const label = (s.symbol_name ?? '').slice(0, 18).replace(/[<>&"']/g, '');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,0,0,0.15)" stroke="red" stroke-width="3"/>
<text x="${x+2}" y="${y > 14 ? y-3 : y+h+10}" font-size="14" fill="blue" font-family="Arial,sans-serif" font-weight="bold">${label}</text>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`;

// Render SVG overlay to PNG buffer first (same size as base image)
const svgPng = await sharp(Buffer.from(svg)).resize(W, H).png().toBuffer();

// Downscale output to 50% for easier viewing
const outW = Math.round(W * 0.5);
await sharp(pngBuf)
  .composite([{ input: svgPng, top: 0, left: 0 }])
  .resize(outW, null)
  .png()
  .toFile('storage/_debug_bbox_full.png');

console.log('Saved: storage/_debug_bbox_full.png');
console.log('\nSample (pixel coords at full res):');
r.rows.slice(0, 8).forEach(s => {
  const x = Math.round((s.bbox_x/1000)*W);
  const y = Math.round((s.bbox_y/1000)*H);
  const w = Math.round((s.bbox_w/1000)*W);
  const h = Math.round((s.bbox_h/1000)*H);
  console.log(`  [${x},${y} ${w}x${h}] ${s.symbol_name}`);
});
