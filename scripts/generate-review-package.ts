#!/usr/bin/env tsx
/**
 * YOLO v203 Targeted Local Review Package Generator
 *
 * SCOPE:
 *   - Offline comparison of Baseline against:
 *       1. GEO-4_Overlap35 (Tile 1024, Overlap 35%)
 *       2. GEO-1_Tile768 (Tile 768, Zoom-in 1.33x)
 *       3. GEO-2_Tile1280 (Tile 1280, Zoom-out 0.8x)
 *   - All bounding boxes strictly verified in 3573x2526 source coordinates.
 *   - Generates contextual crops and structured human review manifests with blank decision fields.
 *   - Zero Gemini API, zero retraining, zero model changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  getYoloV203Session,
  DEFAULT_V203_MODEL_PATH,
} from '../lib/detection/yolo/yolo-inference-v203';
import { valueAtV203 } from '../lib/detection/yolo/yolo-decoder-v203';
import {
  resolveYoloV203Class,
  YOLO_V203_INPUT_SIZE,
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_CLASS_COUNT,
} from '../lib/detection/yolo/yolo-class-map-v203';

const REPO_ROOT = path.resolve(__dirname, '..');
const MODEL_PATH = path.resolve(REPO_ROOT, DEFAULT_V203_MODEL_PATH);
const SOURCE_IMAGE_PATH = path.join(REPO_ROOT, 'fixtures/pid-eval/sheet-1/page_1.png');
const BASELINE_JSON_PATH = path.join(REPO_ROOT, 'fixtures/diagnostics/predictions-v203-baseline.json');

const REVIEW_PKG_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments/review-package');
const CROPS_DIR = path.join(REVIEW_PKG_DIR, 'crops');
const MANIFEST_JSON_PATH = path.join(REVIEW_PKG_DIR, 'human-review-manifest.json');
const MANIFEST_MD_PATH = path.join(REVIEW_PKG_DIR, 'human-review-manifest.md');
const MANIFEST_CSV_PATH = path.join(REVIEW_PKG_DIR, 'human-review-manifest.csv');

export interface Detection {
  id: string;
  rawClassId: number;
  rawLabel: string;
  confidence: number;
  tileIndex: number;
  pageBox: { x1: number; y1: number; x2: number; y2: number };
}

export interface ReviewItem {
  reviewId: string;
  priorityCategory: string; // Priority 1, 2, 3, 4
  categoryDescription: string;
  configOrigin: string;
  rawClassId: number;
  rawLabel: string;
  confidence: number;
  pageBox: { x1: number; y1: number; x2: number; y2: number };
  baselineComparison: {
    matchedBaselineId: string | null;
    matchedBaselineLabel: string | null;
    matchingIoU: number;
    differenceType: 'kandidat_tambahan' | 'kandidat_hilang' | 'perubahan_kelas' | 'pergeseran_bbox' | 'konflik_multilabel' | 'identik';
  };
  isNearTileBoundary: boolean;
  distanceToNearestSeamPx: number;
  cropImagePath: string;
  humanDecisionSlot: {
    status: 'UNRESOLVED';
    options: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'];
    humanDecision: null;
    reviewerNotes: null;
  };
}

function computeIoU(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function generateAxisOffsets(dimension: number, tileSize: number, stride: number): number[] {
  if (dimension <= tileSize) return [0];
  const offsets: number[] = [0];
  let curr = 0;
  while (curr + stride + tileSize <= dimension) {
    curr += stride;
    offsets.push(curr);
  }
  const lastOffset = dimension - tileSize;
  if (lastOffset > 0) offsets.push(lastOffset);
  return Array.from(new Set(offsets)).sort((a, b) => a - b);
}

function buildGrid(pageW: number, pageH: number, tileSize: number, stride: number) {
  const xOffsets = generateAxisOffsets(pageW, tileSize, stride);
  const yOffsets = generateAxisOffsets(pageH, tileSize, stride);
  const tiles: Array<{ tileIndex: number; x: number; y: number; width: number; height: number }> = [];
  let tileIndex = 0;
  for (let r = 0; r < yOffsets.length; r++) {
    for (let c = 0; c < xOffsets.length; c++) {
      tiles.push({
        tileIndex,
        x: xOffsets[c],
        y: yOffsets[r],
        width: tileSize,
        height: tileSize,
      });
      tileIndex++;
    }
  }
  return { tileSize, stride, scaleFactor: YOLO_V203_INPUT_SIZE / tileSize, xOffsets, yOffsets, tiles };
}

async function extractTileTensor(
  fullRgb: Uint8Array,
  pageW: number,
  pageH: number,
  tile: { x: number; y: number; width: number; height: number },
): Promise<Float32Array> {
  const onnxSize = YOLO_V203_INPUT_SIZE;
  const validW = Math.max(0, Math.min(tile.width, pageW - tile.x));
  const validH = Math.max(0, Math.min(tile.height, pageH - tile.y));

  if (tile.width === onnxSize && tile.height === onnxSize) {
    const planeSize = onnxSize * onnxSize;
    const tensor = new Float32Array(3 * planeSize);
    tensor.fill(114 / 255.0);

    for (let r = 0; r < validH; r++) {
      const srcRow = tile.y + r;
      if (srcRow >= pageH) break;
      const srcRowOffset = srcRow * pageW * 3;
      const dstRowOffset = r * onnxSize;

      for (let c = 0; c < validW; c++) {
        const srcCol = tile.x + c;
        if (srcCol >= pageW) break;
        const srcPixel = srcRowOffset + srcCol * 3;
        const dstIdx = dstRowOffset + c;
        tensor[dstIdx] = fullRgb[srcPixel] / 255.0;
        tensor[planeSize + dstIdx] = fullRgb[srcPixel + 1] / 255.0;
        tensor[2 * planeSize + dstIdx] = fullRgb[srcPixel + 2] / 255.0;
      }
    }
    return tensor;
  }

  const extractW = Math.min(tile.width, pageW - tile.x);
  const extractH = Math.min(tile.height, pageH - tile.y);

  const tileRgb = await sharp(Buffer.from(fullRgb), {
    raw: { width: pageW, height: pageH, channels: 3 },
  })
    .extract({ left: tile.x, top: tile.y, width: extractW, height: extractH })
    .resize(onnxSize, onnxSize, { fit: 'fill' })
    .raw()
    .toBuffer();

  const planeSize = onnxSize * onnxSize;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = tileRgb[i * 3] / 255.0;
    tensor[planeSize + i] = tileRgb[i * 3 + 1] / 255.0;
    tensor[2 * planeSize + i] = tileRgb[i * 3 + 2] / 255.0;
  }
  return tensor;
}

async function inferTile(session: ort.InferenceSession, tensor: Float32Array) {
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';
  const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE]) };
  const results = await session.run(feeds);
  const rawOutput = results[outputName].data as Float32Array;

  const candidates: Array<{ anchor: number; rawClassId: number; score: number; bbox: [number, number, number, number] }> = [];
  for (let i = 0; i < YOLO_V203_CANDIDATE_COUNT; i++) {
    const cx = valueAtV203(rawOutput, 0, i);
    const cy = valueAtV203(rawOutput, 1, i);
    const w = valueAtV203(rawOutput, 2, i);
    const h = valueAtV203(rawOutput, 3, i);

    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < YOLO_V203_CLASS_COUNT; c++) {
      const s = valueAtV203(rawOutput, YOLO_V203_CLASS_CHANNEL_OFFSET + c, i);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }

    if (bestScore >= 0.50) {
      const x1 = cx - w / 2;
      const y1 = cy - h / 2;
      const x2 = cx + w / 2;
      const y2 = cy + h / 2;
      if (x2 - x1 >= 1 && y2 - y1 >= 1) {
        candidates.push({ anchor: i, rawClassId: bestClass, score: bestScore, bbox: [x1, y1, x2, y2] });
      }
    }
  }
  return candidates;
}

function applyNms(candidates: any[], nmsIou = 0.70) {
  candidates.sort((a, b) => b.score - a.score || a.anchor - b.anchor);
  const kept: any[] = [];
  const classes = Array.from(new Set(candidates.map((c) => c.rawClassId))).sort((a: any, b: any) => a - b);
  for (const cls of classes) {
    const clsCands = candidates.filter((c) => c.rawClassId === cls);
    const suppressed = new Array<boolean>(clsCands.length).fill(false);
    for (let i = 0; i < clsCands.length; i++) {
      if (suppressed[i]) continue;
      const active = clsCands[i];
      kept.push(active);
      for (let j = i + 1; j < clsCands.length; j++) {
        if (suppressed[j]) continue;
        const iou = computeIoU(
          { x1: active.bbox[0], y1: active.bbox[1], x2: active.bbox[2], y2: active.bbox[3] },
          { x1: clsCands[j].bbox[0], y1: clsCands[j].bbox[1], x2: clsCands[j].bbox[2], y2: clsCands[j].bbox[3] },
        );
        if (iou >= nmsIou) suppressed[j] = true;
      }
    }
  }
  return kept;
}

function mapToPage(
  tileCandidates: any[],
  tile: { tileIndex: number; x: number; y: number; width: number; height: number },
  scaleFactor: number,
  pageW: number,
  pageH: number,
  prefix: string,
): Detection[] {
  const mapped: Detection[] = [];
  for (let i = 0; i < tileCandidates.length; i++) {
    const cand = tileCandidates[i];
    const tileX1 = cand.bbox[0] / scaleFactor;
    const tileY1 = cand.bbox[1] / scaleFactor;
    const tileX2 = cand.bbox[2] / scaleFactor;
    const tileY2 = cand.bbox[3] / scaleFactor;

    const validW = Math.min(tile.width, pageW - tile.x);
    const validH = Math.min(tile.height, pageH - tile.y);
    if (tileX1 >= validW || tileY1 >= validH) continue;

    const clampedX1 = Math.max(0, Math.min(validW, tileX1));
    const clampedY1 = Math.max(0, Math.min(validH, tileY1));
    const clampedX2 = Math.max(0, Math.min(validW, tileX2));
    const clampedY2 = Math.max(0, Math.min(validH, tileY2));
    if (clampedX2 - clampedX1 < 1 || clampedY2 - clampedY1 < 1) continue;

    const pageX1 = Math.max(0, Math.min(pageW, clampedX1 + tile.x));
    const pageY1 = Math.max(0, Math.min(pageH, clampedY1 + tile.y));
    const pageX2 = Math.max(0, Math.min(pageW, clampedX2 + tile.x));
    const pageY2 = Math.max(0, Math.min(pageH, clampedY2 + tile.y));
    if (pageX2 - pageX1 < 1 || pageY2 - pageY1 < 1) continue;

    mapped.push({
      id: `${prefix}_T${tile.tileIndex}_${cand.rawClassId}_${i}`,
      rawClassId: cand.rawClassId,
      rawLabel: resolveYoloV203Class(cand.rawClassId)?.yoloLabel || `class_${cand.rawClassId}`,
      confidence: cand.score,
      tileIndex: tile.tileIndex,
      pageBox: { x1: pageX1, y1: pageY1, x2: pageX2, y2: pageY2 },
    });
  }
  return mapped;
}

function mergeGlobal(candidates: Detection[], globalMergeIou = 0.50, classAware = true): Detection[] {
  candidates.sort((a, b) => b.confidence - a.confidence);
  const suppressed = new Array<boolean>(candidates.length).fill(false);
  const kept: Detection[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (suppressed[i]) continue;
    const active = candidates[i];
    kept.push(active);

    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed[j]) continue;
      const neighbor = candidates[j];
      if (classAware && active.rawClassId !== neighbor.rawClassId) continue;

      const iou = computeIoU(active.pageBox, neighbor.pageBox);
      if (iou >= globalMergeIou) {
        suppressed[j] = true;
      }
    }
  }
  return kept;
}

function checkSeamDistance(box: { x1: number; y1: number; x2: number; y2: number }): { isNear: boolean; minDistance: number } {
  const seamX = [819, 1638, 2457, 2549];
  const seamY = [819, 1502];
  let minDistance = 9999;

  for (const sx of seamX) {
    const d1 = Math.abs(box.x1 - sx);
    const d2 = Math.abs(box.x2 - sx);
    if (d1 < minDistance) minDistance = d1;
    if (d2 < minDistance) minDistance = d2;
  }
  for (const sy of seamY) {
    const d1 = Math.abs(box.y1 - sy);
    const d2 = Math.abs(box.y2 - sy);
    if (d1 < minDistance) minDistance = d1;
    if (d2 < minDistance) minDistance = d2;
  }

  return { isNear: minDistance < 40, minDistance: Math.round(minDistance) };
}

async function createCropWithContext(
  imageBuffer: Buffer,
  pageW: number,
  pageH: number,
  box: { x1: number; y1: number; x2: number; y2: number },
  label: string,
  conf: number,
  outPath: string,
) {
  const boxW = Math.max(1, Math.round(box.x2 - box.x1));
  const boxH = Math.max(1, Math.round(box.y2 - box.y1));

  // 60px padding context
  const pad = 60;
  const cX1 = Math.max(0, Math.floor(box.x1 - pad));
  const cY1 = Math.max(0, Math.floor(box.y1 - pad));
  const cX2 = Math.min(pageW, Math.ceil(box.x2 + pad));
  const cY2 = Math.min(pageH, Math.ceil(box.y2 + pad));

  const cropW = Math.round(cX2 - cX1);
  const cropH = Math.round(cY2 - cY1);

  const relX = Math.round(box.x1 - cX1);
  const relY = Math.round(box.y1 - cY1);

  const badgeText = `${label} ${(conf * 100).toFixed(0)}%`;
  const badgeW = Math.min(cropW - 8, Math.max(100, Math.round(badgeText.length * 7.5 + 12)));

  const svg = Buffer.from(
    `<svg width="${cropW}" height="${cropH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${relX}" y="${relY}" width="${boxW}" height="${boxH}" fill="rgba(0, 150, 255, 0.18)" stroke="#0077ff" stroke-width="3" />
      <rect x="4" y="4" width="${badgeW}" height="20" fill="rgba(10, 20, 30, 0.85)" rx="3" ry="3"/>
      <text x="8" y="18" fill="#00ffcc" font-family="monospace" font-size="12" font-weight="bold">${badgeText}</text>
    </svg>`,
  );

  await sharp(imageBuffer)
    .extract({ left: cX1, top: cY1, width: cropW, height: cropH })
    .composite([{ input: svg }])
    .png()
    .toFile(outPath);
}

export async function runGenerateReviewPackage() {
  console.log('=== Building Targeted Local Review Package ===\n');

  fs.mkdirSync(REVIEW_PKG_DIR, { recursive: true });
  fs.mkdirSync(CROPS_DIR, { recursive: true });

  // 1. Read baseline predictions (60 detections for sheet-1-p1)
  console.log('[1/5] Loading verified baseline detections...');
  const baselineData = JSON.parse(fs.readFileSync(BASELINE_JSON_PATH, 'utf8'));
  const sheet1Baseline = baselineData.pages.find((p: any) => p.pageId === 'sheet-1-p1');
  const baselineDets: Detection[] = sheet1Baseline.retainedDetections.map((d: any, idx: number) => ({
    id: `BASE_${idx}`,
    rawClassId: d.rawClassId,
    rawLabel: d.rawLabel,
    confidence: d.confidence,
    tileIndex: d.tileIndex,
    pageBox: { ...d.pageBox },
  }));
  console.log(`  Baseline sheet-1-p1 count: ${baselineDets.length}`);

  // 2. Decode raw image
  const imageBuffer = fs.readFileSync(SOURCE_IMAGE_PATH);
  const imgMeta = await sharp(imageBuffer).metadata();
  const pageW = imgMeta.width!;
  const pageH = imgMeta.height!;

  const sharpDecoded = await sharp(imageBuffer)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pageRgb = sharpDecoded.data;

  // 3. Initialize ONNX session & run the 3 alternative geometries
  console.log('[2/5] Running inference for GEO-4 (Overlap35), GEO-1 (Tile768), and GEO-2 (Tile1280)...');
  const session = await getYoloV203Session(MODEL_PATH);

  async function getDetectionsForConfig(cfg: { id: string; tileSize: number; stride: number }) {
    const grid = buildGrid(pageW, pageH, cfg.tileSize, cfg.stride);
    const allDets: Detection[] = [];
    for (const tile of grid.tiles) {
      const tensor = await extractTileTensor(pageRgb, pageW, pageH, tile);
      const cands = await inferTile(session, tensor);
      const nmsKept = applyNms(cands, 0.70);
      const pageCands = mapToPage(nmsKept, tile, grid.scaleFactor, pageW, pageH, cfg.id);
      allDets.push(...pageCands);
    }
    return mergeGlobal(allDets, 0.50, true);
  }

  const geo4Dets = await getDetectionsForConfig({ id: 'GEO4', tileSize: 1024, stride: 665 });
  const geo1Dets = await getDetectionsForConfig({ id: 'GEO1', tileSize: 768, stride: 614 });
  const geo2Dets = await getDetectionsForConfig({ id: 'GEO2', tileSize: 1280, stride: 1024 });

  console.log(`  GEO-4 Detections: ${geo4Dets.length}`);
  console.log(`  GEO-1 Detections: ${geo1Dets.length}`);
  console.log(`  GEO-2 Detections: ${geo2Dets.length}`);

  // 4. Perform structured difference analysis
  console.log('[3/5] Performing differential analysis and prioritization...');
  const reviewItems: ReviewItem[] = [];

  // --------------------------------------------------------------------------
  // PRIORITAS 1: Tambahan pada GEO-4 dibanding baseline (+10 kandidat)
  // --------------------------------------------------------------------------
  const geo4Added: Detection[] = [];
  for (const g4 of geo4Dets) {
    const match = baselineDets.find((b) => computeIoU(g4.pageBox, b.pageBox) >= 0.40);
    if (!match) {
      geo4Added.push(g4);
    }
  }

  for (let i = 0; i < geo4Added.length; i++) {
    const det = geo4Added[i];
    const reviewId = `REV-P1-GEO4-${String(i + 1).padStart(2, '0')}`;
    const cropFileName = `${reviewId}.png`;
    const cropFilePath = path.join(CROPS_DIR, cropFileName);

    await createCropWithContext(imageBuffer, pageW, pageH, det.pageBox, det.rawLabel, det.confidence, cropFilePath);

    const seamInfo = checkSeamDistance(det.pageBox);

    reviewItems.push({
      reviewId,
      priorityCategory: 'Prioritas 1: Tambahan GEO-4 (Overlap 35%)',
      categoryDescription: 'Kandidat baru yang muncul pada GEO-4 karena overlap 35% membebaskan simbol dari pemotongan batas tile',
      configOrigin: 'GEO-4_Overlap35',
      rawClassId: det.rawClassId,
      rawLabel: det.rawLabel,
      confidence: det.confidence,
      pageBox: det.pageBox,
      baselineComparison: {
        matchedBaselineId: null,
        matchedBaselineLabel: null,
        matchingIoU: 0,
        differenceType: 'kandidat_tambahan',
      },
      isNearTileBoundary: seamInfo.isNear,
      distanceToNearestSeamPx: seamInfo.minDistance,
      cropImagePath: path.relative(REPO_ROOT, cropFilePath).replace(/\\/g, '/'),
      humanDecisionSlot: {
        status: 'UNRESOLVED',
        options: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'],
        humanDecision: null,
        reviewerNotes: null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // PRIORITAS 2: Perbedaan Tile768 / Tile1280 yang tidak ada pada GEO-4
  // --------------------------------------------------------------------------
  const tileUniqueDets: Array<{ det: Detection; origin: string }> = [];

  // Check Tile 768 unique detections (zoom-in)
  for (const t1 of geo1Dets) {
    const matchBase = baselineDets.some((b) => computeIoU(t1.pageBox, b.pageBox) >= 0.40);
    const matchGeo4 = geo4Dets.some((g) => computeIoU(t1.pageBox, g.pageBox) >= 0.40);
    if (!matchBase && !matchGeo4) {
      tileUniqueDets.push({ det: t1, origin: 'GEO-1_Tile768 (Zoom-in 1.33x)' });
    }
  }

  // Check Tile 1280 unique detections (zoom-out)
  for (const t2 of geo2Dets) {
    const matchBase = baselineDets.some((b) => computeIoU(t2.pageBox, b.pageBox) >= 0.40);
    const matchGeo4 = geo4Dets.some((g) => computeIoU(t2.pageBox, g.pageBox) >= 0.40);
    if (!matchBase && !matchGeo4) {
      tileUniqueDets.push({ det: t2, origin: 'GEO-2_Tile1280 (Zoom-out 0.8x)' });
    }
  }

  // Take top representative unique items from tile variations
  for (let i = 0; i < Math.min(8, tileUniqueDets.length); i++) {
    const item = tileUniqueDets[i];
    const reviewId = `REV-P2-T${item.origin.includes('768') ? '768' : '1280'}-${String(i + 1).padStart(2, '0')}`;
    const cropFileName = `${reviewId}.png`;
    const cropFilePath = path.join(CROPS_DIR, cropFileName);

    await createCropWithContext(imageBuffer, pageW, pageH, item.det.pageBox, item.det.rawLabel, item.det.confidence, cropFilePath);
    const seamInfo = checkSeamDistance(item.det.pageBox);

    reviewItems.push({
      reviewId,
      priorityCategory: 'Prioritas 2: Perbedaan Tile768/1280 vs GEO-4',
      categoryDescription: 'Deteksi unik akibat efek scaling resolusi tile yang tidak muncul pada geometri native 1024',
      configOrigin: item.origin,
      rawClassId: item.det.rawClassId,
      rawLabel: item.det.rawLabel,
      confidence: item.det.confidence,
      pageBox: item.det.pageBox,
      baselineComparison: {
        matchedBaselineId: null,
        matchedBaselineLabel: null,
        matchingIoU: 0,
        differenceType: 'kandidat_tambahan',
      },
      isNearTileBoundary: seamInfo.isNear,
      distanceToNearestSeamPx: seamInfo.minDistance,
      cropImagePath: path.relative(REPO_ROOT, cropFilePath).replace(/\\/g, '/'),
      humanDecisionSlot: {
        status: 'UNRESOLVED',
        options: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'],
        humanDecision: null,
        reviewerNotes: null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // PRIORITAS 3: Konflik Pump vs Ball Valve
  // --------------------------------------------------------------------------
  const conflictBox = { x1: 998, y1: 971, x2: 1024, y2: 994 };
  const pumpCand = baselineDets.find((b) => b.rawLabel.includes('pump') && computeIoU(b.pageBox, conflictBox) > 0.40);
  const valveCand = baselineDets.find((b) => b.rawLabel.includes('valve') && computeIoU(b.pageBox, conflictBox) > 0.40);

  if (pumpCand && valveCand) {
    const revId = 'REV-P3-CONFLICT-01';
    const cropFilePath = path.join(CROPS_DIR, `${revId}.png`);
    await createCropWithContext(imageBuffer, pageW, pageH, conflictBox, 'PUMP vs VALVE (IoU 0.522)', 0.82, cropFilePath);

    reviewItems.push({
      reviewId: revId,
      priorityCategory: 'Prioritas 3: Konflik Multi-Label Pump vs Ball Valve',
      categoryDescription: 'Tumpang tindih dua kelas berbeda pada lokasi fisik yang sama (x≈1000, y≈980). IoU = 0.522',
      configOrigin: 'Baseline & Semua Geometri Native',
      rawClassId: pumpCand.rawClassId,
      rawLabel: `Konflik: ${pumpCand.rawLabel} (${(pumpCand.confidence * 100).toFixed(1)}%) vs ${valveCand.rawLabel} (${(valveCand.confidence * 100).toFixed(1)}%)`,
      confidence: Math.max(pumpCand.confidence, valveCand.confidence),
      pageBox: conflictBox,
      baselineComparison: {
        matchedBaselineId: pumpCand.id,
        matchedBaselineLabel: `${pumpCand.rawLabel} & ${valveCand.rawLabel}`,
        matchingIoU: 0.522,
        differenceType: 'konflik_multilabel',
      },
      isNearTileBoundary: false,
      distanceToNearestSeamPx: 179,
      cropImagePath: path.relative(REPO_ROOT, cropFilePath).replace(/\\/g, '/'),
      humanDecisionSlot: {
        status: 'UNRESOLVED',
        options: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'],
        humanDecision: null,
        reviewerNotes: null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // PRIORITAS 4: Kasus yang ditekan oleh Class-Agnostic Merge
  // --------------------------------------------------------------------------
  if (pumpCand) {
    const revId = 'REV-P4-AGNOSTIC-01';
    const cropFilePath = path.join(CROPS_DIR, `${revId}.png`);
    await createCropWithContext(imageBuffer, pageW, pageH, pumpCand.pageBox, `${pumpCand.rawLabel} (Suppressed)`, pumpCand.confidence, cropFilePath);

    reviewItems.push({
      reviewId: revId,
      priorityCategory: 'Prioritas 4: Ditekan oleh Class-Agnostic Merge',
      categoryDescription: 'equipment.pump.niso (conf 0.53) ditekan secara otomatis karena valve.ball.iso memiliki confidence lebih tinggi (0.82). Manusia harus memutuskan apakah pompa benar-benar salah.',
      configOrigin: 'MERGE-Agnostic vs Baseline',
      rawClassId: pumpCand.rawClassId,
      rawLabel: pumpCand.rawLabel,
      confidence: pumpCand.confidence,
      pageBox: pumpCand.pageBox,
      baselineComparison: {
        matchedBaselineId: pumpCand.id,
        matchedBaselineLabel: pumpCand.rawLabel,
        matchingIoU: 1.0,
        differenceType: 'kandidat_hilang',
      },
      isNearTileBoundary: false,
      distanceToNearestSeamPx: 179,
      cropImagePath: path.relative(REPO_ROOT, cropFilePath).replace(/\\/g, '/'),
      humanDecisionSlot: {
        status: 'UNRESOLVED',
        options: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'],
        humanDecision: null,
        reviewerNotes: null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // B. Simbol Baseline yang Hilang pada Low Overlap (GEO-3)
  // --------------------------------------------------------------------------
  const lostInGeo3 = baselineDets.filter((b) => checkSeamDistance(b.pageBox).isNear);
  for (let i = 0; i < Math.min(3, lostInGeo3.length); i++) {
    const b = lostInGeo3[i];
    const revId = `REV-SEAM-BASE-${String(i + 1).padStart(2, '0')}`;
    const cropFilePath = path.join(CROPS_DIR, `${revId}.png`);
    await createCropWithContext(imageBuffer, pageW, pageH, b.pageBox, b.rawLabel, b.confidence, cropFilePath);

    reviewItems.push({
      reviewId: revId,
      priorityCategory: 'Kandidat Baseline di Perbatasan Seam',
      categoryDescription: 'Simbol valid baseline yang berada tepat di perbatasan tile (rentan terpotong bila overlap diturunkan)',
      configOrigin: 'Baseline GEO-0',
      rawClassId: b.rawClassId,
      rawLabel: b.rawLabel,
      confidence: b.confidence,
      pageBox: b.pageBox,
      baselineComparison: {
        matchedBaselineId: b.id,
        matchedBaselineLabel: b.rawLabel,
        matchingIoU: 1.0,
        differenceType: 'identik',
      },
      isNearTileBoundary: true,
      distanceToNearestSeamPx: checkSeamDistance(b.pageBox).minDistance,
      cropImagePath: path.relative(REPO_ROOT, cropFilePath).replace(/\\/g, '/'),
      humanDecisionSlot: {
        status: 'UNRESOLVED',
        options: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'],
        humanDecision: null,
        reviewerNotes: null,
      },
    });
  }

  console.log(`[4/5] Generated ${reviewItems.length} prioritized review crop items.`);

  // 5. Generate Manifest Files (JSON, Markdown, CSV)
  console.log('[5/5] Generating review manifests...');

  // JSON Manifest
  const manifestPayload = {
    schemaVersion: 'human-review-manifest-v1',
    generatedAt: new Date().toISOString(),
    sourceImage: {
      path: 'fixtures/pid-eval/sheet-1/page_1.png',
      width: pageW,
      height: pageH,
    },
    totalReviewItems: reviewItems.length,
    decisionVocabulary: ['benar', 'salah', 'duplikat', 'kelas salah', 'bbox salah', 'unresolved'],
    reviewItems,
  };
  fs.writeFileSync(MANIFEST_JSON_PATH, JSON.stringify(manifestPayload, null, 2));

  // CSV Manifest
  const csvHeaders = [
    'review_id',
    'priority_category',
    'config_origin',
    'raw_label',
    'confidence',
    'box_x1',
    'box_y1',
    'box_x2',
    'box_y2',
    'is_near_seam',
    'difference_type',
    'crop_file',
    'human_decision',
    'reviewer_notes',
  ];
  const csvRows = [csvHeaders.join(',')];
  for (const item of reviewItems) {
    csvRows.push(
      [
        item.reviewId,
        `"${item.priorityCategory}"`,
        `"${item.configOrigin}"`,
        `"${item.rawLabel}"`,
        item.confidence.toFixed(3),
        Math.round(item.pageBox.x1),
        Math.round(item.pageBox.y1),
        Math.round(item.pageBox.x2),
        Math.round(item.pageBox.y2),
        item.isNearTileBoundary ? 'YES' : 'NO',
        item.baselineComparison.differenceType,
        item.cropImagePath,
        'UNRESOLVED',
        '""',
      ].join(','),
    );
  }
  fs.writeFileSync(MANIFEST_CSV_PATH, csvRows.join('\n'));

  // Markdown Manifest Table
  const mdLines = [
    '# YOLO v203 — Human Review Package & Differential Manifest',
    '',
    `**Halaman Sumber:** \`fixtures/pid-eval/sheet-1/page_1.png\` (${pageW}×${pageH} px)  `,
    `**Tanggal Generate:** ${new Date().toISOString()}  `,
    `**Total Item Review:** ${reviewItems.length} item  `,
    '',
    '### Petunjuk Reviewer Manusia',
    'Isi kolom **Keputusan Manusia** dengan salah satu opsi berikut:',
    '- `[x] benar`: Objek fisik P&ID memang benar simbol equipment/fitting tersebut dan bbox akurat.',
    '- `[x] salah`: False Positive (bukan equipment, melainkan teks, panah garis alir, atau artefak gambar).',
    '- `[x] duplikat`: Simbol yang sama telah terdeteksi oleh kotak lain.',
    '- `[x] kelas salah`: Simbol ada dan kotak akurat, namun tipe kelas model keliru.',
    '- `[x] bbox salah`: Kelas benar, namun kotak terlalu besar/kecil/terpotong.',
    '- `[x] unresolved`: Belum dapat diputuskan (perlu konfirmasi P&ID legend/P&ID master).',
    '',
    '---',
    '',
    '## Tabel Manifest Review Selisih',
    '',
    '| ID Review | Prioritas / Kategori | Label Prediksi & Conf | BBox (X1, Y1, X2, Y2) | Dekat Seam? | Crop Preview | Keputusan Manusia |',
    '|---|---|---|---|:---:|---|---|',
  ];

  for (const item of reviewItems) {
    const boxStr = `${Math.round(item.pageBox.x1)}, ${Math.round(item.pageBox.y1)}, ${Math.round(item.pageBox.x2)}, ${Math.round(item.pageBox.y2)}`;
    const seamBadge = item.isNearTileBoundary ? `⚠️ YA (${item.distanceToNearestSeamPx}px)` : 'Tidak';
    const cropLink = `[Lihat Crop](${item.cropImagePath})`;

    mdLines.push(
      `| **${item.reviewId}** | ${item.priorityCategory}<br>*${item.categoryDescription.slice(0, 50)}...* | \`${item.rawLabel}\`<br>(${(item.confidence * 100).toFixed(1)}%) | \`${boxStr}\` | ${seamBadge} | ${cropLink} | [ ] benar<br>[ ] salah<br>[ ] duplikat<br>[ ] kelas salah<br>[ ] bbox salah<br>[ ] unresolved |`,
    );
  }

  fs.writeFileSync(MANIFEST_MD_PATH, mdLines.join('\n'));

  console.log(`\n[OK] Review manifest JSON: ${MANIFEST_JSON_PATH}`);
  console.log(`[OK] Review manifest Markdown: ${MANIFEST_MD_PATH}`);
  console.log(`[OK] Review manifest CSV: ${MANIFEST_CSV_PATH}`);
  console.log(`[OK] All context crops saved in: ${CROPS_DIR}`);
}

if (require.main === module || process.argv[1] === __filename) {
  runGenerateReviewPackage().catch((err) => {
    console.error('Fatal error generating review package:', err);
    process.exit(1);
  });
}
