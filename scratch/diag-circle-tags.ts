/**
 * Scratch: why do distant CIRCLEs pick up a tag? Print tag + positions + radius.
 * Usage: npx tsx scratch/diag-circle-tags.ts [filename]
 */
import { readFileSync } from 'node:fs';
import { runDxfDetection } from '../lib/dxf-detection';

const file = process.argv[2] ?? 'storage/702b312c-ff9c-43d6-a983-58fd5344625f-INTAN_GS_SHEET_5.dxf';
const result = runDxfDetection(readFileSync(file), []);

for (const d of result.detections) {
  if (d.source !== 'CIRCLE') continue;
  const c = { x: d.bbox.x + d.bbox.width / 2, y: d.bbox.y + d.bbox.height / 2 };
  console.log(
    `tag=${d.assetTag ?? '-'} conf=${d.confidence.toFixed(2)} center=${Math.round(c.x)},${Math.round(c.y)} ` +
    `wh=${Math.round(d.bbox.width)}x${Math.round(d.bbox.height)} inside=${d.tagInsideSymbol ?? false} layer=${d.layer.split('$0$').pop()} ` +
    `pos=${Math.round(d.rawPosition.x)},${Math.round(d.rawPosition.y)}`,
  );
}
