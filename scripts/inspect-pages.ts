/**
 * OFFLINE ONLY — ANNOTATION ASSISTANCE
 * NOT GROUND TRUTH. NOT PRODUCTION DETECTION.
 *
 * Summarizes YOLO candidates to help a human inspect rendered pages.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runYoloInference } from '../lib/detection/yolo/yolo-inference';

const pages = [
  { id: 'sheet-1-p1', path: 'fixtures/pid-eval/sheet-1/page_1.png' },
  { id: 'sheet-2-p1', path: 'fixtures/pid-eval/sheet-2/page_1.png' },
  { id: 'sheet-3-p1', path: 'fixtures/pid-eval/sheet-3/page_1.png' },
  { id: 'sheet-4-p1', path: 'fixtures/pid-eval/sheet-4/page_1.png' },
  { id: 'sheet-5-p1', path: 'fixtures/pid-eval/sheet-5/page_1.png' },
  { id: 'sheet-7-p1', path: 'fixtures/pid-eval/sheet-7/page_1.png' },
  { id: 'sheet-7-model-p1', path: 'fixtures/pid-eval/sheet-7-model/page_1.png' },
  { id: 'sheet-7-rev-p1', path: 'fixtures/pid-eval/sheet-7-rev/page_1.png' },
  { id: 'sheet-11-p1', path: 'fixtures/pid-eval/sheet-11/page_1.png' },
  { id: 'sheet-12-p1', path: 'fixtures/pid-eval/sheet-12/page_1.png' },
  { id: 'fire-water-p1', path: 'fixtures/pid-eval/fire-water/page_1.png' },
  { id: 'fire-water-p2', path: 'fixtures/pid-eval/fire-water/page_2.png' },
];

async function main() {
  console.log('=== YOLO INFERENCE SUMMARY ON 12 EVALUATION PAGES ===\n');
  const summary: Record<string, any> = {};

  for (const p of pages) {
    const fullPath = path.resolve(process.cwd(), p.path);
    if (!fs.existsSync(fullPath)) {
      console.log(`MISSING: ${p.path}`);
      continue;
    }
    const buf = fs.readFileSync(fullPath);
    const dets = await runYoloInference(buf, {
      config: { confidenceThreshold: 0.25, nmsIouThreshold: 0.5, maxDetections: 200 },
    });
    console.log(`Page ${p.id.padEnd(16)} -> ${dets.length} raw detections (conf >= 0.25)`);
    const byClass: Record<string, number> = {};
    for (const d of dets) {
      const k = `${d.canonicalLabel} (${d.canonicalClassId})`;
      byClass[k] = (byClass[k] || 0) + 1;
    }
    for (const [k, count] of Object.entries(byClass)) {
      console.log(`   ${k.padEnd(32)}: ${count}`);
    }
    summary[p.id] = dets.map((d) => ({
      classId: d.canonicalClassId,
      label: d.canonicalLabel,
      confidence: d.confidence,
      bbox: {
        x: Math.round(d.pixelBox.x1),
        y: Math.round(d.pixelBox.y1),
        width: Math.round(d.pixelBox.x2 - d.pixelBox.x1),
        height: Math.round(d.pixelBox.y2 - d.pixelBox.y1),
      },
    }));
  }

  fs.writeFileSync(
    path.resolve(process.cwd(), 'storage/yolo-candidates-all-pages.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log('\nWrote candidate detections to storage/yolo-candidates-all-pages.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
