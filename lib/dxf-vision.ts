/**
 * DXF Vision Lap-2 merge (Blok 3.2)
 *
 * runHybridPipeline works in REGION-normalized 0-1000 space (per rendered PNG).
 * DxfViewer + DB persist use WHOLE-FILE-normalized 0-1000 space. This module:
 *   1. converts vision bboxes region-norm → global-norm (via the padded view
 *      extents the renderer actually used), and
 *   2. merges vision detections into vector Lap-1 detections:
 *      - same tag + same sheet + centers near → ONE detection. Vector wins
 *        for tag/type when resolved; vision box wins when the vector box is
 *        estimated (no real geometry). Evidence from both sides is kept.
 *      - vision-only (untagged or unmatched tag) → new REVIEW-leaning candidate.
 *
 * Deterministic, no I/O.
 */

import { dxfToNorm, type DxfPageExtents, type DxfPoint } from '@/lib/dxf-parser';
import { UNKNOWN_ASSET_TYPE, type DxfDetection } from '@/lib/dxf-detection';
import { sanitizeAssetType } from '@/lib/validation';
import type { PersistableDetection } from '@/lib/detection/persistence/detection-repository';

export interface VisionDetectionInput {
  assetTag: string | null;
  assetType: string;
  description?: string | null;
  confidence: number;
  /** Bbox in REGION-normalized 0-1000 space (hybrid pipeline output). */
  bboxNorm: { x: number; y: number; width: number; height: number };
  evidence: string[];
  detectionSource?: string;
}

/** Region-norm (0-1000 over padded view) → whole-file-norm (0-1000). */
export function regionNormToGlobalNorm(
  bbox: { x: number; y: number; width: number; height: number },
  viewExtents: DxfPageExtents,
  globalExtents: DxfPageExtents,
): DxfDetection['bbox'] {
  const toWorld = (nx: number, ny: number): DxfPoint => ({
    x: viewExtents.minX + (nx / 1000) * viewExtents.width,
    // SVG/PNG y=0 is top; DXF y grows upward
    y: viewExtents.maxY - (ny / 1000) * viewExtents.height,
  });
  const tl = dxfToNorm(toWorld(bbox.x, bbox.y), globalExtents);
  const br = dxfToNorm(toWorld(bbox.x + bbox.width, bbox.y + bbox.height), globalExtents);
  const x = Math.max(0, Math.min(tl.x, br.x));
  const y = Math.max(0, Math.min(tl.y, br.y));
  return {
    x, y,
    width: Math.max(4, Math.abs(br.x - tl.x)),
    height: Math.max(4, Math.abs(br.y - tl.y)),
  };
}

/** World position of a global-norm bbox center (for Gemini-fallback context). */
export function globalNormCenterToWorld(
  bbox: DxfDetection['bbox'],
  globalExtents: DxfPageExtents,
): DxfPoint {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  return {
    x: globalExtents.minX + (cx / 1000) * globalExtents.width,
    y: globalExtents.maxY - (cy / 1000) * globalExtents.height,
  };
}

function normTag(tag: string | null): string {
  return (tag ?? '').trim().toUpperCase();
}

