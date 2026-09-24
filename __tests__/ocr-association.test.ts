import {
  associateOneText,
  rankAssociationsForText,
  type RankedSymbolCandidate,
  type RankedTextCandidate,
} from '@/lib/detection/geometry/spatial-association';

const GEO = { pageWidth: 5100, pageHeight: 3600 };
const t = (over: Partial<RankedTextCandidate> = {}): RankedTextCandidate => ({
  id: 't1',
  text: 'P-101',
  bbox: { x: 1800, y: 1120, width: 60, height: 22 },
  pageNumber: 1,
  isTag: true,
  ...over,
});
const s = (over: Partial<RankedSymbolCandidate> = {}): RankedSymbolCandidate => ({
  id: 's1',
  bbox: { x: 1840, y: 1220, width: 96, height: 88 },
  pageNumber: 1,
  ...over,
});

describe('ranked association wiring', () => {
  it('returns ranked evidence with feature breakdown, not a bare score', () => {
    const ranked = rankAssociationsForText(t(), [s({ id: 'near' }), s({ id: 'mid', bbox: { x: 2100, y: 1220, width: 96, height: 88 } })], GEO);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].symbolId).toBe('near');
    expect(ranked[0].features.tagPatternScore).toBe(1);
    expect(ranked[0].features.distanceScore).toBeGreaterThan(ranked[1].features.distanceScore);
    expect(ranked[0].reasons.join(' ')).toMatch(/normalizedDistance|tagPattern|direction|sizeRatio/);
  });

  it('does not force a single winner — multiple in-gate symbols all returned', () => {
    const ranked = rankAssociationsForText(
      t(),
      [s({ id: 'a' }), s({ id: 'b', bbox: { x: 1900, y: 1230, width: 96, height: 88 } })],
      GEO
    );
    expect(ranked.length).toBe(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it('rejects cross-page candidates', () => {
    expect(rankAssociationsForText(t({ pageNumber: 1 }), [s({ pageNumber: 2 })], GEO)).toEqual([]);
  });

  it('rejects invalid bbox geometry', () => {
    expect(rankAssociationsForText(
      t({ bbox: { x: 1, y: 1, width: 0, height: 5 } }), [s()], GEO
    )).toEqual([]);
    expect(rankAssociationsForText(
      t(), [s({ bbox: { x: NaN, y: 1, width: 5, height: 5 } })], GEO
    )).toEqual([]);
  });

  it('penalizes (not rejects) implausible size ratios', () => {
    const tiny = rankAssociationsForText(t(), [s({ bbox: { x: 1840, y: 1220, width: 4, height: 4 } })], GEO);
    expect(tiny).toHaveLength(1);
    expect(tiny[0].features.sizeScore).toBeLessThan(1);
  });
});

describe('multi-scale regression (150/300/360/600 DPI equivalents)', () => {
  // Same drawing at 4 render scales — normalized evidence must be invariant.
  const scales = [150 / 360, 300 / 360, 1, 600 / 360];
  it('normalizedDistance and score are scale-invariant', () => {
    const base = {
      tag: { x: 1800, y: 1120, width: 60, height: 22 },
      sym: { x: 1840, y: 1220, width: 96, height: 88 },
    };
    const results = scales.map((k) => {
      const sc = (v: number) => v * k;
      const geo = { pageWidth: 5100 * k, pageHeight: 3600 * k };
      const [r] = rankAssociationsForText(
        { ...t(), bbox: { x: sc(base.tag.x), y: sc(base.tag.y), width: sc(base.tag.width), height: sc(base.tag.height) } },
        [{ ...s(), bbox: { x: sc(base.sym.x), y: sc(base.sym.y), width: sc(base.sym.width), height: sc(base.sym.height) } }],
        geo
      );
      return r;
    });
    for (const r of results) expect(r).toBeDefined();
    const norms = results.map((r) => r.normalizedDistance);
    const scores = results.map((r) => r.score);
    for (let i = 1; i < results.length; i++) {
      expect(Math.abs(norms[i] - norms[0])).toBeLessThan(1e-9);
      expect(Math.abs(scores[i] - scores[0])).toBeLessThan(1e-9);
    }
  });
});

describe('legacy single-best API preserved', () => {
  it('associateOneText still works (Phase 2 compat)', () => {
    const a = associateOneText(
      { id: 't1', text: 'P-101', bbox: { x: 1800, y: 1120, width: 60, height: 22 } },
      [{ id: 's1', bbox: { x: 1840, y: 1220, width: 96, height: 88 } }],
      GEO
    );
    expect(a?.symbolId).toBe('s1');
  });
});
