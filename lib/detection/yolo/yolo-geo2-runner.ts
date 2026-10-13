/**
 * YOLO GEO-2 Execution Runner
 *
 * Implements the verified GEO-2 symbol detection pipeline:
 * - Dynamic grid calculation based on page dimensions
 * - Exact tile extraction (1280x1280) and resize to ONNX input (1024x1024, fit: fill)
 * - Inverse coordinate transformation using exact crop dimensions (handles smaller pages)
 * - Boundary clamping strictly within page bounds
 * - Class-aware per-tile NMS (IoU 0.70, cap 300)
 * - Class-aware global cross-tile merge (IoU 0.50)
 * - Formats detections into PersistableDetection with complete provenance
 */

import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { getYoloV203Session } from '@/lib/detection/yolo/yolo-inference-v203';
import { resolveYoloV203Class } from '@/lib/detection/yolo/yolo-class-map-v203';
import {
  type YoloGeo2Config,
  getEffectiveGeo2Config,
} from '@/lib/detection/yolo/yolo-geo2-config';
import type { PersistableDetection } from '@/lib/detection/persistence/detection-repository';

// Bridge Jest VM context & native ONNX Runtime C++ addon TypedArray prototype boundary
if (typeof Float32Array !== 'undefined') {
  try {
    Object.defineProperty(Float32Array, Symbol.hasInstance, {
      value: (inst: unknown) =>
        inst !== null &&
        typeof inst === 'object' &&
        ((inst as { constructor?: { name?: string } }).constructor?.name === 'Float32Array' ||
          Object.prototype.toString.call(inst) === '[object Float32Array]'),
      configurable: true,
    });
  } catch {
    // Non-fatal if already defined
  }
}

export interface TileCoordinates {
  tileIndex: number;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileGrid {
  pageWidth: number;
  pageHeight: number;
  tileSize: number;
  stride: number;
  xOffsets: number[];
  yOffsets: number[];
  tiles: TileCoordinates[];
}

export interface YoloRawPrediction {
  tileIndex: number;
  detectionIndex: number;
  anchor: number;
  rawClassId: number;
  rawLabel: string;
  score: number;
  tileBox: { x1: number; y1: number; x2: number; y2: number };
  pageBox: { x1: number; y1: number; x2: number; y2: number };
}

export interface YoloGeo2RunResult {
  config: YoloGeo2Config;
  pageWidth: number;
  pageHeight: number;
  totalTiles: number;
  rawCandidatesBeforeMerge: number;
  retainedDetections: number;
  suppressedCount: number;
  durationMs: number;
  detections: PersistableDetection[];
  rawPredictions: YoloRawPrediction[];
}

/**
 * Generate 1D axis offsets with specified stride and tile size.
 * Ensures the last offset covers the boundary exactly without exceeding the page.
 */
export function generateAxisOffsets(dimension: number, tileSize: number, stride: number): number[] {
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

/**
 * Build dynamic 2D tile grid for arbitrary page dimensions.
 */
export function buildTileGrid(pageWidth: number, pageHeight: number, tileSize: number, stride: number): TileGrid {
  const xOffsets = generateAxisOffsets(pageWidth, tileSize, stride);
  const yOffsets = generateAxisOffsets(pageHeight, tileSize, stride);
  const tiles: TileCoordinates[] = [];
  let tileIndex = 0;

  for (let r = 0; r < yOffsets.length; r++) {
    for (let c = 0; c < xOffsets.length; c++) {
      tiles.push({
        tileIndex,
        col: c,
        row: r,
        x: xOffsets[c],
        y: yOffsets[r],
        width: tileSize,
        height: tileSize,
      });
      tileIndex++;
    }
  }

  return {
    pageWidth,
    pageHeight,
    tileSize,
    stride,
    xOffsets,
    yOffsets,
    tiles,
  };
}

/**
 * Computes Intersection over Union (IoU) of two boxes in corner format.
 */
export function computeIoU(
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

/**
 * Reads a value from channel-major output tensor [1, 207, 21504].
 */
function readTensorValue(output: Float32Array, channel: number, candidateIndex: number, candidateCount = 21504): number {
  return output[channel * candidateCount + candidateIndex];
}

/**
 * Executes per-tile NMS (class-aware).
 */
export function applyPerTileNms<T extends { rawClassId: number; score: number; tileBox: { x1: number; y1: number; x2: number; y2: number } }>(
  candidates: T[],
  iouThreshold: number,
  maxCap: number,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const suppressed = new Array<boolean>(sorted.length).fill(false);

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed[i]) continue;
    const current = sorted[i];
    kept.push(current);
    if (kept.length >= maxCap) break;

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed[j]) continue;
      const neighbor = sorted[j];
      if (current.rawClassId !== neighbor.rawClassId) continue;

      if (computeIoU(current.tileBox, neighbor.tileBox) >= iouThreshold) {
        suppressed[j] = true;
      }
    }
  }

  return kept;
}