function bboxCenter(b: DxfDetection['bbox']): DxfPoint {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function vectorBoxIsEstimated(d: DxfDetection): boolean {
  return d.evidence.some((e) => e.includes('estimated') || e.includes('vision required'));
}

export interface VisionMergeStats {
  visionTotal: number;
  mergedIntoVector: number;
  visionOnlyNew: number;
  typeUpgraded: number;
  boxUpgraded: number;
  /** Rejected by validation gates (invalid tag / low-quality untagged). */
  droppedInvalidTag: number;
  droppedLowQuality: number;
}

/** Merge threshold in GLOBAL 0-1000 space. */
export const VISION_MERGE_DIST_NORM = 60;

/**
 * Merge one region's vision detections into the vector detection list (mutated
 * in place for merges; new candidates appended). Returns merge stats for the
 * agreement metric (mergedIntoVector / visionTotal).
 */
export function mergeVisionDetections(
  vector: DxfDetection[],
  vision: VisionDetectionInput[] | PersistableDetection[],
  viewExtents: DxfPageExtents,
  globalExtents: DxfPageExtents,
  pidPage: number,
  regionIndex: number,
  /** Tag gate — reject hallucinated tags ("9", "X", "4"). Defaults to accept. */
  isTagValid?: (tag: string | null) => boolean,
  /** Min confidence for untagged vision-only candidates (default 0.6). */
  minUntaggedConfidence = 0.6,
): VisionMergeStats {
  const stats: VisionMergeStats = {
    visionTotal: vision.length,
    mergedIntoVector: 0,
    visionOnlyNew: 0,
    typeUpgraded: 0,
    boxUpgraded: 0,
    droppedInvalidTag: 0,
    droppedLowQuality: 0,
  };

  for (const raw of vision) {
    // Normalisasi dua bentuk input ke VisionDetectionInput.
    const v: VisionDetectionInput = ('bboxNorm' in raw && (raw as VisionDetectionInput).bboxNorm)
      ? (raw as VisionDetectionInput)
      : {
          assetTag: (raw as PersistableDetection).assetTag ?? null,
          assetType: (raw as PersistableDetection).assetType ?? UNKNOWN_ASSET_TYPE,
          description: (raw as PersistableDetection).description ?? null,
          confidence: (raw as PersistableDetection).confidence ?? 0,
          bboxNorm: (raw as PersistableDetection).bbox,
          evidence: Array.isArray((raw as PersistableDetection).evidence)
            ? (raw as PersistableDetection).evidence as string[]
            : [],
          detectionSource: String((raw as PersistableDetection).detection_source ?? ''),
        };
    // Gate 1: hallucinated tags never enter the merge ("9", "X", "4"...).
    if (v.assetTag && isTagValid && !isTagValid(v.assetTag)) {
      stats.droppedInvalidTag++;
      continue;
    }
    const vTag = normTag(v.assetTag);
    const vBox = regionNormToGlobalNorm(v.bboxNorm, viewExtents, globalExtents);
    const vCenter = bboxCenter(vBox);

    let match: DxfDetection | null = null;
    if (vTag) {
      let bestD = Infinity;
      for (const d of vector) {
        if (d.pidPage !== pidPage) continue;
        if (normTag(d.assetTag) !== vTag) continue;
        const c = bboxCenter(d.bbox);
        const dist = Math.hypot(c.x - vCenter.x, c.y - vCenter.y);
        if (dist <= VISION_MERGE_DIST_NORM && dist < bestD) { bestD = dist; match = d; }
      }
    }

    if (match) {
      stats.mergedIntoVector++;
      const vType = sanitizeAssetType(v.assetType);
      if ((match.assetType === UNKNOWN_ASSET_TYPE || !match.assetType) && vType !== UNKNOWN_ASSET_TYPE) {
        match.assetType = vType;
        stats.typeUpgraded++;
      }
      if (vectorBoxIsEstimated(match)) {
        match.bbox = vBox;
        match.rawPosition = globalNormCenterToWorld(vBox, globalExtents);
        stats.boxUpgraded++;
      }
      match.confidence = Math.min(0.99, Math.max(match.confidence, Math.min(v.confidence, 0.95)));
      const vEv = v.evidence ?? [];
      for (const e of vEv.slice(0, 3)) {
        if (match.evidence.length < 12 && !match.evidence.includes(e)) match.evidence.push(e);
      }
      if (match.assetType !== UNKNOWN_ASSET_TYPE && match.needsGeminiClassification && v.confidence >= 0.6) {
        match.needsGeminiClassification = false;
      }
    } else {
      // Gate 2: untagged low-confidence vision is review-queue flooding, not signal.
      if (!vTag && v.confidence < minUntaggedConfidence) {
        stats.droppedLowQuality++;
        continue;
      }
      stats.visionOnlyNew++;
      const vType = sanitizeAssetType(v.assetType);
      const untagged = !vTag;
      const vEvidence = [...(v.evidence ?? []).slice(0, 4)];
      const vDesc = v.description ?? null;
      vEvidence.unshift(
        untagged
          ? 'Vision-only symbol (no vector tag nearby) — human review required'
          : `Vision tag "${vTag}" has no vector counterpart on this sheet — human review required`,
      );
      vector.push({
        assetTag: vTag || null,
        assetType: vType,
        description: vDesc,
        // Untagged vision candidates lean REVIEW; tagged-but-unmatched stay modest.
        confidence: untagged
          ? Math.min(v.confidence, 0.55)
          : Math.min(v.confidence, 0.7),
        bbox: vBox,
        evidence: vEvidence,
        blockName: null,
        layer: `vision:sheet-${pidPage}`,
        source: 'VISION',
        rawPosition: globalNormCenterToWorld(vBox, globalExtents),
        regionIndex,
        pidPage,
        needsGeminiClassification: true,
      });
    }
  }
  return stats;
}
