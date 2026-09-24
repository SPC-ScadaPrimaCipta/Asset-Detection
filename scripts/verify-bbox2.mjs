import { Pool } from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import * as mupdf from 'mupdf';
import sharp from 'sharp';

// Render PDF
const pdfBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
const page = doc.loadPage(0);
const pixmap = page.toPixmap(mupdf.Matrix.scale(2.5, 2.5), mupdf.ColorSpace.DeviceRGB, false);
const pngBuf = Buffer.from(pixmap.asPNG());
const W = pixmap.getWidth(), H = pixmap.getHeight();

// Save PNG for reference
writeFileSync('storage/_verify_legend.png', pngBuf);

// Get symbols
const pool = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const r = await pool.query(
  "SELECT symbol_name, asset_type, bbox_x, bbox_y, bbox_w, bbox_h FROM legend_symbols WHERE legend_id='7045609b-cede-4509-b480-4d5a555f3fd7' AND bbox_x IS NOT NULL ORDER BY bbox_y, bbox_x"
);
await pool.end();

// Build HTML with overlaid boxes
const boxesJson = JSON.stringify(r.rows.map(s => ({
  name: s.symbol_name,
  type: s.asset_type,
  x: s.bbox_x, y: s.bbox_y, w: s.bbox_w, h: s.bbox_h
})));

const html = `<!DOCTYPE html>
<html>
<head><title>BBox Verification</title>
<style>body{margin:0;background:#1a1a1a;display:flex;flex-direction:column;align-items:center;padding:20px;font-family:sans-serif}
h2{color:#fff;margin-bottom:10px}
.info{color:#aaa;margin-bottom:16px;font-size:13px}
.container{position:relative;display:inline-block}
canvas{display:block;border:1px solid #444}
.overlay{position:absolute;top:0;left:0;pointer-events:none}
</style></head>
<body>
<h2>Legend BBox Verification</h2>
<div class="info">Page render: ${W}x${H}px | Symbols: ${r.rows.length} | Scale 2.5x</div>
<div class="container">
  <canvas id="c"></canvas>
  <canvas id="overlay" class="overlay"></canvas>
</div>
<script>
const SYMBOLS = ${boxesJson};
const W = ${W}, H = ${H};

// Load PNG
const img = new Image();
img.onload = () => {
  const SCALE = Math.min(1, 1400 / W);
  const dW = Math.round(W * SCALE), dH = Math.round(H * SCALE);

  const c = document.getElementById('c');
  c.width = dW; c.height = dH;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, dW, dH);

  const ov = document.getElementById('overlay');
  ov.width = dW; ov.height = dH;
  ov.style.width = dW + 'px';
  ov.style.height = dH + 'px';
  const ovCtx = ov.getContext('2d');

  SYMBOLS.forEach(s => {
    const x = (s.x / 1000) * dW;
    const y = (s.y / 1000) * dH;
    const w = Math.max(3, (s.w / 1000) * dW);
    const h = Math.max(3, (s.h / 1000) * dH);
    ovCtx.strokeStyle = 'rgba(255,50,50,0.9)';
    ovCtx.lineWidth = 2;
    ovCtx.strokeRect(x, y, w, h);
    ovCtx.fillStyle = 'rgba(255,50,50,0.12)';
    ovCtx.fillRect(x, y, w, h);
    ovCtx.fillStyle = 'blue';
    ovCtx.font = 'bold 10px Arial';
    ovCtx.fillText(s.name?.slice(0,22) ?? '', x+2, y > 12 ? y - 2 : y + h + 10);
  });
};
img.src = '/_verify_legend.png';
</script>
</body></html>`;

writeFileSync('public/_verify_legend.html', html);

// Also save a downscaled PNG with boxes drawn using jimp-free approach
// Just output pixel coords for manual check
console.log(`PNG: ${W}x${H} | Symbols: ${r.rows.length}`);
console.log('\nTop 10 symbols (pixel coords at full res):');
r.rows.slice(0, 10).forEach(s => {
  const px = Math.round((s.bbox_x/1000)*W);
  const py = Math.round((s.bbox_y/1000)*H);
  const pw = Math.round((s.bbox_w/1000)*W);
  const ph = Math.round((s.bbox_h/1000)*H);
  console.log(`  [${px},${py} ${pw}x${ph}] "${s.symbol_name}"`);
});

console.log('\nVisualization: open http://localhost:3000/_verify_legend.html');
console.log('(uses /_verify_legend.png served from /public)');

// Actually serve PNG via /storage path — move to public
import { copyFileSync } from 'fs';
copyFileSync('storage/_verify_legend.png', 'public/_verify_legend.png');
console.log('PNG copied to public/_verify_legend.png');
