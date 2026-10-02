/**
 * Region plan — split a rendered P&ID page into overlapping crops.
 *
 * Mirrors the Scan Legend approach (lib/legend-extract.ts → buildRegions) so both
 * flows read a drawing the same way.
 *
 * WHY THIS EXISTS: Gemini internally downscales large images before the model
 * sees them. A full A3 P&ID page therefore arrives with 6pt tags compressed
 * into a few pixels. Sending a cropped region instead gives each symbol far more
 * effective resolution, which is what makes small tags and tight bounding boxes
 * readable.
 *
 * All coordinates here are 0–1 fractions of the full page image. Converting a
 * region box to pixels and back is the cropper's job; converting a region-local
 * 0–1000 bbox back to page space is `mapRegionBboxToPage`.
 */

export interface Region {
  /** Human-readable position, e.g. `column 2/3, row 1/2`. */
  label: string;
  /** 0–1 fractions of the full image. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0-based index in row-major order. */
  index: number;
}

export interface BBox1000 {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a 0–1000 bbox into the page, keeping a positive area. */
export function clampBBox1000(b: BBox1000): BBox1000 {
  const x = Math.max(0, Math.min(999, Math.round(b.x)));
  const y = Math.max(0, Math.min(999, Math.round(b.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(1000 - x, Math.round(b.width))),
    height: Math.max(1, Math.min(1000 - y, Math.round(b.height))),
  };
}

/**
 * Split a page into a cols × rows grid with fractional overlap.
 *
 * Overlap matters: a symbol sitting on a region border would otherwise be cut in
 * half and detected as a fragment, or missed entirely. 15% is the value Scan
 * Legend settled on.
 */
export function buildRegions(cols: number, rows: number, overlap = 0.15): Region[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const regions: Region[] = [];
  const colW = 1 / c;
  const rowH = 1 / r;

  for (let ri = 0; ri < r; ri++) {
    for (let ci = 0; ci < c; ci++) {
      const x = Math.max(0, ci * colW - overlap);
      const y = Math.max(0, ri * rowH - overlap);
      const x2 = Math.min(1, (ci + 1) * colW + overlap);
      const y2 = Math.min(1, (ri + 1) * rowH + overlap);
      regions.push({
        label: `column ${ci + 1}/${c}, row ${ri + 1}/${r}`,
        x,
        y,
        w: x2 - x,
        h: y2 - y,
        index: regions.length,
      });
    }
  }
  return regions;
}

/**
 * Choose a grid from the page aspect ratio.
 *
 * Landscape P&ID sheets carry more per row, so they get more columns — same rule
 * Scan Legend uses. Kept separate from `buildRegions` so it is testable without
 * touching config.
 */
export function gridForAspect(imgWidth: number, imgHeight: number): { cols: number; rows: number } {
  const aspect = imgWidth / Math.max(1, imgHeight);
  if (aspect > 1.5) return { cols: 3, rows: 2 };
  if (aspect > 1) return { cols: 2, rows: 2 };
  return { cols: 2, rows: 3 };
}

/**
 * Map a region-local 0–1000 bbox to full-page 0–1000 space.
 *
 * The model is told to answer in 0–1000 coordinates *relative to the crop it was
 * given*, so this is the inverse of that mapping. Without it every box would be
 * reported in the top-left corner of the page and the viewer overlay would be
 * useless.
 */
export function mapRegionBboxToPage(
  bbox: BBox1000,
  region: Pick<Region, 'x' | 'y' | 'w' | 'h'>,
): BBox1000 {
  const pageX = (bbox.x / 1000) * region.w + region.x;
  const pageY = (bbox.y / 1000) * region.h + region.y;
  const pageW = (bbox.width / 1000) * region.w;
  const pageH = (bbox.height / 1000) * region.h;
  return clampBBox1000({
    x: pageX * 1000,
    y: pageY * 1000,
    width: pageW * 1000,
    height: pageH * 1000,
  });
}

/** Pixel crop rect for a region, clamped to the image bounds. */
export function regionPixelRect(
  region: Pick<Region, 'x' | 'y' | 'w' | 'h'>,
  imgWidth: number,
  imgHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(imgWidth - 1, Math.round(region.x * imgWidth)));
  const top = Math.max(0, Math.min(imgHeight - 1, Math.round(region.y * imgHeight)));
  const width = Math.max(1, Math.min(imgWidth - left, Math.round(region.w * imgWidth)));
  const height = Math.max(1, Math.min(imgHeight - top, Math.round(region.h * imgHeight)));
  return { left, top, width, height };
}

/** Intersection-over-union of two 0–1000 boxes. */
export function bboxIou1000(a: BBox1000, b: BBox1000): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
