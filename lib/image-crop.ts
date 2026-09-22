/**
 * Image Crop Utility
 *
 * Crops a rectangular region from a PNG image (base64-encoded) using mupdf Pixmap.
 * Input bbox is in 0-1000 normalized coordinate space (same as detection bboxes).
 * Output is a base64-encoded PNG of the cropped region.
 *
 * Uses mupdf Pixmap pixel copy — no external dependencies (mupdf already in stack).
 * Runs only in Node.js / worker context (not browser-safe).
 */

interface BBox {
  x: number;       // 0-1000 normalized
  y: number;       // 0-1000 normalized
  width: number;   // 0-1000 normalized
  height: number;  // 0-1000 normalized
}

/**
 * Crop a region from a base64-encoded PNG image.
 *
 * @param pngBase64  - Full page PNG, base64-encoded (no data: prefix)
 * @param bbox       - Bounding box in 0-1000 normalized coordinate space
 * @param imgWidth   - Actual pixel width of the PNG (from renderPageToPng)
 * @param imgHeight  - Actual pixel height of the PNG (from renderPageToPng)
 * @param padFraction - Expand bbox by this fraction on each side (default 0.02 = 2%)
 *                     Helps capture nearby text (tags often just outside symbol boundary)
 * @returns base64-encoded PNG of cropped region, or null on failure
 */
export async function cropPageRegion(
  pngBase64: string,
  bbox: BBox,
  imgWidth: number,
  imgHeight: number,
  padFraction = 0.02
): Promise<string | null> {
  try {
    const { Image, Pixmap, ColorSpace } = await import('mupdf' as string);

    const pngBuf = Buffer.from(pngBase64, 'base64');
    const img = new Image(pngBuf);
    const srcPm: {
      getWidth(): number;
      getHeight(): number;
      getNumberOfComponents(): number;
      getStride(): number;
      getPixels(): Uint8ClampedArray;
    } = img.toPixmap();

    const srcW = srcPm.getWidth();
    const srcH = srcPm.getHeight();
    const nComp = srcPm.getNumberOfComponents();
    const srcStride = srcPm.getStride();
    const srcPixels = srcPm.getPixels();

    // Convert 0-1000 normalized bbox → pixel coordinates
    const scaleX = srcW / 1000;
    const scaleY = srcH / 1000;

    const padX = bbox.width * padFraction * scaleX;
    const padY = bbox.height * padFraction * scaleY;

    const cx0 = Math.max(0, Math.floor(bbox.x * scaleX - padX));
    const cy0 = Math.max(0, Math.floor(bbox.y * scaleY - padY));
    const cx1 = Math.min(srcW, Math.ceil((bbox.x + bbox.width) * scaleX + padX));
    const cy1 = Math.min(srcH, Math.ceil((bbox.y + bbox.height) * scaleY + padY));

    const cw = cx1 - cx0;
    const ch = cy1 - cy0;

    // Guard: minimum 10x10 pixel crop
    if (cw < 10 || ch < 10) {
      return null;
    }

    // Create destination Pixmap for cropped region
    const cropPm: {
      getStride(): number;
      getPixels(): Uint8ClampedArray;
      asPNG(): Uint8Array;
    } = new Pixmap(ColorSpace.DeviceRGB, [0, 0, cw, ch], false);
    const cropPixels = cropPm.getPixels();
    const dstStride = cropPm.getStride();

    // Copy pixel rows from source region to destination
    for (let row = 0; row < ch; row++) {
      const srcOff = (cy0 + row) * srcStride + cx0 * nComp;
      const dstOff = row * dstStride;
      for (let col = 0; col < cw * nComp; col++) {
        cropPixels[dstOff + col] = srcPixels[srcOff + col];
      }
    }

    const cropPng = cropPm.asPNG();
    return Buffer.from(cropPng).toString('base64');
  } catch (err) {
    console.warn('[image-crop] crop failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Expand a bbox in 0-1000 normalized space to capture nearby text context.
 * Useful for tag detection — tags often appear just outside symbol boundary.
 *
 * @param bbox        - Original bbox in 0-1000 space
 * @param expandBy    - Units to expand on each side (default 60 = 6% of canvas)
 * @returns expanded bbox, clamped to [0, 1000]
 */
export function expandBBox(
  bbox: BBox,
  expandBy = 60
): BBox {
  return {
    x: Math.max(0, bbox.x - expandBy),
    y: Math.max(0, bbox.y - expandBy),
    width: Math.min(1000 - Math.max(0, bbox.x - expandBy), bbox.width + expandBy * 2),
    height: Math.min(1000 - Math.max(0, bbox.y - expandBy), bbox.height + expandBy * 2),
  };
}

/**
 * Adaptive bbox expansion based on symbol size.
 * M2 fix: flat 60-unit expand causes noise for small symbols (30-50 units).
 *
 * Strategy:
 *   - Minimum expand: 20 units (enough to catch tag text just outside symbol)
 *   - Proportional: 40% of symbol's average dimension
 *   - Maximum: 80 units (prevents pulling in unrelated nearby symbols)
 *
 * For a 40×40 symbol: expand = max(20, min(80, 40*0.40)) = max(20, min(80, 16)) = 20
 * For a 60×60 symbol: expand = max(20, min(80, 60*0.40)) = max(20, min(80, 24)) = 24
 * For a 150×150 vessel: expand = max(20, min(80, 150*0.40)) = max(20, min(80, 60)) = 60
 */
export function adaptiveExpandBBox(bbox: BBox): BBox {
  const avgDim = (bbox.width + bbox.height) / 2;
  const expandBy = Math.max(20, Math.min(80, Math.round(avgDim * 0.40)));
  return expandBBox(bbox, expandBy);
}
