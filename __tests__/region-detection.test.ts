/**
 * Region (tiled) detection — coordinate mapping and duplicate merging.
 *
 * These are the two places a region sweep can silently corrupt data:
 *   - a wrong bbox mapping puts every detection in the page's top-left corner
 *   - a wrong dedupe rule either keeps duplicates or drops real distinct symbols
 *
 * Pure functions, no DB and no API calls.
 */
import {
  buildRegions,
  clampBBox1000,
  gridForAspect,
  mapRegionBboxToPage,
  regionPixelRect,
  bboxIou1000,
} from '@/lib/detection/region/region-plan';
import { dedupeRegionDetections } from '@/lib/ai-agent';
import type { Detection } from '@/lib/ai-schemas';

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    assetType: 'Valve',
    assetTag: 'BV-1001',
    confidence: 0.9,
    bbox: { x: 100, y: 100, width: 40, height: 40 },
    evidence: ['seen'],
    ...overrides,
  } as Detection;
}

describe('buildRegions', () => {
  it('produces cols × rows regions in row-major order', () => {
    const regions = buildRegions(2, 2, 0);
    expect(regions).toHaveLength(4);
    expect(regions.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(regions[0].label).toBe('column 1/2, row 1/2');
    expect(regions[3].label).toBe('column 2/2, row 2/2');
  });

  it('with zero overlap the regions tile the page exactly', () => {
    const regions = buildRegions(2, 2, 0);
    expect(regions[0]).toMatchObject({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(regions[1]).toMatchObject({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(regions[2]).toMatchObject({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(regions[3]).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('overlap grows every interior region and never leaves the page', () => {
    const regions = buildRegions(2, 2, 0.15);
    // The top-left corner cannot grow (already at 0,0).
    expect(regions[0].x).toBe(0);
    expect(regions[0].y).toBe(0);
    // The bottom-right region grows back toward the middle but stays clamped at 1.
    const last = regions[3];
    expect(last.x + last.w).toBeCloseTo(1);
    expect(last.y + last.h).toBeCloseTo(1);
    // Every region is strictly larger than its no-overlap size.
    const plain = buildRegions(2, 2, 0);
    regions.forEach((r, i) => {
      expect(r.w).toBeGreaterThan(plain[i].w);
      expect(r.h).toBeGreaterThan(plain[i].h);
    });
  });

  it('overlapping regions actually cover the shared border (no symbol gap)', () => {
    const regions = buildRegions(2, 2, 0.15);
    // Region 0's right edge must reach past region 1's left edge.
    expect(regions[0].x + regions[0].w).toBeGreaterThan(regions[1].x);
  });

  it('clamps degenerate grids to at least 1×1', () => {
    expect(buildRegions(0, 0)).toHaveLength(1);
    expect(buildRegions(-3, -3)).toHaveLength(1);
  });
});

describe('gridForAspect', () => {
  it('gives genuinely wide sheets more columns than rows', () => {
    // 3508×2000 = 1.75 aspect → above the 1.5 threshold.
    expect(gridForAspect(3508, 2000)).toEqual({ cols: 3, rows: 2 });
  });

  it('treats A3 landscape (1.41 aspect) as a balanced 2×2 sheet', () => {
    // A3 is 420×297mm = 1.414, which is below the 1.5 cut-off. Four regions
    // keeps a dense P&ID readable without inflating the call count.
    expect(gridForAspect(3508, 2480)).toEqual({ cols: 2, rows: 2 });
  });

  it('gives near-square sheets a balanced grid', () => {
    expect(gridForAspect(2000, 1800)).toEqual({ cols: 2, rows: 2 });
  });

  it('gives portrait sheets more rows than columns', () => {
    expect(gridForAspect(1200, 2400)).toEqual({ cols: 2, rows: 3 });
  });

  it('never divides by zero on a degenerate size', () => {
    expect(() => gridForAspect(0, 0)).not.toThrow();
  });
});

describe('mapRegionBboxToPage', () => {
  const topLeft = { x: 0, y: 0, w: 0.5, h: 0.5 };

  it('leaves a full-crop box at the region origin', () => {
    const r = mapRegionBboxToPage({ x: 0, y: 0, width: 1000, height: 1000 }, topLeft);
    expect(r).toMatchObject({ x: 0, y: 0, width: 500, height: 500 });
  });

  it('maps a region-local box onto the correct page quadrant', () => {
    // A box at the very centre of the top-left region sits at ~(250,250) on the page.
    const r = mapRegionBboxToPage({ x: 500, y: 500, width: 100, height: 100 }, topLeft);
    expect(r.x).toBeCloseTo(250, 0);
    expect(r.y).toBeCloseTo(250, 0);
    expect(r.width).toBeCloseTo(50, 0);
    expect(r.height).toBeCloseTo(50, 0);
  });

  it('offsets a bottom-right region into the bottom-right of the page', () => {
    const bottomRight = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    const r = mapRegionBboxToPage({ x: 0, y: 0, width: 1000, height: 1000 }, bottomRight);
    expect(r.x).toBeCloseTo(500, 0);
    expect(r.y).toBeCloseTo(500, 0);
  });

  it('never produces a box outside 0-1000', () => {
    for (const region of buildRegions(3, 2, 0.15)) {
      for (const bbox of [
        { x: 0, y: 0, width: 1000, height: 1000 },
        { x: 990, y: 990, width: 100, height: 100 },
        { x: 500, y: 500, width: 10, height: 10 },
      ]) {
        const r = mapRegionBboxToPage(bbox, region);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1000);
        expect(r.y + r.height).toBeLessThanOrEqual(1000);
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
      }
    }
  });

  it('is the inverse of regionPixelRect at region scale', () => {
    // A point at 50% across the region must land at 50% across the region on the page.
    const region = buildRegions(2, 2, 0.15)[1]; // top-right
    const r = mapRegionBboxToPage({ x: 500, y: 500, width: 0, height: 0 }, region);
    const expected = (region.x + region.w * 0.5) * 1000;
    expect(r.x).toBeCloseTo(expected, 0);
  });
});

describe('clampBBox1000', () => {
  it('keeps a positive area even for a zero-size box', () => {
    expect(clampBBox1000({ x: 10, y: 10, width: 0, height: 0 })).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it('clamps a box that runs past the page edge', () => {
    const r = clampBBox1000({ x: 990, y: 990, width: 500, height: 500 });
    expect(r.x + r.width).toBeLessThanOrEqual(1000);
    expect(r.y + r.height).toBeLessThanOrEqual(1000);
  });

  it('clamps a negative origin to zero', () => {
    expect(clampBBox1000({ x: -50, y: -20, width: 100, height: 100 }).x).toBe(0);
  });
});

describe('regionPixelRect', () => {
  it('converts fractions to integer pixels', () => {
    expect(regionPixelRect({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 1000, 800)).toEqual({
      left: 500,
      top: 400,
      width: 500,
      height: 400,
    });
  });

  it('clamps a region that would run past the image edge', () => {
    const r = regionPixelRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100);
    expect(r.left + r.width).toBeLessThanOrEqual(100);
    expect(r.top + r.height).toBeLessThanOrEqual(100);
    expect(r.width).toBeGreaterThan(0);
  });
});

describe('bboxIou1000', () => {
  it('is 1 for identical boxes', () => {
    const b = { x: 10, y: 10, width: 50, height: 50 };
    expect(bboxIou1000(b, b)).toBeCloseTo(1);
  });

  it('is 0 for disjoint boxes', () => {
    expect(
      bboxIou1000(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 500, y: 500, width: 10, height: 10 },
      ),
    ).toBe(0);
  });
});

describe('dedupeRegionDetections', () => {
  it('merges the same tag reported by two overlapping regions', () => {
    const a = makeDetection({ bbox: { x: 100, y: 100, width: 40, height: 40 }, evidence: ['r1'] });
    const b = makeDetection({ bbox: { x: 104, y: 102, width: 40, height: 40 }, evidence: ['r2'] });
    const out = dedupeRegionDetections([a, b]);
    expect(out).toHaveLength(1);
  });

  it('keeps both regions’ evidence so agreement is auditable', () => {
    const a = makeDetection({ bbox: { x: 100, y: 100, width: 40, height: 40 }, evidence: ['r1'] });
    const b = makeDetection({ bbox: { x: 104, y: 102, width: 40, height: 40 }, evidence: ['r2'] });
    expect(dedupeRegionDetections([a, b])[0].evidence).toEqual(['r1', 'r2']);
  });

  it('keeps the higher-confidence detection when merging', () => {
    const a = makeDetection({ confidence: 0.6, evidence: ['r1'] });
    const b = makeDetection({ confidence: 0.95, evidence: ['r2'] });
    expect(dedupeRegionDetections([a, b])[0].confidence).toBe(0.95);
  });

  it('does NOT merge two different tags, even when boxes overlap', () => {
    const a = makeDetection({ assetTag: 'BV-1001' });
    const b = makeDetection({ assetTag: 'BV-1002' });
    expect(dedupeRegionDetections([a, b])).toHaveLength(2);
  });

  it('does NOT merge the same tag in two genuinely different locations', () => {
    const a = makeDetection({ assetTag: 'P-101', bbox: { x: 0, y: 0, width: 40, height: 40 } });
    const b = makeDetection({ assetTag: 'P-101', bbox: { x: 800, y: 800, width: 40, height: 40 } });
    expect(dedupeRegionDetections([a, b])).toHaveLength(2);
  });

  it('merges untagged duplicates only when the type also matches', () => {
    const a = makeDetection({ assetTag: null, assetType: 'Valve', bbox: { x: 10, y: 10, width: 40, height: 40 } });
    const b = makeDetection({ assetTag: null, assetType: 'Valve', bbox: { x: 12, y: 11, width: 40, height: 40 } });
    expect(dedupeRegionDetections([a, b])).toHaveLength(1);
  });

  it('keeps untagged detections of different types apart', () => {
    const a = makeDetection({ assetTag: null, assetType: 'Valve', bbox: { x: 10, y: 10, width: 40, height: 40 } });
    const b = makeDetection({ assetTag: null, assetType: 'Pump', bbox: { x: 12, y: 11, width: 40, height: 40 } });
    expect(dedupeRegionDetections([a, b])).toHaveLength(2);
  });

  it('never merges untagged against tagged', () => {
    const a = makeDetection({ assetTag: null, assetType: 'Valve' });
    const b = makeDetection({ assetTag: 'BV-1001', assetType: 'Valve' });
    expect(dedupeRegionDetections([a, b])).toHaveLength(2);
  });

  it('passes an empty list through', () => {
    expect(dedupeRegionDetections([])).toEqual([]);
  });
});