/**
 * Global merge across all tiles (class-aware).
 * Uses deterministic tie-breaking: score descending, tileIndex ascending, detectionIndex ascending.
 */
export function applyGlobalMerge(
  candidates: YoloRawPrediction[],
  iouThreshold: number,
  classAware: boolean,
): { kept: YoloRawPrediction[]; suppressedCount: number } {
  const sorted = [...candidates].sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    if (a.tileIndex !== b.tileIndex) return a.tileIndex - b.tileIndex;
    return a.detectionIndex - b.detectionIndex;
  });

  const kept: YoloRawPrediction[] = [];
  const suppressed = new Array<boolean>(sorted.length).fill(false);

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed[i]) continue;
    const current = sorted[i];
    kept.push(current);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed[j]) continue;
      const neighbor = sorted[j];

      if (classAware && current.rawClassId !== neighbor.rawClassId) {
        continue;
      }

      if (computeIoU(current.pageBox, neighbor.pageBox) >= iouThreshold) {
        suppressed[j] = true;
      }
    }
  }

  return { kept, suppressedCount: sorted.length - kept.length };
}

/**
 * Safely obtain the Float32Array constructor compatible with onnxruntime.
 * Resolves Jest / VM multi-context prototype mismatches where global.Float32Array
 * does not match onnxruntime-common's typedArrayConstructor.
 */
let cachedFloat32Ctor: Float32ArrayConstructor | null = null;
function getNativeFloat32Array(): Float32ArrayConstructor {
  if (cachedFloat32Ctor) return cachedFloat32Ctor;
  try {
    const probe = new ort.Tensor('float32', [0], [1]);
    if (probe.data && typeof probe.data.constructor === 'function') {
      cachedFloat32Ctor = probe.data.constructor as Float32ArrayConstructor;
      return cachedFloat32Ctor;
    }
  } catch {
    // Fall back to global Float32Array
  }
  cachedFloat32Ctor = Float32Array;
  return cachedFloat32Ctor;
}

/**
 * Runs the YOLO GEO-2 pipeline on a single page image buffer (PNG, JPEG, etc.).
 */
