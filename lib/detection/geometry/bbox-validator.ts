/**
 * Detection V2 — deterministic bbox validation / normalization.
 *
 * All boxes are CANONICAL PAGE PIXELS (see coordinate-transform.ts).
 * No AI-dependent logic. Pure functions, fail-closed.
 */
import {
  boxIoU,
  clipToPage,
  type PageBox,
  type PageGeometry,
} from './coordinate-transform';

export interface ValidatorOptions {
  /** Minimum symbol area in px². Default 1 (rejects zero-area only). */
  minArea?: number;
}

export interface ValidationResult {
  valid: boolean;
  /** Normalized, clamped box when valid; null when invalid. */
  box: PageBox | null;
  /** Untouched input, kept for debugging. */
  original: PageBox;
  /** True when clamping changed the geometry. */
  clipped: boolean;
  reasons: string[];
}

/**
 * Fix inverted coordinate ordering (negative width/height from e.g.
 * drag-from-bottom-right). Returns a re-ordered copy; does NOT clamp.
 */
export function normalizeOrdering(box: PageBox): PageBox {
  let { x, y, width, height } = box;
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  return { x, y, width, height };
}

function isFiniteBox(box: PageBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height)
  );
}

export function validateBox(
  raw: PageBox,
  geo: PageGeometry,
  opts: ValidatorOptions = {}
): ValidationResult {
  const minArea = opts.minArea ?? 1;
  const reasons: string[] = [];

  if (!isFiniteBox(raw)) {
    return {
      valid: false,
      box: null,
      original: { ...raw },
      clipped: false,
      reasons: ['non-finite coordinates (NaN or Infinity)'],
    };
  }

  const ordered = normalizeOrdering(raw);
  if (ordered.width !== raw.width || ordered.height !== raw.height) {
    reasons.push('inverted coordinate ordering normalized');
  }

  if (ordered.width <= 0 || ordered.height <= 0) {
    return {
      valid: false,
      box: null,
      original: { ...raw },
      clipped: false,
      reasons: [...reasons, 'zero or negative area'],
    };
  }

  if (ordered.width * ordered.height < minArea) {
    return {
      valid: false,
      box: null,
      original: { ...raw },
      clipped: false,
      reasons: [...reasons, `area below minimum (${minArea}px²)`],
    };
  }

  const clipped = clipToPage(ordered, geo);
  const wasClipped =
    clipped.x !== ordered.x ||
    clipped.y !== ordered.y ||
    clipped.width !== ordered.width ||
    clipped.height !== ordered.height;

  if (clipped.width <= 0 || clipped.height <= 0) {
    return {
      valid: false,
      box: null,
      original: { ...raw },
      clipped: true,
      reasons: [...reasons, 'box lies fully outside page boundaries'],
    };
  }

  if (wasClipped) reasons.push('clamped to page boundaries');
  return { valid: true, box: clipped, original: { ...raw }, clipped: wasClipped, reasons };
}

/** Fraction of `inner`'s area covered by `outer` (0..1). */
export function containmentRatio(inner: PageBox, outer: PageBox): number {
  const ix0 = Math.max(inner.x, outer.x);
  const iy0 = Math.max(inner.y, outer.y);
  const ix1 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const iy1 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const innerArea = inner.width * inner.height;
  if (innerArea <= 0) return 0;
  return (iw * ih) / innerArea;
}

/** True when `inner` is fully inside `outer`. */
export function isContained(inner: PageBox, outer: PageBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** True when boxes share any area. */
export function boxesOverlap(a: PageBox, b: PageBox): boolean {
  return boxIoU(a, b) > 0;
}

export { boxIoU };
