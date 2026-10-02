import {
  clipToPage,
  isValidBox,
  pageToNormalized,
  normalizedToPage,
  tileToPage,
  pageToSvg,
  boxIoU,
  centerDistance,
} from '@/lib/detection/geometry/coordinate-transform';

const GEO = { pageWidth: 5100, pageHeight: 3600 };

describe('clipToPage', () => {
  it('keeps a valid box unchanged', () => {
    expect(clipToPage({ x: 1840, y: 1220, width: 96, height: 88 }, GEO))
      .toEqual({ x: 1840, y: 1220, width: 96, height: 88 });
  });

  it('clips negative origin and overflow', () => {
    expect(clipToPage({ x: -10, y: -5, width: 100, height: 100 }, GEO))
      .toEqual({ x: 0, y: 0, width: 100, height: 100 });
    const clipped = clipToPage({ x: 5050, y: 3550, width: 200, height: 200 }, GEO);
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(5100);
    expect(clipped.y + clipped.height).toBeLessThanOrEqual(3600);
  });
});

describe('isValidBox', () => {
  it('accepts a valid box', () => {
    expect(isValidBox({ x: 1840, y: 1220, width: 96, height: 88 }, GEO)).toBe(true);
  });

  it('rejects zero/negative size, NaN, and out-of-page boxes', () => {
    expect(isValidBox({ x: 10, y: 10, width: 0, height: 5 }, GEO)).toBe(false);
    expect(isValidBox({ x: 10, y: 10, width: -3, height: 5 }, GEO)).toBe(false);
    expect(isValidBox({ x: NaN, y: 10, width: 5, height: 5 }, GEO)).toBe(false);
    expect(isValidBox({ x: 5050, y: 10, width: 200, height: 5 }, GEO)).toBe(false);
    expect(isValidBox({ x: -1, y: 10, width: 5, height: 5 }, GEO)).toBe(false);
  });
});

describe('pageToNormalized / normalizedToPage', () => {
  it('round-trips within 1px tolerance', () => {
    const box = { x: 1840, y: 1220, width: 96, height: 88 };
    const back = normalizedToPage(pageToNormalized(box, GEO), GEO);
    expect(Math.abs(back.x - box.x)).toBeLessThanOrEqual(6);
    expect(Math.abs(back.y - box.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(back.width - box.width)).toBeLessThanOrEqual(6);
  });

  it('maps full page to 0–1000 range', () => {
    const n = pageToNormalized({ x: 0, y: 0, width: 5100, height: 3600 }, GEO);
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(n.width).toBeLessThanOrEqual(1000);
    expect(n.height).toBeLessThanOrEqual(1000);
  });
});

describe('tileToPage', () => {
  it('adds tile origin to tile-local coords', () => {
    expect(tileToPage({ x: 50, y: 60, width: 96, height: 88 }, { x: 1024, y: 768 }))
      .toEqual({ x: 1074, y: 828, width: 96, height: 88 });
  });
});

describe('pageToSvg', () => {
  it('fits aspect-preserving into viewport', () => {
    const svg = pageToSvg({ x: 0, y: 0, width: 5100, height: 3600 }, GEO, { width: 1020, height: 720 });
    expect(svg.width).toBeCloseTo(1020, 0);
    expect(svg.height).toBeCloseTo(720, 0);
  });
});

describe('boxIoU', () => {
  it('returns 1 for identical boxes', () => {
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(boxIoU(b, b)).toBeCloseTo(1);
  });

  it('returns 0 for non-overlapping boxes', () => {
    expect(boxIoU(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: 100, width: 10, height: 10 }
    )).toBe(0);
  });

  it('returns partial overlap between 0 and 1', () => {
    const iou = boxIoU(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 }
    );
    expect(iou).toBeGreaterThan(0);
    expect(iou).toBeLessThan(1);
  });
});

describe('centerDistance', () => {
  it('returns 0 for same center', () => {
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(centerDistance(b, b)).toBe(0);
  });
});
