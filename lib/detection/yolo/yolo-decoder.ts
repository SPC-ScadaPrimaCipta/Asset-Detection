/**
 * YOLO output decoder — VERIFIED against real P&ID inference.
 *
 * Output tensor shape: [1, 37, 8400]
 *
 *   channel 0-3   : bbox (cx, cy, width, height) in 640x640 letterbox space
 *   channel 4     : unused — always 0.0 on real data; NOT objectness
 *   channel 5-36  : final class confidence for the 32 classes
 *
 * CRITICAL INDEXING: the tensor is channel-major. The value for
 * (channel c, candidate i) is:
 *
 *     output[c * 8400 + i]        // CORRECT
 *
 * NOT:
 *
 *     output[i * 37 + c]          // WRONG — reads unrelated memory
 *
 * Because channel 4 is not objectness, the final score is simply the max class
 * channel value; do NOT multiply by channel 4 (it is always 0, which would zero
 * every detection).
 *
 * Coordinate space: after decoding, boxes are converted from letterbox space to
 * source pixels via invertLetterboxBox, then to the project's normalized 0-1000
 * bbox space (matching lib/ai-schemas.ts and the detections table).
 */

import {
  YOLO_CANDIDATE_COUNT,
  YOLO_CLASS_CHANNEL_OFFSET,
  YOLO_CLASS_COUNT,
  resolveYoloClass,
} from '@/lib/detection/yolo/yolo-class-map';
import {
  invertLetterboxBox,
  type LetterboxMeta,
} from '@/lib/detection/yolo/yolo-preprocessing';

/** Channels in the model output tensor. */
export const YOLO_OUTPUT_CHANNELS = YOLO_CLASS_CHANNEL_OFFSET + YOLO_CLASS_COUNT; // 37

export interface YoloRawDetection {
  /** Source-pixel bbox, corner format. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Final confidence = max class channel value. */
  score: number;
  /** Raw class id emitted by the model (may be a duplicate). */
  rawClassId: number;
  rawLabel: string;
  /** Canonical class id after duplicate resolution. */
  canonicalClassId: number;
  canonicalLabel: string;
  /** True when rawClassId !== canonicalClassId (a duplicate was resolved). */
  wasDuplicate: boolean;
}

export interface YoloDetection {
  /** Normalized 0-1000 bbox (project convention). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Source-pixel bbox, corner format. */
  pixelBox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
  rawClassId: number;
  rawLabel: string;
  canonicalClassId: number;
  canonicalLabel: string;
  assetType: string;
  detectionSubtype?: string;
  wasDuplicate: boolean;
}

export interface YoloDecodeConfig {
  confidenceThreshold: number;
  nmsIouThreshold: number;
  maxDetections: number;
}

/**
 * Read one value from the channel-major output tensor.
 * Channel-major layout [1, C, N]: value = channel * candidateCount + candidateIndex.
 */
export function valueAt(
  output: Float32Array,
  channel: number,
  candidateIndex: number,
  candidateCount = YOLO_CANDIDATE_COUNT,
): number {
  return output[channel * candidateCount + candidateIndex];
}

/**
 * Decode raw model output into detections in source-pixel space.
 * Does NOT apply NMS — call applyClassAwareNms separately.
 */
export function decodeYoloOutput(
  output: Float32Array,
  meta: LetterboxMeta,
  confidenceThreshold: number,
): YoloRawDetection[] {
  const expectedLength = YOLO_OUTPUT_CHANNELS * YOLO_CANDIDATE_COUNT;
  if (output.length !== expectedLength) {
    throw new Error(
      `decodeYoloOutput: tensor length ${output.length}, expected ${expectedLength}`,
    );
  }

  const results: YoloRawDetection[] = [];

  for (let i = 0; i < YOLO_CANDIDATE_COUNT; i++) {
    const cx = valueAt(output, 0, i);
    const cy = valueAt(output, 1, i);
    const w = valueAt(output, 2, i);
    const h = valueAt(output, 3, i);
    // channel 4 is unused — deliberately skipped.

    let bestClassId = -1;
    let bestScore = 0;
    for (let c = 0; c < YOLO_CLASS_COUNT; c++) {
      const score = valueAt(output, YOLO_CLASS_CHANNEL_OFFSET + c, i);
      if (score > bestScore) {
        bestScore = score;
        bestClassId = c;
      }
    }

    if (bestClassId < 0 || bestScore < confidenceThreshold) continue;

    // Resolve duplicates / reject invalid classes (0 Not_used, out of range).
    const canonical = resolveYoloClass(bestClassId);
    if (!canonical) continue;

    // Letterbox space (640x640) -> source pixels.
    const inv = invertLetterboxBox(
      { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
      meta,
    );

    // Skip degenerate boxes that collapsed during the inverse transform.
    if (inv.x2 - inv.x1 < 1 || inv.y2 - inv.y1 < 1) continue;

    const rawInfo = resolveYoloClass(bestClassId); // canonical object
    results.push({
      x1: inv.x1,
      y1: inv.y1,
      x2: inv.x2,
      y2: inv.y2,
      score: bestScore,
      rawClassId: bestClassId,
      rawLabel: rawInfo?.yoloLabel ?? `class_${bestClassId}`,
      canonicalClassId: canonical.id,
      canonicalLabel: canonical.yoloLabel,
      wasDuplicate: bestClassId !== canonical.id,
    });
  }

  return results;
}

/** IoU of two source-pixel boxes in corner format. */
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
 * Class-aware NMS: boxes are only suppressed by other boxes of the SAME
 * canonical class. A Rupture_disk overlapping a Flange is kept — they are
 * different assets that may legitimately sit on top of each other on a P&ID.
 */
export function applyClassAwareNms(
  detections: YoloRawDetection[],
  iouThreshold: number,
  maxDetections: number,
): YoloRawDetection[] {
  const byClass = new Map<number, YoloRawDetection[]>();
  for (const d of detections) {
    const list = byClass.get(d.canonicalClassId);
    if (list) list.push(d);
    else byClass.set(d.canonicalClassId, [d]);
  }

  const kept: YoloRawDetection[] = [];
  for (const list of byClass.values()) {
    list.sort((a, b) => b.score - a.score);
    const classKept: YoloRawDetection[] = [];
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

  // Global ordering by score, then cap.
  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, maxDetections);
}

/**
 * Convert source-pixel detections to the project's normalized 0-1000 bbox
 * space, enriching with canonical class metadata.
 */
export function toNormalizedDetections(
  detections: YoloRawDetection[],
  meta: LetterboxMeta,
): YoloDetection[] {
  const { sourceWidth, sourceHeight } = meta;

  return detections.map((d) => {
    const widthPx = d.x2 - d.x1;
    const heightPx = d.y2 - d.y1;
    const info = resolveYoloClass(d.canonicalClassId);

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
      canonicalClassId: d.canonicalClassId,
      canonicalLabel: d.canonicalLabel,
      assetType: info?.assetType ?? 'UNKNOWN',
      detectionSubtype: info?.detectionSubtype,
      wasDuplicate: d.wasDuplicate,
    };
  });
}

/**
 * Convenience: decode -> class-aware NMS -> normalize.
 */
export function decodeAndFilter(
  output: Float32Array,
  meta: LetterboxMeta,
  config: YoloDecodeConfig,
): YoloDetection[] {
  const raw = decodeYoloOutput(output, meta, config.confidenceThreshold);
  const nmsed = applyClassAwareNms(raw, config.nmsIouThreshold, config.maxDetections);
  return toNormalizedDetections(nmsed, meta);
}
