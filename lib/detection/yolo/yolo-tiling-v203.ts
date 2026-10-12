/**
 * YOLO v203 Native-Resolution Tiling & Global Merge Pipeline (Phase 2 Pilot)
 *
 * SCOPE & CONTRACT:
 *   - Native resolution slicing (1024x1024 tiles, target 20% overlap, stride 819 px).
 *   - Zero upscaling/downscaling (scale = 1.0 always).
 *   - Boundary padding with grey (114) for tiles near or beyond page bounds with explicit valid dimensions:
 *       validWidth  = min(1024, pageWidth  - tileX)
 *       validHeight = min(1024, pageHeight - tileY)
 *   - Deterministic coordinate translation: page_coord = tile_coord + tile_offset.
 *   - Padding rejection and boundary clipping (degenerate/pure-padding boxes dropped).
 *   - Class-aware global merge (IoU >= 0.50 baseline) with deterministic tie-breaking:
 *       1. score descending
 *       2. tileIndex ascending
 *       3. detectionIndex ascending
 *   - Semantic fields remain unresolved (null).
 */

import {
  YOLO_V203_INPUT_SIZE,
} from '@/lib/detection/yolo/yolo-class-map-v203';

export const DEFAULT_TILE_SIZE = YOLO_V203_INPUT_SIZE; // 1024
export const DEFAULT_TILE_STRIDE = 819; // ~20% overlap on 1024
export const DEFAULT_PAD_VALUE = 114;
export const DEFAULT_GLOBAL_MERGE_IOU = 0.50;
export const DEFAULT_PER_TILE_MAX_DETECTIONS = 300;

export interface TileDescriptor {
  tileIndex: number;
  colIndex: number;
  rowIndex: number;
  x: number; // left in page pixel space
  y: number; // top in page pixel space
  width: number; // always 1024
  height: number; // always 1024
  validWidth: number; // min(1024, pageWidth - x)
  validHeight: number; // min(1024, pageHeight - y)
  hasPadding: boolean;
}

export interface TileGridSpec {
  pageSize: { width: number; height: number };
  tileSize: number;
  stride: number;
  xOffsets: number[];
  yOffsets: number[];
  tiles: TileDescriptor[];
}

export interface RawPageDetection {
  /** Page-space coordinates [x1, y1, x2, y2]. */
  pageBox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
  rawClassId: number;
  rawLabel: string;
  tileIndex: number;
  detectionIndex: number;
  /** Tile-space coordinates [x1, y1, x2, y2]. */
  tileBox: { x1: number; y1: number; x2: number; y2: number };
  assetType: null;
  equipmentClass: null;
  detectionSubtype: null;
}

export interface SuppressionTrace {
  suppressedCandidateId: string;
  suppressorCandidateId: string;
  rawClassId: number;
  iou: number;
  reason: 'same_class_iou_at_or_above_threshold';
  candidate: RawPageDetection;
  suppressedBy: RawPageDetection;
}

export interface GlobalMergeResult {
  kept: RawPageDetection[];
  suppressed: SuppressionTrace[];
  totalBeforeMerge: number;
  totalAfterMerge: number;
}

export function getDetectionId(detection: Pick<RawPageDetection, 'rawClassId' | 'tileIndex' | 'detectionIndex'>): string {
  return `${detection.rawClassId}:${detection.tileIndex}:${detection.detectionIndex}`;
}

export function capPerTileDetections<T extends { score: number; rawClassId: number; bbox: [number, number, number, number]; anchor: number }>(
  detections: T[],
  maxDetections = DEFAULT_PER_TILE_MAX_DETECTIONS,
): { sorted: T[]; preCapCount: number; cappedCount: number } {
  const sorted = [...detections].sort((a, b) =>
    b.score - a.score ||
    a.rawClassId - b.rawClassId ||
    a.bbox[1] - b.bbox[1] ||
    a.bbox[0] - b.bbox[0] ||
    a.bbox[3] - b.bbox[3] ||
    a.bbox[2] - b.bbox[2] ||
    a.anchor - b.anchor,
  );
  return {
    sorted: sorted.slice(0, maxDetections),
    preCapCount: sorted.length,
    cappedCount: Math.min(sorted.length, maxDetections),
  };
}

/**
 * Computes deterministic tile offsets along a single dimension.
 *
 * - If dimension <= tileSize: exactly [0]
 * - If dimension > tileSize: steps by stride, with the final offset pinned to (dimension - tileSize)
 * - Offsets are deduplicated and returned in strictly ascending order.
 */
