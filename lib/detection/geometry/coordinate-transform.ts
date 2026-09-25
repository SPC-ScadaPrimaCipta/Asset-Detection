/**
 * Detection V2 — canonical coordinate transforms.
 *
 * Canonical internal representation: NATURAL PAGE PIXEL COORDINATES
 * plus the page dimensions they were measured in:
 *
 *   { pageWidth: 5100, pageHeight: 3600, x: 1840, y: 1220, width: 96, height: 88 }
 *
 * The legacy 0–1000 normalized space is kept ONLY at the UI boundary
 * (AI contract + viewer). Conversion is explicit via the functions below.
 *
 *   tile pixels --tileToPage--> page pixels --pageToNormalized--> 0–1000
 *       --normalizedToPage--> page pixels --pageToSvg--> SVG/DOM coords
 *
 * All functions are pure (no I/O) and fail-closed: invalid geometry is
 * clamped or rejected, never silently wrapped. Never compensate for a wrong
 * transform with AI prompt instructions (§45).
 */

export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
}

export const NORMALIZED_RANGE = 1000;

/** Clamp a box so it fits inside [0, pageWidth] x [0, pageHeight]. */
export function clipToPage(box: PageBox, geo: PageGeometry): PageBox {
  const x = Math.min(Math.max(0, box.x), geo.pageWidth);
  const y = Math.min(Math.max(0, box.y), geo.pageHeight);
  const width = Math.min(Math.max(0, box.width), geo.pageWidth - x);
  const height = Math.min(Math.max(0, box.height), geo.pageHeight - y);
  return { x, y, width, height };
}

/** True when the box is geometrically usable. */
export function isValidBox(box: PageBox, geo: PageGeometry): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0 &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= geo.pageWidth &&
    box.y + box.height <= geo.pageHeight
  );
}

/**
 * Canonical page pixels → legacy 0–1000 normalized (UI/AI boundary only).
 * Requires the true page dimensions — never guesses from max extent.
 */
export function pageToNormalized(box: PageBox, geo: PageGeometry): PageBox {
  const sx = NORMALIZED_RANGE / geo.pageWidth;
  const sy = NORMALIZED_RANGE / geo.pageHeight;
  const n = {
    x: Math.round(box.x * sx),
    y: Math.round(box.y * sy),
    width: Math.max(1, Math.round(box.width * sx)),
    height: Math.max(1, Math.round(box.height * sy)),
  };
  return {
    x: Math.min(999, Math.max(0, n.x)),
    y: Math.min(999, Math.max(0, n.y)),
    width: Math.min(NORMALIZED_RANGE - Math.min(999, Math.max(0, n.x)), n.width),
    height: Math.min(NORMALIZED_RANGE - Math.min(999, Math.max(0, n.y)), n.height),
  };
}

/** Legacy 0–1000 normalized → canonical page pixels. */
export function normalizedToPage(box: PageBox, geo: PageGeometry): PageBox {
  const sx = geo.pageWidth / NORMALIZED_RANGE;
  const sy = geo.pageHeight / NORMALIZED_RANGE;
  return clipToPage(
    {
      x: box.x * sx,
      y: box.y * sy,
      width: box.width * sx,
      height: box.height * sy,
    },
    geo
  );
}

/** Tile-local pixels → canonical page pixels. */
export function tileToPage(
  box: PageBox,
  tileOrigin: { x: number; y: number }
): PageBox {
  return {
    x: box.x + tileOrigin.x,
    y: box.y + tileOrigin.y,
    width: box.width,
    height: box.height,
  };
}

/**
 * Canonical page pixels → SVG/DOM display coordinates for a viewport
 * of (viewWidth x viewHeight). Aspect-preserving fit (letterboxed).
 */
export function pageToSvg(
  box: PageBox,
  geo: PageGeometry,
  view: { width: number; height: number }
): PageBox {
  const scale = Math.min(view.width / geo.pageWidth, view.height / geo.pageHeight);
  const offsetX = (view.width - geo.pageWidth * scale) / 2;
  const offsetY = (view.height - geo.pageHeight * scale) / 2;
  return {
    x: offsetX + box.x * scale,
    y: offsetY + box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

/** Intersection-over-Union of two page-pixel boxes. */
export function boxIoU(a: PageBox, b: PageBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Center distance in page pixels. */
export function centerDistance(a: PageBox, b: PageBox): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}
