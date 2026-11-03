/**
 * Bbox Refinement ΓÇö snap detections to actual symbol boundaries
 * Uses edge detection to find true symbol edges
 */

import sharp from 'sharp';

export interface BboxRefinementResult {
  x: number;
  y: number;
  width: number;
  height: number;
  refined: boolean;
  confidence: number;
}

/**
 * Refine bbox by detecting symbol edges in image
 * Returns snapped bbox coordinates
 */
export async function refineBboxToSymbolEdges(
  imageBuffer: Buffer,
  bboxNorm: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): Promise<BboxRefinementResult> {
  try {
    // Convert normalized coords to pixel coords
    const bboxPx = {
      x: Math.round((bboxNorm.x / 1000) * imageWidth),
      y: Math.round((bboxNorm.y / 1000) * imageHeight),
      width: Math.round((bboxNorm.width / 1000) * imageWidth),
      height: Math.round((bboxNorm.height / 1000) * imageHeight),
    };

    // Extract region around detection
    const expandPx = 30; // expand search area
    const region = {
      x: Math.max(0, bboxPx.x - expandPx),
      y: Math.max(0, bboxPx.y - expandPx),
      width: Math.min(imageWidth, bboxPx.width + expandPx * 2),
      height: Math.min(imageHeight, bboxPx.height + expandPx * 2),
    };

    const crop = await sharp(imageBuffer)
      .extract({
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height,
      })
      .toBuffer();

    // Edge detection via Canny-like operation
    const edges = await sharp(crop)
      .greyscale()
      .normalize()
      .threshold(100) // edge threshold
      .toBuffer({ resolveWithObject: true });

    // Simple bbox fitting: find min/max non-zero coordinates
    // In production, use OpenCV for proper contour detection
    const refined = fitBboxToContours(edges.data, region, bboxPx);

    return {
      x: refined.x,
      y: refined.y,
      width: refined.width,
      height: refined.height,
      refined: true,
      confidence: 0.85,
    };
  } catch (err) {
    // Fallback: return original bbox
    return {
      x: bboxNorm.x,
      y: bboxNorm.y,
      width: bboxNorm.width,
      height: bboxNorm.height,
      refined: false,
      confidence: 0.5,
    };
  }
}

/**
 * Simple bbox fitting to detected edges
 * Returns refined bbox in pixel coordinates
 */
function fitBboxToContours(
  edgeData: Buffer,
  region: { x: number; y: number; width: number; height: number },
  originalBbox: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  // Find bounding box of edge pixels
  let minX = originalBbox.width,
    maxX = 0,
    minY = originalBbox.height,
    maxY = 0;
  let edgePixelCount = 0;

  for (let i = 0; i < edgeData.length; i += 4) {
    const brightness = edgeData[i]; // R channel
    if (brightness > 128) {
      // Edge pixel
      const pixelIdx = i / 4;
      const x = pixelIdx % region.width;
      const y = Math.floor(pixelIdx / region.width);

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      edgePixelCount++;
    }
  }

  // If no edges detected, return original
  if (edgePixelCount === 0) {
    return originalBbox;
  }

  // Convert back to global coordinates
  return {
    x: region.x + minX,
    y: region.y + minY,
    width: Math.max(10, maxX - minX),
    height: Math.max(10, maxY - minY),
  };
}

/**
 * Validate bbox ΓÇö ensure it's within image bounds and reasonable size
 */
export function validateBbox(
  bbox: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  minSize: number = 10,
  maxSize: number = 500
): boolean {
  return (
    bbox.x >= 0 &&
    bbox.y >= 0 &&
    bbox.x + bbox.width <= imageWidth &&
    bbox.y + bbox.height <= imageHeight &&
    bbox.width >= minSize &&
    bbox.height >= minSize &&
    bbox.width <= maxSize &&
    bbox.height <= maxSize
  );
}
