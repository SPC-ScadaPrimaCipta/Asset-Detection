/**
 * YOLO evaluation matching logic — IoU-based Hungarian / greedy matching.
 *
 * Ground truth vs. Detection matching rules:
 *
 * 1. For a match (TP), the detection must have:
 *      - canonicalClassId === gt.classId
 *      - iou(det, gt) >= iouThreshold (default 0.50)
 *
 * 2. If multiple detections match one GT symbol, greedy selection picks the
 *    detection with the highest confidence. Additional matching detections
 *    become False Positives (duplicate detections).
 *
 * 3. If a detection overlaps a GT symbol with IoU >= threshold BUT different
 *    class, it is recorded as a "confusion" (misclassification) AND contributes
 *    1 FP + 1 FN.
 *
 * 4. Detections that don't match any GT symbol are False Positives.
 *
 * 5. GT symbols that don't match any detection are False Negatives.
 */

import { resolveYoloClass, YOLO_CLASS_MAP } from '@/lib/detection/yolo/yolo-class-map';
import type { YoloDetection } from '@/lib/detection/yolo/yolo-decoder';
import {
  type ConfusionRecord,
  type FalseNegativeRecord,
  type FalsePositiveRecord,
  type GroundTruthAnnotation,
  type GroundTruthBbox,
  type GroundTruthPage,
  type MatchRecord,
  type Metrics,
  type ThresholdResult,
} from './types';

/** Compute IoU between two pixel-coordinate bounding boxes. */
export function bboxIou(a: GroundTruthBbox, b: GroundTruthBbox): number {
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
  const inter = iw * ih;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - inter;

  return union > 0 ? inter / union : 0;
}

export function computeMetrics(tp: number, fp: number, fn: number): Metrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

/** Convert a YoloDetection pixelBox to GroundTruthBbox format. */
export function detectionToBbox(d: YoloDetection): GroundTruthBbox {
  return {
    x: d.pixelBox.x1,
    y: d.pixelBox.y1,
    width: d.pixelBox.x2 - d.pixelBox.x1,
    height: d.pixelBox.y2 - d.pixelBox.y1,
  };
}

/**
 * Match detections on ONE page against its ground truth at ONE confidence threshold.
 */
export function matchPage(
  page: GroundTruthPage,
  detections: YoloDetection[],
  threshold: number,
  iouThreshold = 0.5,
): {
  matches: MatchRecord[];
  falsePositives: FalsePositiveRecord[];
  falseNegatives: FalseNegativeRecord[];
  confusions: ConfusionRecord[];
} {
  // Filter detections by the active threshold.
  const activeDets = detections.filter((d) => d.confidence >= threshold);

  // Canonicalize GT class ids (e.g. if an annotator wrote duplicate id 5, resolve to 3).
  const normalizedGts: Array<GroundTruthAnnotation & { canonicalClassId: number }> = page.annotations.map(
    (g) => {
      const info = resolveYoloClass(g.classId);
      return {
        ...g,
        canonicalClassId: info?.id ?? g.classId,
      };
    },
  );

  // Sort detections descending by confidence for greedy matching.
  const sortedDets = [...activeDets].sort((a, b) => b.confidence - a.confidence);

  const matchedGtIds = new Set<string>();
  const matchedDetIndices = new Set<number>();
  const matches: MatchRecord[] = [];
  const confusions: ConfusionRecord[] = [];

  // Pass 1: exact class match with highest IoU >= threshold.
  for (let dIdx = 0; dIdx < sortedDets.length; dIdx++) {
    const d = sortedDets[dIdx];
    const dBbox = detectionToBbox(d);

    let bestGt: (typeof normalizedGts)[number] | null = null;
    let bestIou = 0;

    for (const g of normalizedGts) {
      if (matchedGtIds.has(g.id)) continue;
      if (g.canonicalClassId !== d.canonicalClassId) continue;

      const i = bboxIou(dBbox, g.bbox);
      if (i >= iouThreshold && i > bestIou) {
        bestIou = i;
        bestGt = g;
      }
    }

    if (bestGt) {
      matchedGtIds.add(bestGt.id);
      matchedDetIndices.add(dIdx);
      matches.push({
        pageId: page.pageId,
        classId: d.canonicalClassId,
        label: d.canonicalLabel,
        confidence: d.confidence,
        iou: bestIou,
        gtId: bestGt.id,
        detectionBbox: dBbox,
        gtBbox: bestGt.bbox,
      });
    }
  }

  // Pass 2: check remaining detections for class confusions (IoU >= threshold, class wrong).
  for (let dIdx = 0; dIdx < sortedDets.length; dIdx++) {
    if (matchedDetIndices.has(dIdx)) continue;
    const d = sortedDets[dIdx];
    const dBbox = detectionToBbox(d);

    for (const g of normalizedGts) {
      if (matchedGtIds.has(g.id)) continue;
      const i = bboxIou(dBbox, g.bbox);
      if (i >= iouThreshold) {
        confusions.push({
          pageId: page.pageId,
          gtId: g.id,
          gtClassId: g.canonicalClassId,
          gtLabel: g.label,
          predictedClassId: d.canonicalClassId,
          predictedLabel: d.canonicalLabel,
          confidence: d.confidence,
          iou: i,
        });
        break; // Record at most one confusion per detection.
      }
    }
  }

  // Build false positives: unmatched detections.
  const falsePositives: FalsePositiveRecord[] = [];
  for (let dIdx = 0; dIdx < sortedDets.length; dIdx++) {
    if (matchedDetIndices.has(dIdx)) continue;
    const d = sortedDets[dIdx];
    const dBbox = detectionToBbox(d);

    // Find any GT symbol that overlaps even a little (for categorization).
    const overlappingGtClasses: number[] = [];
    for (const g of normalizedGts) {
      if (bboxIou(dBbox, g.bbox) > 0.1) {
        overlappingGtClasses.push(g.canonicalClassId);
      }
    }

    falsePositives.push({
      pageId: page.pageId,
      classId: d.canonicalClassId,
      label: d.canonicalLabel,
      confidence: d.confidence,
      bbox: dBbox,
      category: 'unknown',
      overlappingGtClasses,
    });
  }

  // Build false negatives: unmatched GT symbols.
  const falseNegatives: FalseNegativeRecord[] = [];
  for (const g of normalizedGts) {
    if (matchedGtIds.has(g.id)) continue;

    // Find the best detection on this GT box, even if thresholded out or wrong class.
    let bestConf: number | null = null;
    let bestCls: number | null = null;
    for (const d of detections) {
      const dBbox = detectionToBbox(d);
      if (bboxIou(dBbox, g.bbox) >= 0.1) {
        if (bestConf === null || d.confidence > bestConf) {
          bestConf = d.confidence;
          bestCls = d.canonicalClassId;
        }
      }
    }

    falseNegatives.push({
      pageId: page.pageId,
      classId: g.canonicalClassId,
      label: g.label,
      gtId: g.id,
      bbox: g.bbox,
      bestDetectionConfidence: bestConf,
      bestDetectionClassId: bestCls,
    });
  }

  return { matches, falsePositives, falseNegatives, confusions };
}

