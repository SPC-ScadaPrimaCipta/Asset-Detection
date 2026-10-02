/**
 * Shared legend reference-crop helper (Stage 3.5 fix).
 *
 * Upload and reparse previously duplicated this logic — and reparse's copy
 * silently dropped crop generation entirely (INSERT without
 * reference_image_url/hash), producing cropless legends. Single
 * implementation used by both routes now.
 *
 * Non-fatal by contract: returns nulls (with warn) instead of throwing,
 * so one bad bbox never fails an entire ingestion.
 */
import { saveFile } from '@/lib/storage';
import { cropPageRegion } from '@/lib/image-crop';
import { hashImage } from '@/lib/symbol-cache';

export interface LegendCropRef {
  refUrl: string | null;
  refHash: string | null;
}

export async function cropAndSaveSymbol(
  pngBase64: string,
  bbox: { x: number | null; y: number | null; width: number | null; height: number | null },
  imgW: number,
  imgH: number,
  legendId: string,
  page: number,
  padFraction = 0.05
): Promise<LegendCropRef> {
  const none: LegendCropRef = { refUrl: null, refHash: null };
  try {
    if (
      bbox.x == null || bbox.y == null || bbox.width == null || bbox.height == null ||
      imgW <= 0
    ) {
      return none;
    }
    const cropB64 = await cropPageRegion(
      pngBase64,
      { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      imgW, imgH, padFraction
    );
    if (!cropB64) return none;
    const refHash = hashImage(cropB64);
    const refName = `legend-${legendId}-p${page}-${refHash.slice(0, 12)}.png`;
    await saveFile(refName, Buffer.from(cropB64, 'base64'));
    return { refUrl: refName, refHash };
  } catch (e) {
    console.warn(
      `[legend-crop] legend ${legendId} page ${page} ref crop failed (non-fatal):`,
      (e as Error).message?.slice(0, 150)
    );
    return none;
  }
}