export function generateAxisOffsets(
  dimension: number,
  tileSize = DEFAULT_TILE_SIZE,
  stride = DEFAULT_TILE_STRIDE,
): number[] {
  if (dimension <= 0) return [0];
  if (dimension <= tileSize) return [0];

  const offsets: number[] = [0];
  let curr = 0;
  while (curr + stride + tileSize <= dimension) {
    curr += stride;
    offsets.push(curr);
  }

  const lastOffset = dimension - tileSize;
  if (lastOffset > 0) {
    offsets.push(lastOffset);
  }

  // Deduplicate and sort ascending
  return Array.from(new Set(offsets)).sort((a, b) => a - b);
}

/**
 * Builds the complete tile grid specification for a given page dimension.
 */
export function computeTileGrid(
  pageWidth: number,
  pageHeight: number,
  tileSize = DEFAULT_TILE_SIZE,
  stride = DEFAULT_TILE_STRIDE,
): TileGridSpec {
  const xOffsets = generateAxisOffsets(pageWidth, tileSize, stride);
  const yOffsets = generateAxisOffsets(pageHeight, tileSize, stride);

  const tiles: TileDescriptor[] = [];
  let tileIndex = 0;

  for (let r = 0; r < yOffsets.length; r++) {
    const y = yOffsets[r];
    for (let c = 0; c < xOffsets.length; c++) {
      const x = xOffsets[c];
      const validWidth = Math.max(0, Math.min(tileSize, pageWidth - x));
      const validHeight = Math.max(0, Math.min(tileSize, pageHeight - y));
      const hasPadding = validWidth < tileSize || validHeight < tileSize;

      tiles.push({
        tileIndex,
        colIndex: c,
        rowIndex: r,
        x,
        y,
        width: tileSize,
        height: tileSize,
        validWidth,
        validHeight,
        hasPadding,
      });

      tileIndex++;
    }
  }

  return {
    pageSize: { width: pageWidth, height: pageHeight },
    tileSize,
    stride,
    xOffsets,
    yOffsets,
    tiles,
  };
}

/**
 * Extracts a 1024x1024 float32 NCHW tensor directly from a raw decoded RGB uint8 page buffer.
 *
 * ZERO RESIZE: Copies pixels 1:1.
 * If validWidth < 1024 or validHeight < 1024, the padding region is filled with padValue (default 114).
 */
export function extractTileTensorFromRgb(
  pageRgb: Uint8Array,
  pageWidth: number,
  pageHeight: number,
  tile: TileDescriptor,
  tileSize = DEFAULT_TILE_SIZE,
  padValue = DEFAULT_PAD_VALUE,
): Float32Array {
  const planeSize = tileSize * tileSize;
  const tensor = new Float32Array(3 * planeSize);

  // Fill with normalized padding value if padding is needed
  if (tile.hasPadding) {
    const normPad = padValue / 255.0;
    tensor.fill(normPad);
  }

  const validW = tile.validWidth;
  const validH = tile.validHeight;
  const tileX = tile.x;
  const tileY = tile.y;

  for (let r = 0; r < validH; r++) {
    const srcRow = tileY + r;
    if (srcRow >= pageHeight) break;

    const srcRowOffset = srcRow * pageWidth * 3;
    const dstRowOffset = r * tileSize;

    for (let c = 0; c < validW; c++) {
      const srcCol = tileX + c;
      if (srcCol >= pageWidth) break;

      const srcPixel = srcRowOffset + srcCol * 3;
      const dstIdx = dstRowOffset + c;

      tensor[dstIdx] = pageRgb[srcPixel] / 255.0; // R
      tensor[planeSize + dstIdx] = pageRgb[srcPixel + 1] / 255.0; // G
      tensor[2 * planeSize + dstIdx] = pageRgb[srcPixel + 2] / 255.0; // B
    }
  }

  return tensor;
}

/**
 * Maps a detection in tile-local pixel coordinates to page pixel coordinates.
 *
 * Drops boxes that fall entirely inside the padding region or collapse to < 1px width/height.
 */