/**
 * Aggregate match results across all pages into a ThresholdResult.
 */
export function aggregateThresholdResult(
  threshold: number,
  pages: GroundTruthPage[],
  pageDetections: Map<string, YoloDetection[]>,
  iouThreshold = 0.5,
  minSamplesPerClass = 5,
): ThresholdResult {
  const allMatches: MatchRecord[] = [];
  const allFps: FalsePositiveRecord[] = [];
  const allFns: FalseNegativeRecord[] = [];
  const allConfusions: ConfusionRecord[] = [];

  const perPage: ThresholdResult['perPage'] = [];

  for (const page of pages) {
    const dets = pageDetections.get(page.pageId) || [];
    const { matches, falsePositives, falseNegatives, confusions } = matchPage(
      page,
      dets,
      threshold,
      iouThreshold,
    );

    allMatches.push(...matches);
    allFps.push(...falsePositives);
    allFns.push(...falseNegatives);
    allConfusions.push(...confusions);

    perPage.push({
      pageId: page.pageId,
      ...computeMetrics(matches.length, falsePositives.length, falseNegatives.length),
    });
  }

  const global = computeMetrics(allMatches.length, allFps.length, allFns.length);

  // Per-class breakdown across all canonical classes present in either GT or detections.
  const classIds = new Set<number>();
  for (const p of pages) {
    for (const g of p.annotations) {
      const info = resolveYoloClass(g.classId);
      if (info) classIds.add(info.id);
    }
  }
  for (const m of allMatches) classIds.add(m.classId);
  for (const fp of allFps) classIds.add(fp.classId);

  const perClass: ThresholdResult['perClass'] = [];
  for (const classId of Array.from(classIds).sort((a, b) => a - b)) {
    const info = resolveYoloClass(classId) || YOLO_CLASS_MAP[classId];
    const label = info?.yoloLabel ?? `class_${classId}`;

    const tp = allMatches.filter((m) => m.classId === classId).length;
    const fp = allFps.filter((f) => f.classId === classId).length;
    const fn = allFns.filter((f) => f.classId === classId).length;
    const gtCount = tp + fn;

    perClass.push({
      classId,
      label,
      gtCount,
      insufficientSample: gtCount < minSamplesPerClass,
      ...computeMetrics(tp, fp, fn),
    });
  }

  // 10-bucket confidence distribution of all detections emitted on these pages.
  const histogram = Array(10).fill(0);
  for (const dets of pageDetections.values()) {
    for (const d of dets) {
      const b = Math.min(9, Math.floor(d.confidence * 10));
      histogram[b]++;
    }
  }
  const confidenceDistribution = histogram.map((count, i) => ({
    bucket: `${(i * 0.1).toFixed(1)}-${((i + 1) * 0.1).toFixed(1)}`,
    count,
  }));

  return {
    threshold,
    global,
    perPage,
    perClass,
    matches: allMatches,
    falsePositives: allFps,
    falseNegatives: allFns,
    confusions: allConfusions,
    confidenceDistribution,
  };
}
