import {
  boxesOverlap,
  containmentRatio,
  isContained,
  normalizeOrdering,
  validateBox,
  boxIoU,
} from '@/lib/detection/geometry/bbox-validator';

const GEO = { pageWidth: 5100, pageHeight: 3600 };

describe('validateBox — valid bbox', () => {
  it('accepts a well-formed page-pixel box', () => {
    const r = validateBox({ x: 1840, y: 1220, width: 96, height: 88 }, GEO);
    expect(r.valid).toBe(true);
    expect(r.box).toEqual({ x: 1840, y: 1220, width: 96, height: 88 });
    expect(r.clipped).toBe(false);
    expect(r.original).toEqual({ x: 1840, y: 1220, width: 96, height: 88 });
  });
});

describe('validateBox — negative coordinates', () => {
  it('clamps negative origin but stays valid', () => {
    const r = validateBox({ x: -20, y: -10, width: 100, height: 80 }, GEO);
    expect(r.valid).toBe(true);
    expect(r.box?.x).toBe(0);
    expect(r.box?.y).toBe(0);
    expect(r.clipped).toBe(true);
    expect(r.original).toEqual({ x: -20, y: -10, width: 100, height: 80 });
  });
});

describe('validateBox — outside page', () => {
  it('clamps partial overflow', () => {
    const r = validateBox({ x: 5050, y: 3550, width: 200, height: 200 }, GEO);
    expect(r.valid).toBe(true);
    expect(r.box!.x + r.box!.width).toBeLessThanOrEqual(5100);
    expect(r.box!.y + r.box!.height).toBeLessThanOrEqual(3600);
    expect(r.clipped).toBe(true);
  });

  it('rejects a box fully outside the page', () => {
    const r = validateBox({ x: 6000, y: 4000, width: 100, height: 100 }, GEO);
    expect(r.valid).toBe(false);
    expect(r.box).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/outside/);
  });
});

describe('validateBox — zero area', () => {
  it.each([
    { x: 10, y: 10, width: 0, height: 50 },
    { x: 10, y: 10, width: 50, height: 0 },
  ])('rejects zero-area box %p', (box) => {
    const r = validateBox(box, GEO);
    expect(r.valid).toBe(false);
    expect(r.box).toBeNull();
  });
});

describe('validateBox — inverted coordinates', () => {
  it('normalizes negative width/height ordering', () => {
    expect(normalizeOrdering({ x: 100, y: 100, width: -40, height: -30 }))
      .toEqual({ x: 60, y: 70, width: 40, height: 30 });
    const r = validateBox({ x: 100, y: 100, width: -40, height: -30 }, GEO);
    expect(r.valid).toBe(true);
    expect(r.box).toEqual({ x: 60, y: 70, width: 40, height: 30 });
    expect(r.reasons.join(' ')).toMatch(/ordering/);
  });
});

describe('validateBox — NaN/Infinity', () => {
  it.each([
    { x: NaN, y: 10, width: 50, height: 50 },
    { x: 10, y: Infinity, width: 50, height: 50 },
    { x: 10, y: 10, width: NaN, height: 50 },
  ])('rejects non-finite box %p', (box) => {
    const r = validateBox(box, GEO);
    expect(r.valid).toBe(false);
    expect(r.box).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/non-finite/);
  });
});

describe('validateBox — minimum area', () => {
  it('rejects below minArea, accepts above', () => {
    expect(validateBox({ x: 10, y: 10, width: 2, height: 2 }, GEO, { minArea: 25 }).valid).toBe(false);
    expect(validateBox({ x: 10, y: 10, width: 5, height: 5 }, GEO, { minArea: 25 }).valid).toBe(true);
  });
});

describe('IoU edge cases', () => {
  it('identical boxes → 1', () => {
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(boxIoU(b, b)).toBeCloseTo(1);
  });

  it('non-overlapping boxes → 0', () => {
    expect(boxIoU({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 50, width: 10, height: 10 })).toBe(0);
  });

  it('touching edges (no shared area) → 0', () => {
    expect(boxIoU({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(0);
  });

  it('containment → inner/union ratio', () => {
    // inner 50x50=2500, outer 100x100=10000 → 2500/10000 = 0.25
    expect(boxIoU(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 25, y: 25, width: 50, height: 50 }
    )).toBeCloseTo(0.25);
  });
});

describe('containment / overlap helpers', () => {
  const outer = { x: 0, y: 0, width: 100, height: 100 };
  const inner = { x: 25, y: 25, width: 50, height: 50 };
  const partial = { x: 50, y: 50, width: 100, height: 100 };
  const far = { x: 500, y: 500, width: 10, height: 10 };

  it('isContained detects full containment only', () => {
    expect(isContained(inner, outer)).toBe(true);
    expect(isContained(outer, inner)).toBe(false);
    expect(isContained(partial, outer)).toBe(false);
  });

  it('containmentRatio measures covered fraction', () => {
    expect(containmentRatio(inner, outer)).toBeCloseTo(1);
    expect(containmentRatio(outer, inner)).toBeCloseTo(0.25);
    expect(containmentRatio(far, outer)).toBe(0);
  });

  it('boxesOverlap is true on any shared area', () => {
    expect(boxesOverlap(inner, outer)).toBe(true);
    expect(boxesOverlap(partial, outer)).toBe(true);
    expect(boxesOverlap(far, outer)).toBe(false);
  });
});
