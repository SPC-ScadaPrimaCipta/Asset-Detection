/**
 * Gemini Vision Detection Benchmark
 *
 * Measures Precision, Recall, F1 of the current pipeline against a manual
 * ground truth JSON file.
 *
 * Usage:
 *   npm run benchmark                              # uses eval/ground-truth.json
 *   npm run benchmark eval/my-ground-truth.json   # custom GT file
 *
 * Ground truth format: see eval/ground-truth.json
 *
 * Match rules:
 *   - Primary key: assetTag (case-insensitive, trimmed)
 *   - If both GT and detection have bbox: also require IoU >= 0.5
 *   - If either bbox is null: tag match only
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ── Load .env.local before any imports that need DB ─────────────────────────
function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}
loadEnvFiles();

// ── Types ────────────────────────────────────────────────────────────────────

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GTAsset {
  assetTag: string;
  assetType: string;
  bbox: BBox | null;
  _comment?: string;
}

interface GroundTruth {
  _instructions?: string;
  document: string;
  page: number;
  assets: GTAsset[];
}

interface DetectionRow {
  asset_tag: string | null;
  asset_type: string;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  confidence: number | null;
  validation_status: string | null;
}

interface MatchResult {
  gtTag: string;
  detTag: string | null;
  iou: number | null;
  matched: boolean;
  reason: string;
}

interface BenchmarkResult {
  document: string;
  page: number;
  gtCount: number;
  detCount: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  truePositives: MatchResult[];
  falsePositives: { tag: string | null; assetType: string; confidence: number | null; validationStatus: string | null }[];
  falseNegatives: { tag: string; assetType: string }[];
  timestamp: string;
}

// ── IoU helper (0-1000 space) ─────────────────────────────────────────────────

function bboxIou(a: BBox, b: BBox): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const intersection = iw * ih;
  if (intersection === 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return intersection / (aArea + bArea - intersection);
}

function detBBox(row: DetectionRow): BBox | null {
  if (
    row.bbox_x == null || row.bbox_y == null ||
    row.bbox_w == null || row.bbox_h == null
  ) return null;
  return { x: row.bbox_x, y: row.bbox_y, width: row.bbox_w, height: row.bbox_h };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const gtPath = process.argv[2] ?? path.join('eval', 'ground-truth.json');
  const absGtPath = path.resolve(process.cwd(), gtPath);

  if (!fs.existsSync(absGtPath)) {
    console.error(`Ground truth file not found: ${absGtPath}`);
    console.error('Create eval/ground-truth.json from the template, or pass a path as first argument.');
    process.exit(1);
  }

  const gt: GroundTruth = JSON.parse(fs.readFileSync(absGtPath, 'utf-8'));

  if (!gt.document || !gt.page || !Array.isArray(gt.assets)) {
    console.error('Invalid ground truth format. Required fields: document, page, assets[]');
    process.exit(1);
  }

  // Filter out template placeholder entries
  const gtAssets = gt.assets.filter((a) => !a._comment && a.assetTag && a.assetTag !== 'TAG-001');
  if (gtAssets.length === 0) {
    console.error('No real assets in ground truth. Fill in eval/ground-truth.json with actual annotated assets.');
    process.exit(1);
  }

  console.log(`\n=== Gemini Vision Benchmark ===`);
  console.log(`Ground truth: ${absGtPath}`);
  console.log(`Document: ${gt.document}`);
  console.log(`Page: ${gt.page}`);
  console.log(`GT assets: ${gtAssets.length}\n`);

  // ── Query DB ───────────────────────────────────────────────────────────────
  const { default: db } = await import('../lib/db');

  // Find document by filename
  const docResult = await db.query(
    `SELECT id FROM documents WHERE filename ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
    [`%${gt.document}%`],
  );

  if (docResult.rows.length === 0) {
    console.error(`Document not found in DB: ${gt.document}`);
    console.error('Run detection on this document first, then re-run benchmark.');
    process.exit(1);
  }

  const documentId = docResult.rows[0].id as string;
  console.log(`Document ID: ${documentId}`);

  const detResult = await db.query<DetectionRow>(
    `SELECT asset_tag, asset_type, bbox_x, bbox_y, bbox_w, bbox_h, confidence, validation_status
       FROM detections
      WHERE document_id = $1
        AND page = $2
        AND detection_status != 'REJECTED'
      ORDER BY confidence DESC NULLS LAST`,
    [documentId, gt.page],
  );

  const detections = detResult.rows;
  console.log(`Detections in DB: ${detections.length}\n`);

  // ── Match GT vs detections ─────────────────────────────────────────────────
  const IOU_THRESHOLD = 0.5;
  const usedDetIdx = new Set<number>();
  const tpMatches: MatchResult[] = [];
  const fnAssets: { tag: string; assetType: string }[] = [];

  for (const gtAsset of gtAssets) {
    const gtTag = gtAsset.assetTag.toUpperCase().trim();
    let matched = false;

    for (let di = 0; di < detections.length; di++) {
      if (usedDetIdx.has(di)) continue;
      const det = detections[di];
      const detTag = (det.asset_tag ?? '').toUpperCase().trim();

      if (detTag === '' || detTag !== gtTag) continue;

      // Tag matched — check IoU if both have bbox
      const gtBbox = gtAsset.bbox;
      const detBbox = detBBox(det);

      let iou: number | null = null;
      if (gtBbox && detBbox) {
        iou = bboxIou(gtBbox, detBbox);
        if (iou < IOU_THRESHOLD) continue; // IoU too low — not a TP
      }

      usedDetIdx.add(di);
      matched = true;
      tpMatches.push({
        gtTag: gtAsset.assetTag,
        detTag: det.asset_tag,
        iou,
        matched: true,
        reason: iou != null ? `tag match + IoU ${iou.toFixed(2)}` : 'tag match (no bbox)',
      });
      break;
    }

    if (!matched) {
      fnAssets.push({ tag: gtAsset.assetTag, assetType: gtAsset.assetType });
    }
  }

  // False positives: detections not matched to any GT
  const fpDetections = detections
    .filter((_, i) => !usedDetIdx.has(i))
    .map((d) => ({
      tag: d.asset_tag,
      assetType: d.asset_type,
      confidence: d.confidence,
      validationStatus: d.validation_status,
    }));

  const tp = tpMatches.length;
  const fp = fpDetections.length;
  const fn = fnAssets.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  // ── Print report ───────────────────────────────────────────────────────────
  console.log(`Ground Truth: ${gtAssets.length} assets`);
  console.log(`Detected:     ${detections.length} assets\n`);
  console.log(`TP: ${tp}  FP: ${fp}  FN: ${fn}`);
  console.log(`Precision: ${precision.toFixed(3)}  Recall: ${recall.toFixed(3)}  F1: ${f1.toFixed(3)}\n`);

  if (tpMatches.length > 0) {
    console.log('True Positives:');
    for (const m of tpMatches) {
      console.log(`  ✓ ${m.gtTag} (${m.reason})`);
    }
    console.log('');
  }

  if (fpDetections.length > 0) {
    console.log('False Positives (detected but not in GT):');
    for (const fp of fpDetections.slice(0, 20)) {
      const conf = fp.confidence != null ? ` conf=${(fp.confidence * 100).toFixed(0)}%` : '';
      console.log(`  ✗ ${fp.tag ?? '(untagged)'} — ${fp.assetType}${conf}`);
    }
    if (fpDetections.length > 20) console.log(`  ... and ${fpDetections.length - 20} more`);
    console.log('');
  }

  if (fnAssets.length > 0) {
    console.log('False Negatives (in GT but not detected):');
    for (const fn of fnAssets) {
      console.log(`  ✗ ${fn.tag} (${fn.assetType})`);
    }
    console.log('');
  }

  // ── Save result ─────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join('eval', `benchmark-result-${timestamp}.json`);
  const result: BenchmarkResult = {
    document: gt.document,
    page: gt.page,
    gtCount: gtAssets.length,
    detCount: detections.length,
    tp, fp, fn,
    precision, recall, f1,
    truePositives: tpMatches,
    falsePositives: fpDetections,
    falseNegatives: fnAssets,
    timestamp: new Date().toISOString(),
  };

  fs.mkdirSync('eval', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Saved: ${outPath}`);

  await db.end?.();
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
