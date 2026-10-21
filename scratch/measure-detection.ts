/**
 * Scratch: measure DXF detection output (duplicates + tags) for before/after
 * comparison while improving accuracy. Not part of the test suite.
 *
 * Usage: npx tsx scratch/measure-detection.ts [filename]
 */
import { readFileSync } from 'node:fs';
import { runDxfDetection } from '../lib/dxf-detection';

const file = process.argv[2] ?? 'storage/702b312c-ff9c-43d6-a983-58fd5344625f-INTAN_GS_SHEET_5.dxf';
const buf = readFileSync(file);

// Empty legend = pure fallback-regex candidate extraction (shows what the
// pipeline can even see before legend tag-pattern validation).
const result = runDxfDetection(buf, []);

const dets = result.detections;
const withTag = dets.filter((d) => d.assetTag);
const tagCounts = new Map<string, number>();
for (const d of withTag) {
  const k = d.assetTag!.trim().toUpperCase();
  tagCounts.set(k, (tagCounts.get(k) ?? 0) + 1);
}
const repeatedTags = [...tagCounts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

function iou(a: { x: number; y: number; width: number; height: number }, b: typeof a): number {
  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.width, b.x + b.width), iy1 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

// Overlapping box pairs regardless of tag = duplicate candidates.
let overlapPairs = 0;
for (let i = 0; i < dets.length; i++) {
  for (let j = i + 1; j < dets.length; j++) {
    if (dets[i].pidPage !== dets[j].pidPage) continue;
    if (iou(dets[i].bbox, dets[j].bbox) >= 0.6) overlapPairs++;
  }
}

console.log('=== DXF detection baseline ===');
console.log('file:', file);
console.log('total detections:', dets.length);
console.log('with tag:', withTag.length, '| without tag:', dets.length - withTag.length);
console.log('overlapping pairs (IoU>=0.6, any tag):', overlapPairs);
console.log('repeated tag count:', repeatedTags.length);
console.log('top repeated tags:');
for (const [k, n] of repeatedTags.slice(0, 15)) console.log(`  ${k} x${n}`);
console.log('parseStats:', JSON.stringify(result.parseStats));

console.log('\n--- overlapping pairs (IoU>=0.6) ---');
for (let i = 0; i < dets.length; i++) {
  for (let j = i + 1; j < dets.length; j++) {
    if (dets[i].pidPage !== dets[j].pidPage) continue;
    const v = iou(dets[i].bbox, dets[j].bbox);
    if (v < 0.6) continue;
    const f = (d: (typeof dets)[number]) =>
      `[${d.source}] tag=${d.assetTag ?? '-'} type=${d.assetType} conf=${d.confidence.toFixed(2)} bbox=${Math.round(d.bbox.x)},${Math.round(d.bbox.y)},${Math.round(d.bbox.width)}x${Math.round(d.bbox.height)}`;
    console.log(`IoU=${v.toFixed(2)}`);
    console.log('   A', f(dets[i]));
    console.log('   B', f(dets[j]));
  }
}

for (const [tag] of repeatedTags.slice(0, 6)) {
  console.log(`\n--- tag ${tag} ---`);
  for (const d of dets.filter((x) => x.assetTag?.trim().toUpperCase() === tag)) {
    console.log(`  [${d.source}] conf=${d.confidence.toFixed(2)} bbox=${Math.round(d.bbox.x)},${Math.round(d.bbox.y)},${Math.round(d.bbox.width)}x${Math.round(d.bbox.height)} layer=${d.layer} block=${d.blockName ?? '-'}`);
  }
}
