/**
 * YOLO Detection Merge Utilities
 * 
 * Provides:
 * - IoU (Intersection over Union) calculation for NMS
 * - YOLO class ID/name → Legend symbol matching
 * - YOLO class → Asset Type mapping
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimal legend symbol interface for YOLO class mapping. */
interface LegendSymbolRef {
  symbol_name: string;
  asset_type: string;
  aliases?: string[] | null;
}

/**
 * Compute Intersection over Union (IoU) between two bounding boxes.
 * Boxes in normalized 0-1000 coordinate space.
 */
export function computeIoU(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;

  if (intersectionArea === 0) return 0;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;

  return intersectionArea / unionArea;
}

/**
 * Map YOLO v203 class name to asset type via legend symbol matching.
 * 
 * Matching strategy:
 * 1. Exact name match (case-insensitive)
 * 2. Alias match
 * 3. Partial substring match (e.g., "Control Valve" matches "Valve")
 * 4. Embedding similarity (if available, cosine > 0.85)
 * 5. Fallback: return class name as-is (manual review)
 * 
 * @param yoloClassName YOLO model class name (e.g., "Pump", "Control Valve")
 * @param legendSymbols Available legend symbols for this project
 * @param projectId Project ID for embedding search scope
 * @returns Matched asset type or YOLO class name if no match
 */
export async function mapYoloClassToAssetType(
  yoloClassName: string,
  legendSymbols: Array<LegendSymbolRef>,
  projectId?: string | null
): Promise<string> {
  const lowerClass = yoloClassName.toLowerCase();

  // 1. Exact symbol name match
  for (const sym of legendSymbols) {
    if (sym.symbol_name.toLowerCase() === lowerClass) {
      return sym.asset_type;
    }
  }

  // 2. Alias match
  for (const sym of legendSymbols) {
    if (sym.aliases?.some((alias: string) => alias.toLowerCase() === lowerClass)) {
      return sym.asset_type;
    }
  }

  // 3. Partial substring match (e.g., "Control Valve" matches "Valve")
  for (const sym of legendSymbols) {
    const symLower = sym.symbol_name.toLowerCase();
    if (lowerClass.includes(symLower) || symLower.includes(lowerClass)) {
      return sym.asset_type;
    }
  }

  // 4. Embedding similarity (async fallback)
  if (projectId) {
    try {
      const { embedCanonical } = await import('@/lib/embedding-service');
      const { searchSimilar } = await import('@/lib/vector-repository');
      
      // Generate embedding for YOLO class name
      const embResult = await embedCanonical(yoloClassName);
      if (embResult && embResult.embedding.length > 0) {
        const matches = await searchSimilar({
          embedding: embResult.embedding,
          projectId,
          limit: 1,
        });
        
        // High-confidence embedding match (> 0.85 similarity)
        if (matches.length > 0 && matches[0].similarity > 0.85) {
          return matches[0].asset_type;
        }
      }
    } catch (embErr) {
      // Non-fatal: continue to fallback
      console.warn('[YOLO] Embedding similarity failed:', embErr instanceof Error ? embErr.message : String(embErr));
    }
  }

  // 5. Fallback: return original class name (will need manual review)
  return yoloClassName;
}

/**
 * Check if YOLO detection bbox overlaps with existing text-based detection.
 * Used for duplicate suppression before merging.
 * 
 * @param yoloBbox YOLO detection bounding box
 * @param textDetections Existing text-based detections
 * @param iouThreshold IoU threshold for overlap (default: 0.3)
 * @returns true if YOLO bbox overlaps with any existing detection
 */
export function hasOverlap(
  yoloBbox: BoundingBox,
  textDetections: Array<{ bbox: BoundingBox }>,
  iouThreshold: number = 0.3
): boolean {
  return textDetections.some(det => {
    const iou = computeIoU(yoloBbox, det.bbox);
    return iou > iouThreshold;
  });
}
