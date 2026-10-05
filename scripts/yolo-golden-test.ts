/**
 * YOLO Golden Test — real ONNX inference against a P&ID fixture.
 *
 * Run: npx tsx --env-file=.env.local scripts/yolo-golden-test.ts
 *
 * Verifies end-to-end: PDF render -> letterbox -> ONNX inference ->
 * channel-major decode -> class-aware NMS -> inverse letterbox -> 0-1000 bbox.
 *
 * This runs OUTSIDE Jest because onnxruntime-node's native Float32Array check
 * fails under Jest's vm realm. Unit-level decode/NMS/letterbox coverage lives
 * in __tests__/yolo-decoder.test.ts and __tests__/yolo-class-map.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runYoloInference } from '../lib/detection/yolo/yolo-inference';
import { renderPageToPng } from '../lib/pdf-render';

const FIXTURE_PDF = path.resolve(
  __dirname,
  '../storage/18870d45-f7a6-497d-9f34-e0fabb45f53e-SP_PDT_Sheet_7-REV.pdf',
);

async function main() {
  console.log('=== YOLO GOLDEN TEST ===\n');

  if (!fs.existsSync(FIXTURE_PDF)) {
    console.error('Fixture PDF not found:', FIXTURE_PDF);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(FIXTURE_PDF);
  const { png, width, height } = await renderPageToPng(pdfBuffer, 1, 3.0);
  console.log(`Rendered page: ${width} x ${height} px`);

  const detections = await runYoloInference(png, {
    config: { confidenceThreshold: 0.30, nmsIouThreshold: 0.5, maxDetections: 100 },
  });

  console.log(`\nDetections: ${detections.length}\n`);
  console.log(
    'idx | class | label                    | conf  | bbox(0-1000)          | pixel',
  );
  console.log('-'.repeat(100));

  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    const b = d.bbox;
    const p = d.pixelBox;
    console.log(
      `${String(i).padStart(3)} | ${String(d.canonicalClassId).padStart(5)} | ` +
        `${d.canonicalLabel.padEnd(24)} | ${d.confidence.toFixed(3)} | ` +
        `(${b.x.toFixed(0).padStart(3)},${b.y.toFixed(0).padStart(3)},${b.width.toFixed(0).padStart(3)}x${b.height.toFixed(0).padStart(3)}) | ` +
        `(${p.x1.toFixed(0)},${p.y1.toFixed(0)})-(${p.x2.toFixed(0)},${p.y2.toFixed(0)})`,
    );
    if (d.wasDuplicate) {
      console.log(`      note: raw class ${d.rawClassId} (${d.rawLabel}) -> canonical ${d.canonicalClassId}`);
    }
  }

  // Invariant checks
  let ok = true;
  for (const d of detections) {
    if (d.canonicalClassId === 0) {
      console.error('FAIL: class 0 (Not_used) leaked through');
      ok = false;
    }
    if (d.bbox.x < 0 || d.bbox.y < 0 || d.bbox.width <= 0 || d.bbox.height <= 0) {
      console.error('FAIL: invalid bbox', d.bbox);
      ok = false;
    }
    if (d.bbox.x + d.bbox.width > 1000.5 || d.bbox.y + d.bbox.height > 1000.5) {
      console.error('FAIL: bbox exceeds 0-1000 space', d.bbox);
      ok = false;
    }
    if (d.pixelBox.x2 > width + 1 || d.pixelBox.y2 > height + 1) {
      console.error('FAIL: pixel bbox exceeds page bounds', d.pixelBox, { width, height });
      ok = false;
    }
  }

  console.log('\n' + (ok ? 'OK — all invariants hold' : 'FAILED — see errors above'));

  // Write a JSON artifact for inspection.
  const outPath = path.resolve(__dirname, '../storage/yolo-golden-test.json');
  fs.writeFileSync(outPath, JSON.stringify({ width, height, detections }, null, 2));
  console.log(`Artifact written: ${outPath}`);

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GOLDEN TEST ERROR:', e);
  process.exit(1);
});
