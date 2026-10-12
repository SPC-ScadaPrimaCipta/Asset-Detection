#!/usr/bin/env tsx
/**
 * YOLO v203 Native-Resolution Tiling & Global Merge — Node.js Pilot Runner
 *
 * Runs sequential 1024x1024 tiling on full P&ID sheet (3573x2526) with zero resize,
 * tracks detailed heap/RSS memory telemetry, and verifies exact and tolerance parity against Python reference.
 *
 * Output: fixtures/diagnostics/report/pilot-tiling-v203-report.json
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
  decodeAndFilterV203,
  valueAtV203,
} from '../lib/detection/yolo/yolo-decoder-v203';
import {
  resolveYoloV203Class,
  YOLO_V203_INPUT_SIZE,
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_CLASS_COUNT,
} from '../lib/detection/yolo/yolo-class-map-v203';

const REPO_ROOT = path.resolve(__dirname, '..');
const MODEL_PATH = path.resolve(DEFAULT_V203_MODEL_PATH);
const IMAGE_PATH = path.join(REPO_ROOT, 'fixtures/pid-eval/sheet-1/page_1.png');
const REF_PATH = path.join(REPO_ROOT, 'fixtures/reference/yolo-v203-tiling-python-reference-v2-cap300.json');
const LEGACY_REF_PATH = path.join(REPO_ROOT, 'fixtures/reference/yolo-v203-tiling-python-reference.json');
const REPORT_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/report');
const REPORT_PATH = path.join(REPORT_DIR, 'pilot-tiling-v203-report.json');
const EXPECTED_V203_MODEL_SHA256 =
  '92f22175ade687a0f7e29617c3a3ae9cbf80266dda6df30d74fb9c3c95917e6c';
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 80_000_000;

const ONNXRUNTIME_NODE_VERSION = (() => {
  try {
    return require('onnxruntime-node/package.json').version as string;
  } catch {
    return 'unknown';
  }
})();

function computeSha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function computeFileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function repoRelative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).replaceAll(path.sep, '/');
}

interface MemorySample {
  stage: string;
  tileIndex?: number;
  timestamp: string;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  arrayBuffersMb: number;
}

function sampleMemory(stage: string, tileIndex?: number): MemorySample {
  const mem = process.memoryUsage();
  return {
    stage,
    tileIndex,
    timestamp: new Date().toISOString(),
    heapUsedMb: mem.heapUsed / (1024 * 1024),
    heapTotalMb: mem.heapTotal / (1024 * 1024),
    rssMb: mem.rss / (1024 * 1024),
    externalMb: mem.external / (1024 * 1024),
    arrayBuffersMb: (mem.arrayBuffers || 0) / (1024 * 1024),
  };
}

function canonicalBox(box: { x1: number; y1: number; x2: number; y2: number } | number[]): number[] {
  return Array.isArray(box) ? box : [box.x1, box.y1, box.x2, box.y2];
}

function canonicalDetection(detection: any): Record<string, unknown> {
  return {
    rawClassId: detection.rawClassId,
    confidence: detection.confidence,
    tileIndex: detection.tileIndex,
    detectionIndex: detection.detectionIndex,
    tileBox: canonicalBox(detection.tileBox),
    pageBox: canonicalBox(detection.pageBox),
  };
}

function canonicalTileDetectionList(detections: any[]): string {
  return JSON.stringify(detections.map(canonicalDetection));
}

function canonicalSuppression(trace: any): Record<string, unknown> {
  return {
    suppressedCandidateId: trace.suppressedCandidateId,
    suppressorCandidateId: trace.suppressorCandidateId,
    rawClassId: trace.rawClassId ?? trace.candidate.rawClassId,
    iou: trace.iou,
    reason: trace.reason ?? 'same_class_iou_at_or_above_threshold',
    candidate: canonicalDetection(trace.candidate),
    suppressedBy: canonicalDetection(trace.suppressedBy),
  };
}

export async function runTilingPilot() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  console.log('[INFO] Executing Node.js YOLO v203 Native-Resolution Tiling Pilot...');

  const memSamples: MemorySample[] = [];
  memSamples.push(sampleMemory('initial'));

  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(`Model not found: ${MODEL_PATH}`);
  }
  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`Image not found: ${IMAGE_PATH}`);
  }

  const modelFileSha = computeFileSha256(MODEL_PATH);
  if (modelFileSha !== EXPECTED_V203_MODEL_SHA256) {
    throw new Error(`YOLO v203 model integrity check failed: ${modelFileSha}`);
  }

  const imageStat = fs.statSync(IMAGE_PATH);
  if (!imageStat.isFile() || imageStat.size > MAX_IMAGE_BYTES) {
    throw new Error(`Pilot image is missing, not a regular file, or exceeds ${MAX_IMAGE_BYTES} bytes`);
  }

  // Sharp 0.35 enforces its own decoder limits; the explicit metadata check below
  // applies the pilot-specific pixel budget before the raw RGB allocation.
  sharp.cache(false);
  sharp.concurrency(1);

  const imageFileSha = computeFileSha256(IMAGE_PATH);

  // 1. Decode Full Page Image into raw RGB Uint8 (Zero Resizing)
  const t0Decode = performance.now();
  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  const meta = await sharp(imageBuffer).metadata();
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_IMAGE_PIXELS) {
    throw new Error(`Pilot image dimensions exceed ${MAX_IMAGE_PIXELS} pixels`);
  }
  const sharpDecoded = await sharp(imageBuffer)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pageW = sharpDecoded.info.width;
  const pageH = sharpDecoded.info.height;
  const pageRgb = sharpDecoded.data;
  const decodedRgbSha = computeSha256(pageRgb);
  const tDecode = performance.now() - t0Decode;

  memSamples.push(sampleMemory('post_image_decode'));
  console.log(`[INFO] Decoded Page Image: ${pageW}x${pageH} (${(pageRgb.length / 1024 / 1024).toFixed(2)} MB, SHA: ${decodedRgbSha.substring(0, 16)}...) in ${tDecode.toFixed(2)}ms`);

  // 2. Build Grid
  const gridSpec = computeTileGrid(pageW, pageH, DEFAULT_TILE_SIZE, DEFAULT_TILE_STRIDE);
  console.log(`[INFO] Grid: ${gridSpec.xOffsets.length} cols x ${gridSpec.yOffsets.length} rows = ${gridSpec.tiles.length} total tiles`);
  console.log(`   X Offsets: [${gridSpec.xOffsets.join(', ')}]`);
  console.log(`   Y Offsets: [${gridSpec.yOffsets.join(', ')}]`);

  // 3. Initialize ONNX Session (CPU Execution Provider)
  const session = await getYoloV203Session(MODEL_PATH);
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';

  memSamples.push(sampleMemory('post_session_init'));

  // 4. Sequential Per-Tile Inference
  const tileResults: any[] = [];
  const globalCandidates: RawPageDetection[] = [];
  const tileInferenceTimes: number[] = [];

  for (const tile of gridSpec.tiles) {
    const t0Tile = performance.now();

    // Zero-resize slice & padding
    const tensorFloat32 = extractTileTensorFromRgb(pageRgb, pageW, pageH, tile, DEFAULT_TILE_SIZE, DEFAULT_PAD_VALUE);
    const tensorBytes = Buffer.from(tensorFloat32.buffer, tensorFloat32.byteOffset, tensorFloat32.byteLength);
    const tensorSha = computeSha256(tensorBytes);

    // Run inference
    // Guard: onnxruntime-node under Jest requires true Float32Array instance
    const tensorFloat = tensorFloat32 instanceof Float32Array ? tensorFloat32 : new Float32Array(tensorFloat32);
    const feeds: Record<string, ort.Tensor> = {
      [inputName]: new ort.Tensor('float32', tensorFloat, [1, 3, DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE]),
    };
    const results = await session.run(feeds);
    const rawOutput = results[outputName].data as Float32Array;
    const rawOutputBytes = Buffer.from(rawOutput.buffer, rawOutput.byteOffset, rawOutput.byteLength);
    const rawOutputSha = computeSha256(rawOutputBytes);

    // Tile-local decode
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

      if (bestScore >= 0.50) {
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

    // Sort score descending, anchor ascending
    tileCands.sort((a, b) => b.score - a.score || a.anchor - b.anchor);

    // Class-aware NMS per tile
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
          // Compute IoU in tile space
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
          if (iou >= 0.70) {
            suppressed[b] = true;
          }
        }
      }
    }

    const cappedTileDets = capPerTileDetections(keptTileDets, DEFAULT_PER_TILE_MAX_DETECTIONS);
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
      if (mapped) {
        const pageDet: RawPageDetection = {
          pageBox: mapped,
          confidence: det.score,
          rawClassId: det.rawClassId,
          rawLabel: resolveYoloV203Class(det.rawClassId)?.yoloLabel || `class_${det.rawClassId}`,
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

    const tTile = performance.now() - t0Tile;
    tileInferenceTimes.push(tTile);
    memSamples.push(sampleMemory('post_tile', tile.tileIndex));

    tileResults.push({
      tile,
      inputTensorSha256: tensorSha,
      rawOutputSha256: rawOutputSha,
      tileDetectionsBeforeCap: cappedTileDets.preCapCount,
      tileDetectionsCount: cappedTileDets.cappedCount,
      perTileCapApplied: cappedTileDets.preCapCount > DEFAULT_PER_TILE_MAX_DETECTIONS,
      pageDetectionsCount: pageDetections.length,
      inferenceTimeMs: tTile,
      detections: pageDetections,
    });
  }

  console.log(`[INFO] Completed ${gridSpec.tiles.length} tiles inference. Total candidates before merge: ${globalCandidates.length}`);

  // 5. Class-Aware Global Merge
  const mergeResult: GlobalMergeResult = mergeGlobalDetectionsClassAware(globalCandidates, DEFAULT_GLOBAL_MERGE_IOU);
  memSamples.push(sampleMemory('post_global_merge'));

  console.log(`[INFO] Global Merge Complete: ${mergeResult.totalBeforeMerge} candidates -> ${mergeResult.totalAfterMerge} kept (${mergeResult.suppressed.length} suppressed)`);

  // 6. Cross-Runtime Parity Verification against Python Reference (if available)
  let parityReport: any = null;
  if (fs.existsSync(REF_PATH)) {
    const pyRef = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));

    // Check decoded RGB SHA
    const isDecodedRgbExact = pyRef.metadata.sourceImage.decodedRgbSha256 === decodedRgbSha;

    // Check per-tile tensor and raw output SHAs
    const tileParityChecks: any[] = [];
    let allTilesExact = true;

    for (let t = 0; t < gridSpec.tiles.length; t++) {
      const pyTile = pyRef.tiles[t];
      const nodeTile = tileResults[t];

      const tensorExact = pyTile.inputTensorSha256 === nodeTile.inputTensorSha256;
      const rawOutputExact = pyTile.rawOutputSha256 === nodeTile.rawOutputSha256;
      const countExact = pyTile.pageDetectionsCount === nodeTile.pageDetectionsCount;
      const recordsExact = canonicalTileDetectionList(pyTile.detections) === canonicalTileDetectionList(nodeTile.detections);

      if (!tensorExact || !rawOutputExact || !countExact || !recordsExact) {
        allTilesExact = false;
      }

      tileParityChecks.push({
        tileIndex: t,
        tensorExact,
        rawOutputExact,
        countExact,
        recordsExact,
        pyDetectionsCount: pyTile.pageDetectionsCount,
        nodeDetectionsCount: nodeTile.pageDetectionsCount,
      });
    }

    // Check global merge parity
    const pyKept = pyRef.globalMerge.keptDetections;
    const nodeKept = mergeResult.kept;
    const mergeCountExact = pyKept.length === nodeKept.length;

    let maxConfDelta = 0;
    let maxBboxDelta = 0;

    for (let i = 0; i < Math.min(pyKept.length, nodeKept.length); i++) {
      const p = pyKept[i];
      const n = nodeKept[i];
      const cDelta = Math.abs(p.confidence - n.confidence);
      if (cDelta > maxConfDelta) maxConfDelta = cDelta;
      const bDelta = Math.max(
        Math.abs(p.pageBox[0] - n.pageBox.x1),
        Math.abs(p.pageBox[1] - n.pageBox.y1),
        Math.abs(p.pageBox[2] - n.pageBox.x2),
        Math.abs(p.pageBox[3] - n.pageBox.y2),
      );
      if (bDelta > maxBboxDelta) maxBboxDelta = bDelta;
    }

    const retainedRecordsExact = mergeCountExact && nodeKept.every((n, i) => {
      const p = pyKept[i];
      return n.rawClassId === p.rawClassId && n.tileIndex === p.tileIndex && n.detectionIndex === p.detectionIndex &&
        n.confidence === p.confidence && n.pageBox.x1 === p.pageBox[0] && n.pageBox.y1 === p.pageBox[1] &&
        n.pageBox.x2 === p.pageBox[2] && n.pageBox.y2 === p.pageBox[3] &&
        n.tileBox.x1 === p.tileBox[0] && n.tileBox.y1 === p.tileBox[1] &&
        n.tileBox.x2 === p.tileBox[2] && n.tileBox.y2 === p.tileBox[3];
    });
    const retainedRecordsWithinTolerance = mergeCountExact && maxConfDelta <= 1e-4 && maxBboxDelta <= 0.5;
    const suppressionTrace = mergeResult.suppressed;
    const pythonSuppressionTrace = pyRef.globalMerge.suppressedDetections;
    const canonicalNodeSuppression = suppressionTrace.map(canonicalSuppression).sort((a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const canonicalPythonSuppression = pythonSuppressionTrace.map(canonicalSuppression).sort((a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const suppressionTraceExact = JSON.stringify(canonicalNodeSuppression) === JSON.stringify(canonicalPythonSuppression);

    parityReport = {
      referencePath: repoRelative(REF_PATH),
      referenceSha256: computeFileSha256(REF_PATH),
      legacyReferencePath: repoRelative(LEGACY_REF_PATH),
      legacyReferenceSha256: fs.existsSync(LEGACY_REF_PATH) ? computeFileSha256(LEGACY_REF_PATH) : null,
      referenceProvenance: pyRef.metadata,
      isDecodedRgbExact,
      allTilesTensorAndRawOutputExact: allTilesExact,
      tileChecks: tileParityChecks,
      retainedRecordsExact,
      retainedRecordsWithinTolerance,
      suppressionTraceExact,
      suppressionTraceOrderIndependent: true,
      suppressionTraceLimitation: suppressionTraceExact ? null : 'Suppression records differ after canonical order-independent comparison',
      globalMergeParity: {
        pythonKeptCount: pyKept.length,
        nodeKeptCount: nodeKept.length,
        maxConfDelta,
        maxBboxDelta,
      },
      exactParityPassed: isDecodedRgbExact && allTilesExact && retainedRecordsExact,
      toleranceParityPassed: isDecodedRgbExact && allTilesExact && retainedRecordsWithinTolerance,
    };
  }

  // Calculate peak memory statistics
  const peakHeapUsed = Math.max(...memSamples.map((s) => s.heapUsedMb));
  const peakRss = Math.max(...memSamples.map((s) => s.rssMb));
  const peakExternal = Math.max(...memSamples.map((s) => s.externalMb));
  const peakArrayBuffers = Math.max(...memSamples.map((s) => s.arrayBuffersMb));

  const report = {
    title: 'YOLO v203 Native-Resolution Tiling & Global Merge Pilot Report',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      sharpVersion: sharp.versions.sharp,
      onnxruntimeVersion: ONNXRUNTIME_NODE_VERSION,
      executionProvider: 'CPUExecutionProvider',
    },
    model: {
      path: repoRelative(MODEL_PATH),
      sha256: modelFileSha,
    },
    sourceImage: {
      path: repoRelative(IMAGE_PATH),
      dimensions: [pageW, pageH],
      fileSha256: imageFileSha,
      decodedRgbSha256: decodedRgbSha,
    },
    gridSpec,
    detectionConfig: {
      confidenceThreshold: 0.50,
      perTileNmsIouThreshold: 0.70,
      perTileMaxDetections: DEFAULT_PER_TILE_MAX_DETECTIONS,
      perTileMaxDetectionsStage: 'post-class-aware-nms-pre-page-mapping',
      globalMergeIouThreshold: DEFAULT_GLOBAL_MERGE_IOU,
    },
    memoryTelemetry: {
      samplingMethod: 'process.memoryUsage() at each sequential tile stage',
      peakHeapUsedMb: peakHeapUsed,
      peakRssMb: peakRss,
      peakExternalMb: peakExternal,
      peakArrayBuffersMb: peakArrayBuffers,
      allSamples: memSamples,
    },
    performance: {
      imageDecodeTimeMs: tDecode,
      totalInferenceTimeMs: tileInferenceTimes.reduce((a, b) => a + b, 0),
      meanTileInferenceTimeMs: tileInferenceTimes.reduce((a, b) => a + b, 0) / tileInferenceTimes.length,
    },
    tileResults,
    globalMerge: {
      totalBeforeMerge: mergeResult.totalBeforeMerge,
      totalAfterMerge: mergeResult.totalAfterMerge,
      totalSuppressed: mergeResult.suppressed.length,
      kept: mergeResult.kept,
      suppressed: mergeResult.suppressed,
    },
    crossRuntimeParity: parityReport,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`[OK] Pilot report written to: ${REPORT_PATH}`);

  return report;
}

if (require.main === module) {
  runTilingPilot().catch((err) => {
    console.error('Fatal error in tiling pilot:', err);
    process.exit(1);
  });
}
