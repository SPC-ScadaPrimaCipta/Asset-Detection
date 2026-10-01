/**
 * Region cropping for Gemini P&ID extraction.
 *
 * Crops one region out of a rendered page PNG and upscales it so small symbols
 * survive the trip. Mirrors the crop step in Scan Legend
 * (lib/legend-extract.ts → extractLegendSymbolsFromPng).
 *
 * `sharp` is imported lazily: the region path is optional, so applications that
 * scan legends only should not pay for it.
 */
import { regionPixelRect, type Region } from './region-plan';

/** Minimum crop width sent to Gemini, matching Scan Legend. */
const MIN_CROP_WIDTH = 800;
/** Don't upscale beyond this — extra pixels cost tokens and time for no gain. */
const MAX_CROP_WIDTH = 2400;

export interface CroppedRegion {
  region: Region;
  pngBase64: string;
  /** Pixel size actually sent to Gemini. */
  width: number;
  height: number;
}

/**
 * Crop `region` from `pngBuffer` and upscale to at least MIN_CROP_WIDTH.
 *
 * Uses lanczos3 + a light sharpen: P&ID line art is thin and high-contrast, and
 * a plain bilinear upscale blurs exactly the strokes that carry the symbol.
 */
export async function cropRegion(
  pngBuffer: Buffer,
  region: Region,
  opts: { minWidth?: number; maxWidth?: number } = {},
): Promise<CroppedRegion | null> {
  const minWidth = opts.minWidth ?? MIN_CROP_WIDTH;
  const maxWidth = opts.maxWidth ?? MAX_CROP_WIDTH;

  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(pngBuffer).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;
    if (imgW === 0 || imgH === 0) return null;

    const rect = regionPixelRect(region, imgW, imgH);
    if (rect.width < 8 || rect.height < 8) return null;

    // Scale up when the crop is narrow, cap so huge pages stay affordable.
    const targetW = Math.min(maxWidth, Math.max(minWidth, rect.width));
    const resized = await sharp(pngBuffer)
      .extract(rect)
      .resize(targetW, null, { kernel: 'lanczos3' })
      .sharpen({ sigma: 0.5 })
      .png()
      .toBuffer();

    return {
      region,
      pngBase64: resized.toString('base64'),
      width: targetW,
      height: Math.round((rect.height / rect.width) * targetW),
    };
  } catch {
    return null;
  }
}

/**
 * Crop every region, sequentially.
 *
 * Sequential on purpose: cropping a large page in parallel multiplies peak
 * memory, and the PNGs are all held at once for the Gemini calls that follow.
 */
export async function cropAllRegions(
  pngBuffer: Buffer,
  regions: Region[],
  opts: { minWidth?: number; maxWidth?: number } = {},
): Promise<CroppedRegion[]> {
  const out: CroppedRegion[] = [];
  for (const region of regions) {
    const cropped = await cropRegion(pngBuffer, region, opts);
    if (cropped) out.push(cropped);
  }
  return out;
}
