import {
  deduplicatePageCandidates,
  mapTileCandidatesToPage,
} from '@/lib/detection/pipeline/tile-candidate-pipeline';
import type {
  CvCandidate,
  CvTileMeta,
  PageCandidate,
} from '@/lib/detection/candidates/schema';

const tile = (over: Partial<CvTileMeta> = {}): CvTileMeta => ({
  pageNumber: 1,
  tileX: 1024,
  tileY: 0,
  tileWidth: 1280,
  tileHeight: 600,
  pageWidth: 3000,
  pageHeight: 600,
  sourceDpi: 288,
  overlap: 0.2,
  tileIndex: 1,
  ...over,
});

const vc = (over: Partial<CvCandidate> = {}): CvCandidate => ({
  candidateId: 'c1',
  pageNumber: 1,
  tileId: 1,
  bbox: { x: 50, y: 60, width: 96, height: 88 },
  candidateType: 'visual',
  source: 'cv',
  provenance: [],
  pipelineVersion: 'v2.0.0',
  ...over,
});

const pc = (over: Partial<PageCandidate> = {}): PageCandidate => ({
  ...vc(),
  bbox: { x: 1074, y: 60, width: 96, height: 88 },
  pageWidth: 3000,
  pageHeight: 600,
  ...over,
});

describe('mapTileCandidatesToPage', () => {
  it('maps tile-local bbox to exact page coordinates', () => {
    const { kept, dropped } = mapTileCandidatesToPage([vc()], tile());
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0].bbox).toEqual({ x: 1074, y: 60, width: 96, height: 88 });
    expect(kept[0].pageWidth).toBe(3000);
    expect(kept[0].provenance).toContain('tile:1');
  });

  it('drops invalid boxes with reasons, never persists tile-local coords', () => {
    const bad = vc({ candidateId: 'bad', bbox: { x: 10, y: 10, width: 0, height: 50 } });
    const { kept, dropped } = mapTileCandidatesToPage([bad], tile());
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toMatch(/zero|area/i);
  });

  it('clips candidates crossing the page edge', () => {
    // tile-local box that lands past the page edge after offset
    const edge = vc({ candidateId: 'e', bbox: { x: 1200, y: 10, width: 200, height: 50 } });
    const { kept } = mapTileCandidatesToPage([edge], tile());
    expect(kept).toHaveLength(1);
    expect(kept[0].bbox.x + kept[0].bbox.width).toBeLessThanOrEqual(3000);
  });
});

describe('deduplicatePageCandidates', () => {
  it('merges identical candidates with provenance', () => {
    const out = deduplicatePageCandidates([
      pc({ candidateId: 'a', provenance: ['tile:0'] }),
      pc({ candidateId: 'b', provenance: ['tile:1'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].provenance).toContain('tile:0');
    expect(out[0].provenance).toContain('tile:1');
    expect(out[0].provenance).toContain('merged:b');
  });

  it('keeps low-IoU neighbors separate', () => {
    const out = deduplicatePageCandidates([
      pc({ candidateId: 'a' }),
      pc({ candidateId: 'b', bbox: { x: 2000, y: 400, width: 96, height: 88 } }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('never merges across pages or types', () => {
    const out = deduplicatePageCandidates([
      pc({ candidateId: 'a' }),
      pc({ candidateId: 'b', pageNumber: 2 }),
      pc({ candidateId: 'c', candidateType: 'text' }),
    ]);
    expect(out).toHaveLength(3);
  });

  it('keeps richer OCR payload on merge', () => {
    const out = deduplicatePageCandidates([
      pc({ candidateId: 'a', ocr: null }),
      pc({
        candidateId: 'b',
        ocr: { text: 'P-101', bbox: { x: 1, y: 1, width: 2, height: 2 }, confidence: 0.9, rotation: 0, provider: 'mock' },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].ocr?.text).toBe('P-101');
  });
});

describe('tile → page → association handoff', () => {
  it('page candidates expose geometry consumable by spatial association', async () => {
    const { associateOneText } = await import('@/lib/detection/geometry/spatial-association');
    const { kept } = mapTileCandidatesToPage(
      [vc({ candidateId: 'sym', bbox: { x: 816, y: 220, width: 96, height: 88 } })],
      tile({ tileX: 1024, tileY: 1000, tileHeight: 1280, pageHeight: 3600, pageWidth: 5100 })
    );
    expect(kept).toHaveLength(1);
    const assoc = associateOneText(
      { id: 't1', text: 'P-101', bbox: { x: 1800, y: 1120, width: 60, height: 22 } },
      [{ id: 's1', bbox: kept[0].bbox }],
      { pageWidth: 5100, pageHeight: 3600 }
    );
    // symbol at page (1840,1220) vs tag at (1800,1120) → in gate, linked
    expect(assoc).not.toBeNull();
    expect(assoc!.symbolId).toBe('s1');
  });
});
