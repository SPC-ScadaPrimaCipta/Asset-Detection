import {
  associateOneText,
  associateTextsToSymbols,
  directionFromTo,
  edgeDistance,
  type SymbolCandidate,
  type TextCandidate,
} from '@/lib/detection/geometry/spatial-association';

const GEO = { pageWidth: 5100, pageHeight: 3600 }; // diagonal ≈ 6242
const sym = (id: string, x: number, y: number, w = 96, h = 88): SymbolCandidate => ({
  id,
  bbox: { x, y, width: w, height: h },
});
const txt = (id: string, x: number, y: number, w = 60, h = 22): TextCandidate => ({
  id,
  text: 'P-101',
  bbox: { x, y, width: w, height: h },
});

describe('associateOneText', () => {
  it('associates a nearby tag with explainable evidence', () => {
    const a = associateOneText(txt('t1', 1800, 1120), [sym('s1', 1840, 1220)], GEO);
    expect(a).not.toBeNull();
    expect(a!.textId).toBe('t1');
    expect(a!.symbolId).toBe('s1');
    expect(a!.normalizedDistance).toBeLessThan(0.15);
    expect(a!.score).toBeGreaterThan(0);
    expect(a!.score).toBeLessThanOrEqual(1);
    expect(a!.reasons.length).toBeGreaterThan(0);
    expect(a!.direction).toBe('NW'); // tag above-left of symbol
  });

  it('returns null when the tag is beyond the gate', () => {
    const a = associateOneText(txt('t1', 10, 10), [sym('s1', 4000, 3000)], GEO);
    expect(a).toBeNull();
  });

  it('picks the nearest of several symbols', () => {
    const a = associateOneText(txt('t1', 1800, 1120), [sym('far', 4000, 3000), sym('near', 1840, 1220)], GEO);
    expect(a!.symbolId).toBe('near');
  });

  it('scale invariance: same layout at half resolution scores equally', () => {
    const half = { pageWidth: 2550, pageHeight: 1800 };
    const a1 = associateOneText(txt('t1', 1800, 1120), [sym('s1', 1840, 1220)], GEO);
    const a2 = associateOneText(
      { id: 't1', text: 'P-101', bbox: { x: 900, y: 560, width: 30, height: 11 } },
      [{ id: 's1', bbox: { x: 920, y: 610, width: 48, height: 44 } }],
      half
    );
    expect(a1!.normalizedDistance).toBeCloseTo(a2!.normalizedDistance, 2);
  });
});

describe('associateTextsToSymbols', () => {
  it('maps each text to at most one symbol', () => {
    const out = associateTextsToSymbols(
      [txt('t1', 1800, 1120), txt('t2', 10, 10)],
      [sym('s1', 1840, 1220)],
      GEO
    );
    // t2 is far from s1 → gated out; t1 links to s1
    expect(out.map((a) => a.textId)).toEqual(['t1']);
  });

  it('returns empty array when nothing is in range', () => {
    expect(associateTextsToSymbols([txt('t1', 10, 10)], [sym('s1', 4000, 3000)], GEO)).toEqual([]);
  });
});

describe('directionFromTo', () => {
  const s = { x: 1000, y: 1000, width: 100, height: 100 };
  it.each([
    ['N', { x: 1000, y: 800, width: 60, height: 20 }],
    ['S', { x: 1000, y: 1200, width: 60, height: 20 }],
    ['E', { x: 1200, y: 1000, width: 60, height: 20 }],
    ['W', { x: 800, y: 1000, width: 60, height: 20 }],
  ])('resolves %s', (expected, box) => {
    expect(directionFromTo(s, box)).toBe(expected);
  });

  it('resolves OVERLAP and CONTAINED', () => {
    expect(directionFromTo(s, { x: 1020, y: 1020, width: 60, height: 20 })).toBe('OVERLAP');
    expect(directionFromTo(s, { x: 1010, y: 1010, width: 10, height: 10 })).toBe('OVERLAP');
  });
});

describe('edgeDistance', () => {
  it('is 0 for overlapping boxes', () => {
    expect(edgeDistance(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 }
    )).toBe(0);
  });

  it('measures gap between separated boxes', () => {
    expect(edgeDistance(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 150, y: 0, width: 100, height: 100 }
    )).toBe(50);
  });
});
