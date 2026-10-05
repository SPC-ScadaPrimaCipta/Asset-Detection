/**
 * YOLO Golden Test — visual crop verification.
 *
 * Run: npx tsx --env-file=.env.local scripts/yolo-golden-crops.ts
 *
 * Re-runs inference on the fixture page, then writes one PNG crop per detection
 * (padded for context) plus a full-page PNG with all boxes drawn, so the
 * detections can be verified against the actual P&ID symbols by eye.
 *
 * Output: storage/yolo-verify/
 */

import * as fs from 'fs';
import * as path from 'path';
import { runYoloInference } from '../lib/detection/yolo/yolo-inference';
import { renderPageToPng } from '../lib/pdf-render';
import sharp from 'sharp';

const FIXTURE_PDF = path.resolve(
  __dirname,
  '../storage/18870d45-f7a6-497d-9f34-e0fabb45f53e-SP_PDT_Sheet_7-REV.pdf',
);
const OUT_DIR = path.resolve(__dirname, '../storage/yolo-verify');

/** Padding (px) added around each crop so the symbol sits in context. */
const CROP_PAD = 60;

async function main() {
  console.log('=== YOLO GOLDEN CROPS ===\n');

  if (!fs.existsSync(FIXTURE_PDF)) {
    console.error('Fixture PDF not found:', FIXTURE_PDF);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pdfBuffer = fs.readFileSync(FIXTURE_PDF);
  const { png, width, height } = await renderPageToPng(pdfBuffer, 1, 3.0);
  console.log(`Rendered page: ${width} x ${height} px\n`);

  const detections = await runYoloInference(png, {
    config: { confidenceThreshold: 0.30, nmsIouThreshold: 0.5, maxDetections: 100 },
  });

  // --- Full page with boxes drawn as SVG overlay -------------------------
  const rects = detections
    .map((d, i) => {
      const p = d.pixelBox;
      const color = d.canonicalClassId === 22 ? '#ff0000' : d.canonicalClassId === 21 ? '#0066ff' : '#00aa00';
      return (
        `<rect x="${p.x1}" y="${p.y1}" width="${p.x2 - p.x1}" height="${p.y2 - p.y1}" ` +
        `fill="none" stroke="${color}" stroke-width="6"/>` +
        `<text x="${p.x1}" y="${Math.max(40, p.y1 - 12)}" font-size="44" fill="${color}" ` +
        `font-family="monospace">${i}:${d.canonicalLabel} ${d.confidence.toFixed(2)}</text>`
      );
    })
    .join('');

  const overlaySvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`,
  );

  await sharp(png)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .png()
    .toFile(path.join(OUT_DIR, 'full-page-annotated.png'));
  console.log('Wrote full-page-annotated.png');

  // --- Per-detection crops ------------------------------------------------
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    const p = d.pixelBox;
    const left = Math.max(0, Math.floor(p.x1 - CROP_PAD));
    const top = Math.max(0, Math.floor(p.y1 - CROP_PAD));
    const right = Math.min(width, Math.ceil(p.x2 + CROP_PAD));
    const bottom = Math.min(height, Math.ceil(p.y2 + CROP_PAD));

    // Box drawn relative to the crop origin.
    const boxSvg = Buffer.from(
      `<svg width="${right - left}" height="${bottom - top}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${p.x1 - left}" y="${p.y1 - top}" width="${p.x2 - p.x1}" height="${p.y2 - p.y1}" ` +
        `fill="none" stroke="#ff0000" stroke-width="2"/></svg>`,
    );

    const name = `${String(i).padStart(2, '0')}_cls${d.canonicalClassId}_${d.canonicalLabel}_conf${d.confidence.toFixed(2)}.png`;
    await sharp(png)
      .extract({ left, top, width: right - left, height: bottom - top })
      .composite([{ input: boxSvg, top: 0, left: 0 }])
      .png()
      .toFile(path.join(OUT_DIR, name));
  }

  console.log(`Wrote ${detections.length} crops to ${OUT_DIR}`);
  console.log('\nCrops:');
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    console.log(
      `  ${String(i).padStart(2)} cls=${String(d.canonicalClassId).padStart(2)} ` +
        `${d.canonicalLabel.padEnd(22)} conf=${d.confidence.toFixed(3)} ` +
        `px=(${d.pixelBox.x1.toFixed(0)},${d.pixelBox.y1.toFixed(0)})-(${d.pixelBox.x2.toFixed(0)},${d.pixelBox.y2.toFixed(0)})`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('CROP TEST ERROR:', e);
  process.exit(1);
});