export function mapTileDetectionToPage(
  tileBox: { x1: number; y1: number; x2: number; y2: number },
  tile: TileDescriptor,
  pageWidth: number,
  pageHeight: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  // If box starts entirely inside the padding region, reject it
  if (tileBox.x1 >= tile.validWidth || tileBox.y1 >= tile.validHeight) {
    return null;
  }

  // Clamp within the valid image area of the tile
  const clampedTileX1 = Math.max(0, Math.min(tile.validWidth, tileBox.x1));
  const clampedTileY1 = Math.max(0, Math.min(tile.validHeight, tileBox.y1));
  const clampedTileX2 = Math.max(0, Math.min(tile.validWidth, tileBox.x2));
  const clampedTileY2 = Math.max(0, Math.min(tile.validHeight, tileBox.y2));

  // Reject degenerate boxes
  if (clampedTileX2 - clampedTileX1 < 1 || clampedTileY2 - clampedTileY1 < 1) {
    return null;
  }

  // Translate to page coordinates
  const pageX1 = clampedTileX1 + tile.x;
  const pageY1 = clampedTileY1 + tile.y;
  const pageX2 = clampedTileX2 + tile.x;
  const pageY2 = clampedTileY2 + tile.y;

  // Final page boundary clamping
  const finalX1 = Math.max(0, Math.min(pageWidth, pageX1));
  const finalY1 = Math.max(0, Math.min(pageHeight, pageY1));
  const finalX2 = Math.max(0, Math.min(pageWidth, pageX2));
  const finalY2 = Math.max(0, Math.min(pageHeight, pageY2));

  if (finalX2 - finalX1 < 1 || finalY2 - finalY1 < 1) {
    return null;
  }

  return { x1: finalX1, y1: finalY1, x2: finalX2, y2: finalY2 };
}

/**
 * Computes exact geometric IoU between two bounding boxes.
 */
export function computeBoxIoU(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): number {
  const interX1 = Math.max(a.x1, b.x1);
  const interY1 = Math.max(a.y1, b.y1);
  const interX2 = Math.min(a.x2, b.x2);
  const interY2 = Math.min(a.y2, b.y2);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  if (interArea <= 0) return 0;

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Merges overlapping candidates across tiles in a class-aware manner.
 *
 * Tie-break rule:
 *   1. score descending (highest confidence wins)
 *   2. tileIndex ascending (earlier tile index breaks ties)
 *   3. detectionIndex ascending (earlier candidate index breaks ties)
 */
export function mergeGlobalDetectionsClassAware(
  candidates: RawPageDetection[],
  globalMergeIoU = DEFAULT_GLOBAL_MERGE_IOU,
): GlobalMergeResult {
  const distinctClasses = Array.from(new Set(candidates.map((c) => c.rawClassId))).sort((a, b) => a - b);
  const kept: RawPageDetection[] = [];
  const suppressed: GlobalMergeResult['suppressed'] = [];

  for (const classId of distinctClasses) {
    const classCandidates = candidates.filter((c) => c.rawClassId === classId);

    // Deterministic sorting with explicit multi-level tie-breaking
    classCandidates.sort((a, b) => {
      if (Math.abs(b.confidence - a.confidence) > 1e-9) {
        return b.confidence - a.confidence;
      }
      if (a.tileIndex !== b.tileIndex) {
        return a.tileIndex - b.tileIndex;
      }
      return a.detectionIndex - b.detectionIndex;
    });

    const isSuppressed = new Array<boolean>(classCandidates.length).fill(false);

    for (let i = 0; i < classCandidates.length; i++) {
      if (isSuppressed[i]) continue;

      const active = classCandidates[i];
      kept.push(active);

      for (let j = i + 1; j < classCandidates.length; j++) {
        if (isSuppressed[j]) continue;

        const neighbor = classCandidates[j];
        const iou = computeBoxIoU(active.pageBox, neighbor.pageBox);

        if (iou >= globalMergeIoU) {
          isSuppressed[j] = true;
          suppressed.push({
            suppressedCandidateId: getDetectionId(neighbor),
            suppressorCandidateId: getDetectionId(active),
            rawClassId: classId,
            iou,
            reason: 'same_class_iou_at_or_above_threshold',
            candidate: neighbor,
            suppressedBy: active,
          });
        }
      }
    }
  }

  // Sort final kept detections deterministically
  kept.sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 1e-9) {
      return b.confidence - a.confidence;
    }
    if (a.rawClassId !== b.rawClassId) {
      return a.rawClassId - b.rawClassId;
    }
    if (a.pageBox.y1 !== b.pageBox.y1) {
      return a.pageBox.y1 - b.pageBox.y1;
    }
    return a.pageBox.x1 - b.pageBox.x1;
  });

  return {
    kept,
    suppressed,
    totalBeforeMerge: candidates.length,
    totalAfterMerge: kept.length,
  };
}
