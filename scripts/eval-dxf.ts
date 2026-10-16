/**
 * DXF detection eval harness (Blok 2.2).
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/eval-dxf.ts [path-to.dxf]
 *   (defaults to storage/INTAN_GS file if present, else scratch/test-pid.dxf)
 *
 * No DB, no network, no AI calls — pure geometry metrics per run so
 * accuracy work can be compared across code changes:
 *   - detections, tagged %, UNKNOWN %, CONFLICT %
 *   - bbox source breakdown (cluster / circle / insert / proxy / estimated)
 *   - sliver boxes (clamped minimums — proxy artifacts)
 *   - top duplicated tags, per-region distribution
 *
 * Optional ground truth: --gt path.json  [{assetTag, pidPage, bbox:{x,y,width,height}}]
 * reports type-agnostic tag recall + bbox IoU stats for matched tags.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';
import { runDxfDetection } from '@/lib/dxf-detection';
import { isValidAssetTag, sanitizeAssetType } from '@/lib/validation';

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const gtIdx = process.argv.indexOf('--gt');
  const gtPath = gtIdx >= 0 ? process.argv[gtIdx + 1] : null;

  const fallback = resolve('scratch/test-pid.dxf');
  const intan = resolve('storage/9880cba6-3f38-4526-bea4-6d2a4b1d9bd6-INTAN_GS.dxf');
  const file = args[0] ?? (existsSync(intan) ? intan : fallback);
  if (!existsSync(file)) {
    console.error(`file not found: ${file}`);
    process.exit(1);
  }
  const buf = readFileSync(file);
  console.log(`file=${file} sizeKB=${Math.round(buf.length / 1024)}`);

  const parsed = parseDxf(buf);
  const regions = splitDxfRegions(parsed);
  console.log(`regions=${regions.length}`);

  const t0 = Date.now();
  const res = runDxfDetection(buf, []);
  const ms = Date.now() - t0;

  const dets = res.detections;
  const tagged = dets.filter((d) => d.assetTag);
  const unknown = dets.filter((d) => d.assetType === 'UNKNOWN');
  const conflict = dets.filter((d) => d.evidence.some((e) => e.includes('CONFLICT')));
  const src = { cluster: 0, circle: 0, insert: 0, proxy: 0, estimated: 0, other: 0 };
  let slivers = 0;
  for (const d of dets) {
    const ev = d.evidence.join(' // ');
    if (ev.includes('stroke cluster')) src.cluster++;
    else if (ev.includes('entity detected (r=')) src.circle++;
    else if (ev.includes('INSERT geometry') || ev.includes('block geometry')) src.insert++;
    else if (ev.includes('proxy') || ev.includes('equipment symbol geometry near tag')) src.proxy++;
    else if (ev.includes('estimated')) src.estimated++;
    else src.other++;
    if ((d.bbox.width <= 8 || d.bbox.height <= 8) && d.bbox.width * d.bbox.height <= 200) slivers++;
  }
  const perTag = new Map<string, number>();
  for (const d of tagged) {
    const k = `${(d.assetTag ?? '').toLowerCase()}|p${d.pidPage}`;
    perTag.set(k, (perTag.get(k) ?? 0) + 1);
  }
  const dupes = [...perTag.entries()].filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]).slice(0, 10);
  const perRegion = new Map<number, number>();
  for (const d of dets) perRegion.set(d.pidPage, (perRegion.get(d.pidPage) ?? 0) + 1);

  // Blok 6 validity: tags/types that the gates would reject at persist.
  const invalidTags = tagged.filter((d) => !isValidAssetTag(d.assetTag)).map((d) => d.assetTag);
  const junkTypes = dets.filter((d) => sanitizeAssetType(d.assetType) !== d.assetType).length;
  const metrics = {
    durationMs: ms,
    detections: dets.length,
    taggedPct: dets.length ? +(tagged.length / dets.length * 100).toFixed(1) : 0,
    unknownPct: dets.length ? +(unknown.length / dets.length * 100).toFixed(1) : 0,
    conflictCount: conflict.length,
    invalidTagCount: invalidTags.length,
    invalidTagSamples: [...new Set(invalidTags)].slice(0, 10),
    junkTypeCount: junkTypes,
    bboxSource: src,
    sliverCount: slivers,
    perRegion: Object.fromEntries(perRegion),
    regions: res.regions.map((r) => ({ pid: r.pidPage, ents: r.entityCount, tags: r.textTagsFound })),
    parseStats: res.parseStats,
    topDupes: dupes.map(([k, n]) => `${k} x${n}`),
  };
  console.log(JSON.stringify(metrics, null, 1));

  if (gtPath) {
    if (!existsSync(gtPath)) { console.error(`gt not found: ${gtPath}`); process.exit(1); }
    const gt = JSON.parse(readFileSync(gtPath, 'utf-8')) as Array<{
      assetTag: string; pidPage: number; bbox: { x: number; y: number; width: number; height: number };
    }>;
    let matched = 0;
    const ious: number[] = [];
    for (const g of gt) {
      const cands = dets.filter(
        (d) => (d.assetTag ?? '').toLowerCase() === g.assetTag.toLowerCase() && d.pidPage === g.pidPage,
      );
      if (cands.length === 0) continue;
      matched++;
      ious.push(Math.max(...cands.map((c) => iou(c.bbox, g.bbox))));
    }
    const meanIoU = ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0;
    console.log(JSON.stringify({
      gtTotal: gt.length,
      tagRecallPct: gt.length ? +(matched / gt.length * 100).toFixed(1) : 0,
      meanIoU: +meanIoU.toFixed(3),
      iouGe05Pct: ious.length ? +(ious.filter((v) => v >= 0.5).length / ious.length * 100).toFixed(1) : 0,
    }, null, 1));
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
