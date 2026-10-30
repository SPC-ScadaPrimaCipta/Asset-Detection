/**
 * YOLO v203 Output Decoder — Dedicated for 203-class model (1024×1024 input).
 *
 * VERIFIED TENSOR CONTRACT (Phase 1):
 *   Output shape: [1, 207, 21504]
 *     channel 0-3   : bbox (cx, cy, width, height) in 1024×1024 letterbox space
 *     channel 4-206 : final class confidence for 203 classes (IDs 0-202)
 *     class ID      : channel - 4
 *
 * CRITICAL INDEXING: channel-major layout [1, C, N].
 * Value at channel c, candidate i is:
 *     output[c * 21504 + i]
 *
 * SCOPE & CONSTRAINTS:
 *   - No objectness multiplication (scores are directly in channels 4..206).
 *   - Uses raw class map from `yolo-class-map-v203.ts`.
 *   - Semantic fields (assetType, equipmentClass, detectionSubtype) remain unresolved (null).
 *   - Coordinate transformation: letterbox 1024x1024 -> source pixels -> normalized 0-1000.
 */

import {
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_CLASS_COUNT,
  YOLO_V203_OUTPUT_CHANNELS,
  resolveYoloV203Class,
} from '@/lib/detection/yolo/yolo-class-map-v203';
import {
  invertLetterboxBox,
  type LetterboxMeta,
} from '@/lib/detection/yolo/yolo-preprocessing';

export interface YoloV203RawDetection {
  /** Source-pixel bbox, corner format. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Final class confidence score directly from channel. */
  score: number;
  /** Raw class ID (0..202). */
  rawClassId: number;
  /** Raw label from ONNX metadata. */
  rawLabel: string;
}

export interface YoloV203Detection {
  /** Normalized 0-1000 bbox (project convention). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Source-pixel bbox, corner format. */
  pixelBox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
  rawClassId: number;
  rawLabel: string;
  /** Unresolved semantic fields — Legend matching will populate these. */
  assetType: null;
  equipmentClass: null;
  detectionSubtype: null;
}

export interface YoloV203DecodeConfig {
  confidenceThreshold: number;
  nmsIouThreshold: number;
  maxDetections: number;
}

/** Default decode configuration for v203 offline testing. */
export const DEFAULT_V203_DECODE_CONFIG: YoloV203DecodeConfig = {
  confidenceThreshold: 0.25,
  nmsIouThreshold: 0.45,
  maxDetections: 300,
};

/**
 * Read one value from the channel-major output tensor.
 * Value = channel * candidateCount + candidateIndex.
 */
export function valueAtV203(
  output: Float32Array,
  channel: number,
  candidateIndex: number,
  candidateCount = YOLO_V203_CANDIDATE_COUNT,
): number {
  return output[channel * candidateCount + candidateIndex];
}

/**
 * Decode raw model output into detections in source-pixel space.
 * Does NOT apply NMS — call applyClassAwareNmsV203 separately.
 */
export function decodeYoloV203Output(
  output: Float32Array,
  meta: LetterboxMeta,
  confidenceThreshold: number,
): YoloV203RawDetection[] {
  const expectedLength = YOLO_V203_OUTPUT_CHANNELS * YOLO_V203_CANDIDATE_COUNT;
  if (output.length !== expectedLength) {
    throw new Error(
      `decodeYoloV203Output: tensor length ${output.length}, expected ${expectedLength} (${YOLO_V203_OUTPUT_CHANNELS}x${YOLO_V203_CANDIDATE_COUNT})`,
    );
  }

  const results: YoloV203RawDetection[] = [];

  for (let i = 0; i < YOLO_V203_CANDIDATE_COUNT; i++) {
    const cx = valueAtV203(output, 0, i);
    const cy = valueAtV203(output, 1, i);
    const w = valueAtV203(output, 2, i);
    const h = valueAtV203(output, 3, i);

    let bestClassId = -1;
    let bestScore = 0;

    // Direct scan across 203 class channels starting at offset 4
    for (let c = 0; c < YOLO_V203_CLASS_COUNT; c++) {
      const score = valueAtV203(output, YOLO_V203_CLASS_CHANNEL_OFFSET + c, i);
      if (score > bestScore) {
        bestScore = score;
        bestClassId = c;
      }
    }

    if (bestClassId < 0 || bestScore < confidenceThreshold) continue;

    const classInfo = resolveYoloV203Class(bestClassId);
    if (!classInfo) continue;

    // Convert letterbox space (1024x1024) -> source pixels
    const inv = invertLetterboxBox(
      { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
      meta,
    );

    // Skip degenerate boxes that collapsed during inverse transform
    if (inv.x2 - inv.x1 < 1 || inv.y2 - inv.y1 < 1) continue;

    results.push({
      x1: inv.x1,
      y1: inv.y1,
      x2: inv.x2,
      y2: inv.y2,
      score: bestScore,
      rawClassId: bestClassId,
      rawLabel: classInfo.yoloLabel,
    });
  }

  return results;
}

/** IoU calculation of two source-pixel boxes in corner format. */
export function iou(
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

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Class-aware NMS for v203 detections:
 * Boxes are only suppressed by overlapping boxes of the SAME raw class ID.
 */
export function applyClassAwareNmsV203(
  detections: YoloV203RawDetection[],
  iouThreshold: number,
  maxDetections: number,
): YoloV203RawDetection[] {
  const byClass = new Map<number, YoloV203RawDetection[]>();
  for (const d of detections) {
    const list = byClass.get(d.rawClassId);
    if (list) list.push(d);
    else byClass.set(d.rawClassId, [d]);
  }

  const kept: YoloV203RawDetection[] = [];
  for (const list of byClass.values()) {
    list.sort((a, b) => b.score - a.score);
    const classKept: YoloV203RawDetection[] = [];
    for (const cand of list) {
      let suppressed = false;
      for (const k of classKept) {
        if (iou(cand, k) >= iouThreshold) {
          suppressed = true;
          break;
        }
      }
      if (!suppressed) classKept.push(cand);
    }
    kept.push(...classKept);
  }

  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, maxDetections);
}

/**
 * Convert source-pixel detections to normalized 0-1000 coordinate space
 * with unresolved semantic fields (assetType: null).
 */
export function toNormalizedV203Detections(
  detections: YoloV203RawDetection[],
  meta: LetterboxMeta,
): YoloV203Detection[] {
  const { sourceWidth, sourceHeight } = meta;

  return detections.map((d) => {
    const widthPx = d.x2 - d.x1;
    const heightPx = d.y2 - d.y1;

    return {
      bbox: {
        x: (d.x1 / sourceWidth) * 1000,
        y: (d.y1 / sourceHeight) * 1000,
        width: (widthPx / sourceWidth) * 1000,
        height: (heightPx / sourceHeight) * 1000,
      },
      pixelBox: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 },
      confidence: d.score,
      rawClassId: d.rawClassId,
      rawLabel: d.rawLabel,
      assetType: null,
      equipmentClass: null,
      detectionSubtype: null,
    };
  });
}

/**
 * Full decoding pipeline: decode -> class-aware NMS -> normalize.
 */
export function decodeAndFilterV203(
  output: Float32Array,
  meta: LetterboxMeta,
  config: YoloV203DecodeConfig = DEFAULT_V203_DECODE_CONFIG,
): YoloV203Detection[] {
  const raw = decodeYoloV203Output(output, meta, config.confidenceThreshold);
  const nmsed = applyClassAwareNmsV203(raw, config.nmsIouThreshold, config.maxDetections);
  return toNormalizedV203Detections(nmsed, meta);
}