export async function runYoloGeo2Page(
  imageBuffer: Buffer,
  pageWidth: number,
  pageHeight: number,
  options?: Partial<YoloGeo2Config>,
): Promise<YoloGeo2RunResult> {
  const t0 = performance.now();
  const cfg = getEffectiveGeo2Config(options);

  // 1. Load ONNX Model Session (singleton cached)
  const session = await getYoloV203Session(cfg.modelPath);
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';

  // 2. Decode raw image once to RGB buffer for rapid tile cropping
  const sharpDecoded = await sharp(imageBuffer)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rawRgb = sharpDecoded.data;
  const decodedW = sharpDecoded.info.width;
  const decodedH = sharpDecoded.info.height;

  if (decodedW !== pageWidth || decodedH !== pageHeight) {
    throw new Error(
      `Dimension mismatch: image buffer is ${decodedW}x${decodedH}, expected ${pageWidth}x${pageHeight}`,
    );
  }

  // 3. Build dynamic grid
  const grid = buildTileGrid(pageWidth, pageHeight, cfg.tileSize, cfg.stride);
  const allRawPredictions: YoloRawPrediction[] = [];
  const onnxSize = cfg.inputSize;
  const planeSize = onnxSize * onnxSize;
  const NativeFloat32 = getNativeFloat32Array();

  // 4. Process tiles sequentially (Batch 1)
  for (let tIdx = 0; tIdx < grid.tiles.length; tIdx++) {
    const tile = grid.tiles[tIdx];

    // Crop dimension bounded by actual page bounds
    const cropW = Math.min(tile.width, pageWidth - tile.x);
    const cropH = Math.min(tile.height, pageHeight - tile.y);
    if (cropW <= 0 || cropH <= 0) continue;

    // Crop & resize to 1024x1024 with fit: fill (GEO-2 exact parity)
    const tileRgb = await sharp(rawRgb, {
      raw: { width: pageWidth, height: pageHeight, channels: 3 },
    })
      .extract({ left: tile.x, top: tile.y, width: cropW, height: cropH })
      .resize(onnxSize, onnxSize, { fit: 'fill' })
      .raw()
      .toBuffer();

    // Prepare Float32 NCHW Tensor using native constructor
    const tensor = new NativeFloat32(3 * planeSize);
    for (let i = 0; i < planeSize; i++) {
      tensor[i] = tileRgb[i * 3] / 255.0;
      tensor[planeSize + i] = tileRgb[i * 3 + 1] / 255.0;
      tensor[2 * planeSize + i] = tileRgb[i * 3 + 2] / 255.0;
    }

    // Run Model
    const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, onnxSize, onnxSize]) };
    const results = await session.run(feeds);
    const outputData = results[outputName].data as Float32Array;

    // Parse anchors (21504)
    const tileCandidates: Array<{
      detectionIndex: number;
      anchor: number;
      rawClassId: number;
      rawLabel: string;
      score: number;
      tileBox: { x1: number; y1: number; x2: number; y2: number };
    }> = [];

    let detCounter = 0;
    for (let i = 0; i < 21504; i++) {
      let bestClass = -1;
      let bestScore = 0;

      // Scan 203 classes starting at channel 4
      for (let c = 0; c < 203; c++) {
        const score = readTensorValue(outputData, 4 + c, i);
        if (score > bestScore) {
          bestScore = score;
          bestClass = c;
        }
      }

      if (bestScore >= cfg.confidenceThreshold && bestClass >= 0) {
        const cx = readTensorValue(outputData, 0, i);
        const cy = readTensorValue(outputData, 1, i);
        const w = readTensorValue(outputData, 2, i);
        const h = readTensorValue(outputData, 3, i);

        const x1 = cx - w / 2;
        const y1 = cy - h / 2;
        const x2 = cx + w / 2;
        const y2 = cy + h / 2;

        if (x2 - x1 >= 1 && y2 - y1 >= 1) {
          const classInfo = resolveYoloV203Class(bestClass);
          tileCandidates.push({
            detectionIndex: detCounter++,
            anchor: i,
            rawClassId: bestClass,
            rawLabel: classInfo ? classInfo.yoloLabel : `class_${bestClass}`,
            score: bestScore,
            tileBox: { x1, y1, x2, y2 },
          });
        }
      }
    }

    // Apply per-tile NMS (IoU 0.70, cap 300)
    const nmsKept = applyPerTileNms(tileCandidates, cfg.perTileNmsIou, cfg.perTileCap);

    // Dynamic inverse transform:
    // Scale factors account for exact cropW and cropH (1024/1280 = 0.8 when full tile)
    const scaleX = onnxSize / cropW;
    const scaleY = onnxSize / cropH;

    for (const cand of nmsKept) {
      // Invert resize from ONNX (1024) to crop space, then add tile offset
      let pageX1 = tile.x + cand.tileBox.x1 / scaleX;
      let pageY1 = tile.y + cand.tileBox.y1 / scaleY;
      let pageX2 = tile.x + cand.tileBox.x2 / scaleX;
      let pageY2 = tile.y + cand.tileBox.y2 / scaleY;

      // Strict boundary clamping within page dimensions
      pageX1 = Math.max(0, Math.min(pageWidth, pageX1));
      pageY1 = Math.max(0, Math.min(pageHeight, pageY1));
      pageX2 = Math.max(0, Math.min(pageWidth, pageX2));
      pageY2 = Math.max(0, Math.min(pageHeight, pageY2));

      // Discard collapsed boxes
      if (pageX2 - pageX1 < 1 || pageY2 - pageY1 < 1) continue;

      allRawPredictions.push({
        tileIndex: tile.tileIndex,
        detectionIndex: cand.detectionIndex,
        anchor: cand.anchor,
        rawClassId: cand.rawClassId,
        rawLabel: cand.rawLabel,
        score: cand.score,
        tileBox: cand.tileBox,
        pageBox: { x1: pageX1, y1: pageY1, x2: pageX2, y2: pageY2 },
      });
    }
  }

  // 5. Global Merge across all tiles (IoU 0.50 class-aware)
  const mergeResult = applyGlobalMerge(allRawPredictions, cfg.globalMergeIou, cfg.classAware);
  const durationMs = Math.round(performance.now() - t0);

  // 6. Map to PersistableDetection contract
  const persistableList: PersistableDetection[] = mergeResult.kept.map((item) => {
    const boxW = Math.max(1, item.pageBox.x2 - item.pageBox.x1);
    const boxH = Math.max(1, item.pageBox.y2 - item.pageBox.y1);

    // Clean equipment class / asset type resolution from raw label
    const parts = item.rawLabel.split('.');
    const primaryType = parts.length > 1 ? parts[1].replace(/_/g, ' ') : item.rawLabel;

    return {
      assetTag: null, // YOLO does not perform OCR or tag association
      assetType: primaryType,
      equipmentClass: parts[0] || null,
      description: null,
      confidence: item.score,
      // Legacy 0-1000 normalized space (integer for PostgreSQL schema)
      bbox: {
        x: Math.round((item.pageBox.x1 / pageWidth) * 1000),
        y: Math.round((item.pageBox.y1 / pageHeight) * 1000),
        width: Math.round((boxW / pageWidth) * 1000),
        height: Math.round((boxH / pageHeight) * 1000),
      },
      // Canonical pixel space (dual-write supported by detection repository)
      symbolBboxPx: {
        x: item.pageBox.x1,
        y: item.pageBox.y1,
        width: boxW,
        height: boxH,
      },
      pageDims: {
        pageWidth,
        pageHeight,
      },
      legendSymbol: item.rawLabel,
      detection_source: 'YOLO_GEO2',
      evidence: [
        'YOLO GEO-2 Symbol Detection (v203 ONNX)',
        `Class: ${item.rawLabel} (ID: ${item.rawClassId})`,
        `Confidence: ${(item.score * 100).toFixed(1)}%`,
        `Tile: #${item.tileIndex}`,
      ],
      detEvidence: {
        engine: 'YOLO_GEO2',
        model: 'yolo-pid-v8n-203.onnx',
        tileIndex: item.tileIndex,
        rawClassId: item.rawClassId,
        rawLabel: item.rawLabel,
        score: item.score,
        anchor: item.anchor,
        effectiveConfig: {
          tileSize: cfg.tileSize,
          stride: cfg.stride,
          confidenceThreshold: cfg.confidenceThreshold,
          perTileNmsIou: cfg.perTileNmsIou,
          globalMergeIou: cfg.globalMergeIou,
        },
      },
    };
  });

  return {
    config: cfg,
    pageWidth,
    pageHeight,
    totalTiles: grid.tiles.length,
    rawCandidatesBeforeMerge: allRawPredictions.length,
    retainedDetections: persistableList.length,
    suppressedCount: mergeResult.suppressedCount,
    durationMs,
    detections: persistableList,
    rawPredictions: allRawPredictions,
  };
}
