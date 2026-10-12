#!/usr/bin/env tsx
/**
 * YOLO v203 Native-Resolution Tiling & Global Merge — Offline Prediction Baseline Generator
 *
 * SPECIFICATION (Strict Baseline Contract):
 *   - Tile Size: 1024 x 1024 (Zero resizing, native 1:1 scale)
 *   - Stride: 819 px (~20% overlap on 1024)
 *   - Padding: 114 (Gray)
 *   - Confidence Threshold: 0.50 (Strict baseline, no 0.25, no sweep)
 *   - Per-Tile NMS IoU: 0.70
 *   - Per-Tile Cap: 300 (Applied after NMS and deterministic sort)
 *   - Global Merge IoU: 0.50 (Class-aware merge across tiles)
 *   - Batch Size: 1, Sequential inference on CPU
 *   - Review Label: UNREVIEWED_MODEL_PREDICTION
 *
 * Output: fixtures/diagnostics/predictions-v203-baseline.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  computeTileGrid,
  extractTileTensorFromRgb,
  mapTileDetectionToPage,
  mergeGlobalDetectionsClassAware,
  type RawPageDetection,
  type TileDescriptor,
  type GlobalMergeResult,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILE_STRIDE,
  DEFAULT_PAD_VALUE,
  DEFAULT_GLOBAL_MERGE_IOU,
  DEFAULT_PER_TILE_MAX_DETECTIONS,
  capPerTileDetections,
  getDetectionId,
} from '../lib/detection/yolo/yolo-tiling-v203';
import {
  getYoloV203Session,
  DEFAULT_V203_MODEL_PATH,
} from '../lib/detection/yolo/yolo-inference-v203';
import {
  valueAtV203,
} from '../lib/detection/yolo/yolo-decoder-v203';
import {
  resolveYoloV203Class,
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_CLASS_COUNT,
} from '../lib/detection/yolo/yolo-class-map-v203';

const REPO_ROOT = path.resolve(__dirname, '..');
const ONNXRUNTIME_NODE_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(REPO_ROOT, 'node_modules/onnxruntime-node/package.json'), 'utf8'),
    );
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
})();
const MODEL_PATH = path.resolve(REPO_ROOT, DEFAULT_V203_MODEL_PATH);
const CLASS_MAP_PATH = path.join(REPO_ROOT, 'model/yolo-v203-names.json');
const SCRIPT_PATH = path.resolve(__filename);
const OUTPUT_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'predictions-v203-baseline.json');

const CONFIDENCE_THRESHOLD = 0.50;
const PER_TILE_NMS_IOU = 0.70;
const PER_TILE_CAP = 300;
const GLOBAL_MERGE_IOU = 0.50;

const PAGES = [
  { pageId: 'sheet-1-p1', path: 'fixtures/pid-eval/sheet-1/page_1.png' },
  { pageId: 'sheet-2-p1', path: 'fixtures/pid-eval/sheet-2/page_1.png' },
  { pageId: 'sheet-3-p1', path: 'fixtures/pid-eval/sheet-3/page_1.png' },
  { pageId: 'sheet-4-p1', path: 'fixtures/pid-eval/sheet-4/page_1.png' },
  { pageId: 'sheet-5-p1', path: 'fixtures/pid-eval/sheet-5/page_1.png' },
  { pageId: 'sheet-7-p1', path: 'fixtures/pid-eval/sheet-7/page_1.png' },
  { pageId: 'sheet-7-model-p1', path: 'fixtures/pid-eval/sheet-7-model/page_1.png' },
  { pageId: 'sheet-7-rev-p1', path: 'fixtures/pid-eval/sheet-7-rev/page_1.png' },
  { pageId: 'sheet-11-p1', path: 'fixtures/pid-eval/sheet-11/page_1.png' },
  { pageId: 'sheet-12-p1', path: 'fixtures/pid-eval/sheet-12/page_1.png' },
  { pageId: 'fire-water-p1', path: 'fixtures/pid-eval/fire-water/page_1.png' },
  { pageId: 'fire-water-p2', path: 'fixtures/pid-eval/fire-water/page_2.png' },
];

function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function computeBufferSha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function validateBox(box: { x1: number; y1: number; x2: number; y2: number }, maxW: number, maxH: number): boolean {
  if (!Number.isFinite(box.x1) || !Number.isFinite(box.y1) || !Number.isFinite(box.x2) || !Number.isFinite(box.y2)) {
    return false;
  }
  if (box.x2 - box.x1 < 1 || box.y2 - box.y1 < 1) {
    return false;
  }
  if (box.x1 < 0 || box.y1 < 0 || box.x2 > maxW || box.y2 > maxH) {
    return false;
  }
  return true;
}

export async function generateV203PredictionBaseline() {
  console.log('=== Generating YOLO v203 Prediction Baseline (12 Pages) ===');
  console.log(`Configuration: Conf >= ${CONFIDENCE_THRESHOLD}, Tile NMS IoU: ${PER_TILE_NMS_IOU}, Tile Cap: ${PER_TILE_CAP}, Global Merge IoU: ${GLOBAL_MERGE_IOU}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(`Model not found: ${MODEL_PATH}`);
  }

  const modelSha256 = computeFileSha256(MODEL_PATH);
  const classMapSha256 = fs.existsSync(CLASS_MAP_PATH) ? computeFileSha256(CLASS_MAP_PATH) : 'N/A';
  const scriptSha256 = computeFileSha256(SCRIPT_PATH);

  const session = await getYoloV203Session(MODEL_PATH);
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';

  sharp.cache(false);
  sharp.concurrency(1);

  const baselinePages: any[] = [];
  const runId = `v203-baseline-${Date.now()}`;
  const startedAt = new Date().toISOString();

  let totalRawDetectionsAcrossPages = 0;
  let totalRetainedAcrossPages = 0;

  for (const p of PAGES) {
    const fullImagePath = path.resolve(REPO_ROOT, p.path);
    if (!fs.existsSync(fullImagePath)) {
      throw new Error(`Page image not found: ${fullImagePath}`);
    }

    const imageBuffer = fs.readFileSync(fullImagePath);
    const imageSha256 = computeBufferSha256(imageBuffer);

    // Decode full page RGB (Zero resizing)
    const sharpDecoded = await sharp(imageBuffer)
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pageW = sharpDecoded.info.width;
    const pageH = sharpDecoded.info.height;
    const pageRgb = sharpDecoded.data;

    const gridSpec = computeTileGrid(pageW, pageH, DEFAULT_TILE_SIZE, DEFAULT_TILE_STRIDE);
    const globalCandidates: RawPageDetection[] = [];
    const tileSummaries: any[] = [];

    for (const tile of gridSpec.tiles) {
      // Zero-resize slice & gray padding 114
      const tensorFloat32 = extractTileTensorFromRgb(pageRgb, pageW, pageH, tile, DEFAULT_TILE_SIZE, DEFAULT_PAD_VALUE);
      const tensorFloat = tensorFloat32 instanceof Float32Array ? tensorFloat32 : new Float32Array(tensorFloat32);

      const feeds: Record<string, ort.Tensor> = {
        [inputName]: new ort.Tensor('float32', tensorFloat, [1, 3, DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE]),
      };

      const results = await session.run(feeds);
      const rawOutput = results[outputName].data as Float32Array;

      // Decode tile candidates at threshold >= 0.50
      const tileCands: Array<{ anchor: number; rawClassId: number; score: number; bbox: [number, number, number, number] }> = [];
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

        if (bestScore >= CONFIDENCE_THRESHOLD) {
          const x1 = cx - w / 2;
          const y1 = cy - h / 2;
          const x2 = cx + w / 2;
          const y2 = cy + h / 2;
          if (x2 - x1 >= 1 && y2 - y1 >= 1) {
            tileCands.push({
              anchor: i,
              rawClassId: bestClass,
              score: bestScore,
              bbox: [x1, y1, x2, y2],
            });
          }
        }
      }

      // Sort score desc, anchor asc
      tileCands.sort((a, b) => b.score - a.score || a.anchor - b.anchor);

      // Class-aware NMS per tile at IoU 0.70
      const keptTileDets: typeof tileCands = [];
      const classesInTile = Array.from(new Set(tileCands.map((c) => c.rawClassId))).sort((a, b) => a - b);
      for (const clsId of classesInTile) {
        const clsCands = tileCands.filter((c) => c.rawClassId === clsId);
        const suppressed = new Array<boolean>(clsCands.length).fill(false);
        for (let a = 0; a < clsCands.length; a++) {
          if (suppressed[a]) continue;
          const active = clsCands[a];
          keptTileDets.push(active);
          for (let b = a + 1; b < clsCands.length; b++) {
            if (suppressed[b]) continue;
            const boxA = active.bbox;
            const boxB = clsCands[b].bbox;
            const interX1 = Math.max(boxA[0], boxB[0]);
            const interY1 = Math.max(boxA[1], boxB[1]);
            const interX2 = Math.min(boxA[2], boxB[2]);
            const interY2 = Math.min(boxA[3], boxB[3]);
            const interW = Math.max(0, interX2 - interX1);
            const interH = Math.max(0, interY2 - interY1);
            const interArea = interW * interH;
            const areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
            const areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);
            const unionArea = areaA + areaB - interArea;
            const iou = unionArea > 0 ? interArea / unionArea : 0;
            if (iou >= PER_TILE_NMS_IOU) {
              suppressed[b] = true;
            }
          }
        }
      }

      // Cap at 300
      const cappedTileDets = capPerTileDetections(keptTileDets, PER_TILE_CAP);
      const cappedKeptTileDets = cappedTileDets.sorted;

      // Map to page coordinates
      const pageDetections: RawPageDetection[] = [];
      for (let dIdx = 0; dIdx < cappedKeptTileDets.length; dIdx++) {
        const det = cappedKeptTileDets[dIdx];
        const mapped = mapTileDetectionToPage(
          { x1: det.bbox[0], y1: det.bbox[1], x2: det.bbox[2], y2: det.bbox[3] },
          tile,
          pageW,
          pageH,
        );
        if (mapped && validateBox(mapped, pageW, pageH)) {
          const rawClassInfo = resolveYoloV203Class(det.rawClassId);
          const pageDet: RawPageDetection = {
            pageBox: mapped,
            confidence: det.score,
            rawClassId: det.rawClassId,
            rawLabel: rawClassInfo?.yoloLabel || `class_${det.rawClassId}`,
            tileIndex: tile.tileIndex,
            detectionIndex: dIdx,
            tileBox: { x1: det.bbox[0], y1: det.bbox[1], x2: det.bbox[2], y2: det.bbox[3] },
            assetType: null,
            equipmentClass: null,
            detectionSubtype: null,
          };
          pageDetections.push(pageDet);
          globalCandidates.push(pageDet);
        }
      }

      tileSummaries.push({
        tileIndex: tile.tileIndex,
        colIndex: tile.colIndex,
        rowIndex: tile.rowIndex,
        tileOffset: { x: tile.x, y: tile.y },
        validDimensions: { width: tile.validWidth, height: tile.validHeight },
        hasPadding: tile.hasPadding,
        rawCandidatesBeforeNms: tileCands.length,
        candidatesAfterNms: keptTileDets.length,
        candidatesAfterCap: cappedKeptTileDets.length,
        mappedPageDetections: pageDetections.length,
      });
    }

    // Global merge across tiles
    const mergeResult: GlobalMergeResult = mergeGlobalDetectionsClassAware(globalCandidates, GLOBAL_MERGE_IOU);

    totalRawDetectionsAcrossPages += globalCandidates.length;
    totalRetainedAcrossPages += mergeResult.totalAfterMerge;

    console.log(`Page ${p.pageId.padEnd(18)} (${pageW}x${pageH}): ${globalCandidates.length} raw -> ${mergeResult.totalAfterMerge} retained (${mergeResult.suppressed.length} suppressed)`);

    baselinePages.push({
      pageId: p.pageId,
      imagePath: p.path,
      imageSha256,
      dimensions: { width: pageW, height: pageH },
      grid: {
        tileSize: DEFAULT_TILE_SIZE,
        stride: DEFAULT_TILE_STRIDE,
        totalTiles: gridSpec.tiles.length,
        cols: gridSpec.xOffsets.length,
        rows: gridSpec.yOffsets.length,
        xOffsets: gridSpec.xOffsets,
        yOffsets: gridSpec.yOffsets,
      },
      tileSummaries,
      counts: {
        rawCandidatesBeforeMerge: globalCandidates.length,
        retainedAfterMerge: mergeResult.totalAfterMerge,
        suppressedByMerge: mergeResult.suppressed.length,
      },
      retainedDetections: mergeResult.kept.map((d, idx) => ({
        predictionId: `${p.pageId}-pred-${String(idx).padStart(4, '0')}`,
        candidateId: getDetectionId(d),
        rawClassId: d.rawClassId,
        rawLabel: d.rawLabel,
        confidence: d.confidence,
        tileProvenance: {
          tileIndex: d.tileIndex,
          detectionIndex: d.detectionIndex,
          tileBox: d.tileBox,
        },
        pageBox: d.pageBox,
        normalizedBox: {
          x1: Math.round((d.pageBox.x1 / pageW) * 1000),
          y1: Math.round((d.pageBox.y1 / pageH) * 1000),
          x2: Math.round((d.pageBox.x2 / pageW) * 1000),
          y2: Math.round((d.pageBox.y2 / pageH) * 1000),
        },
        reviewStatus: 'UNREVIEWED_MODEL_PREDICTION',
      })),
      suppressionTrace: mergeResult.suppressed.map((s) => ({
        suppressedCandidateId: s.suppressedCandidateId,
        suppressorCandidateId: s.suppressorCandidateId,
        rawClassId: s.rawClassId,
        iou: s.iou,
        reason: s.reason,
        suppressedCandidate: {
          tileIndex: s.candidate.tileIndex,
          detectionIndex: s.candidate.detectionIndex,
          confidence: s.candidate.confidence,
          pageBox: s.candidate.pageBox,
          tileBox: s.candidate.tileBox,
        },
        suppressedBy: {
          tileIndex: s.suppressedBy.tileIndex,
          detectionIndex: s.suppressedBy.detectionIndex,
          confidence: s.suppressedBy.confidence,
          pageBox: s.suppressedBy.pageBox,
          tileBox: s.suppressedBy.tileBox,
        },
      })),
    });
  }

  // Duplicate Variant Equivalence Verification for Sheet 7 (sheet-7-p1 vs sheet-7-rev-p1)
  const s7 = baselinePages.find((p) => p.pageId === 'sheet-7-p1');
  const s7Rev = baselinePages.find((p) => p.pageId === 'sheet-7-rev-p1');
  let duplicateEquivalenceCheck = {
    evaluated: false,
    sameImageSha: false,
    retainedCountMatch: false,
    detectionsIdentical: false,
    note: 'Sheet 7 duplicate comparison not performed',
  };

  if (s7 && s7Rev) {
    const sameSha = s7.imageSha256 === s7Rev.imageSha256;
    const countMatch = s7.retainedDetections.length === s7Rev.retainedDetections.length;

    // Compare detections stripping page-specific predictionId
    const s7Stripped = JSON.stringify(
      s7.retainedDetections.map((d: any) => ({
        rawClassId: d.rawClassId,
        confidence: d.confidence,
        tileProvenance: d.tileProvenance,
        pageBox: d.pageBox,
      })),
    );
    const s7RevStripped = JSON.stringify(
      s7Rev.retainedDetections.map((d: any) => ({
        rawClassId: d.rawClassId,
        confidence: d.confidence,
        tileProvenance: d.tileProvenance,
        pageBox: d.pageBox,
      })),
    );

    const identical = s7Stripped === s7RevStripped;
    duplicateEquivalenceCheck = {
      evaluated: true,
      sameImageSha: sameSha,
      retainedCountMatch: countMatch,
      detectionsIdentical: identical,
      note: identical
        ? 'Confirmed: sheet-7-p1 and sheet-7-rev-p1 produce 100% identical predictions and bounding boxes.'
        : 'Warning: Divergence detected between identical image inputs.',
    };
  }

  const payload = {
    metadata: {
      artifactType: 'yolo_v203_prediction_baseline',
      schemaVersion: '1.0',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      runtimeEnvironment: {
        nodeVersion: process.version,
        onnxruntimeVersion: ONNXRUNTIME_NODE_VERSION,
        sharpVersion: sharp.versions.sharp,
        platform: process.platform,
        arch: process.arch,
      },
      hashes: {
        modelSha256,
        classMapSha256,
        scriptSha256,
      },
      configuration: {
        confidenceThreshold: CONFIDENCE_THRESHOLD,
        perTileNmsIou: PER_TILE_NMS_IOU,
        perTileCap: PER_TILE_CAP,
        globalMergeIou: GLOBAL_MERGE_IOU,
        tileSize: DEFAULT_TILE_SIZE,
        stride: DEFAULT_TILE_STRIDE,
        padValue: DEFAULT_PAD_VALUE,
        zeroResize: true,
        executionProvider: 'cpu',
      },
      summary: {
        totalPages: baselinePages.length,
        totalRawCandidatesBeforeMerge: totalRawDetectionsAcrossPages,
        totalRetainedPredictions: totalRetainedAcrossPages,
        reviewStatusLabel: 'UNREVIEWED_MODEL_PREDICTION',
        evaluationGateStatus: 'NOT EVALUATED (Ground truth annotation in progress; no metrics computed)',
      },
      duplicateEquivalenceCheck,
    },
    pages: baselinePages,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nBaseline successfully generated at: ${OUTPUT_PATH}`);
  console.log(`Total Pages: ${baselinePages.length}`);
  console.log(`Total Raw Candidates: ${totalRawDetectionsAcrossPages}`);
  console.log(`Total Retained Predictions: ${totalRetainedAcrossPages}`);
  console.log(`Duplicate Equivalence (S7 vs S7-rev): ${duplicateEquivalenceCheck.detectionsIdentical ? 'IDENTICAL (MATCH)' : 'MISMATCH'}`);
}

if (require.main === module) {
  generateV203PredictionBaseline().catch((err) => {
    console.error('[FATAL] Failed to generate baseline:', err);
    process.exit(1);
  });
}
