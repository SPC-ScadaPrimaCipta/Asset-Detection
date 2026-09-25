import sharp from 'sharp';
import { Pool } from 'pg';
import { readFileSync, writeFileSync } from 'fs';

const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const r = await pool.query(
  "SELECT symbol_name, bbox_x, bbox_y, bbox_w, bbox_h FROM legend_symbols WHERE legend_id='7045609b-cede-4509-b480-4d5a555f3fd7' AND bbox_x IS NOT NULL ORDER BY bbox_y, bbox_x"
);
await pool.end();

const pngBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7-p1-ff5b69cc66bb.png');
const meta = await sharp(pngBuf).metadata();
const W = meta.width ?? 1000;
const H = meta.height ?? 1000;

console.log(`Image: ${W}x${H}, symbols: ${r.rows.length}`);

// Build SVG overlay
const svgRects = r.rows.map(s => {
  const x = Math.round((s.bbox_x / 1000) * W);
  const y = Math.round((s.bbox_y / 1000) * H);
  const w = Math.max(4, Math.round((s.bbox_w / 1000) * W));
  const h = Math.max(4, Math.round((s.bbox_h / 1000) * H));
  const label = (s.symbol_name ?? '').slice(0, 20).replace(/[<>&"]/g, '');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="red" stroke-width="2"/>
<text x="${x}" y="${y > 12 ? y - 2 : y + h + 10}" font-size="7" fill="blue" font-family="sans-serif">${label}</text>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svgRects}</svg>`;

await sharp(pngBuf)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toFile('storage/_debug_bbox_refined.png');

console.log('Saved: storage/_debug_bbox_refined.png');
console.log('Sample boxes:');
r.rows.slice(0, 5).forEach(s => {
  const x = Math.round((s.bbox_x/1000)*W);
  const y = Math.round((s.bbox_y/1000)*H);
  const w = Math.round((s.bbox_w/1000)*W);
  const h = Math.round((s.bbox_h/1000)*H);
  console.log(`  ${s.symbol_name}: pixel(${x},${y} ${w}x${h})`);
});
