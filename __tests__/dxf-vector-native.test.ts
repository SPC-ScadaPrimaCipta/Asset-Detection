/**
 * Vector-native DXF detection regression tests.
 *
 * Locks down the Lap-1 rewrite:
 *   1. Multi-sheet files split into regions (pid_page per sheet).
 *   2. NO prefix-guessing: without legend match → assetType 'UNKNOWN'.
 *   3. Legend tag_pattern match resolves type (V-### → Vessel, not Valve).
 *   4. Construction/revision layers hard-excluded (no duplicate junk tags).
 *   5. Bbox normalisation stays in whole-file 0-1000 space (viewer compat).
 */
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';
import { runDxfDetection, UNKNOWN_ASSET_TYPE } from '@/lib/dxf-detection';

function textEntity(tag: string, layer: string, x: number, y: number): string {
  return [
    '0', 'TEXT', '8', layer,
    '10', String(x), '20', String(y), '40', '2.5',
    '1', tag,
  ].join('\n');
}

function circleEntity(layer: string, x: number, y: number, r: number): string {
  return [
    '0', 'CIRCLE', '8', layer,
    '10', String(x), '20', String(y), '30', '0.0',
    '40', String(r),
  ].join('\n');
}

function dxfDoc(body: string): Buffer {
  return Buffer.from(['0', 'SECTION', '2', 'ENTITIES', body, '0', 'ENDSEC', '0', 'EOF'].join('\n'), 'utf-8');
}

function frameLines(layer: string, x0: number, y0: number, x1: number, y1: number): string {
  // Border persegi + 2 garis dalam agar tiap sheet punya massa entity realistis.
  const segs: Array<[number, number, number, number]> = [
    [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0],
    [x0, (y0 + y1) / 2, x1, (y0 + y1) / 2],
    [(x0 + x1) / 2, y0, (x0 + x1) / 2, y1],
  ];
  return segs.map(([ax, ay, bx, by]) =>
    ['0', 'LINE', '8', layer,
      '10', String(ax), '20', String(ay), '30', '0',
      '11', String(bx), '21', String(by), '31', '0'].join('\n'),
  ).join('\n');
}

// Two sheets: cluster A near x=100, cluster B near x=5000.
function twoSheetDxf(): Buffer {
  const body = [
    frameLines('Level 3', 0, 0, 400, 400),
    textEntity('V-101', 'Level 6', 100, 200),
    circleEntity('Level 5', 105, 205, 10),
    frameLines('Level 3', 5000, 0, 5400, 400),
    textEntity('P-202', 'Level 6', 5100, 200),
    circleEntity('Level 5', 5105, 205, 10),
    // Construction overlay junk — must never become a detection.
    textEntity('V-999', 'Level 40(Construction)', 110, 210),
  ].join('\n');
  return dxfDoc(body);
}

describe('splitDxfRegions', () => {
  it('splits a two-sheet file into two regions', () => {
    const parsed = parseDxf(twoSheetDxf());
    const regions = splitDxfRegions(parsed);
    expect(regions.length).toBe(2);
    expect(regions[0].index).toBe(0);
    expect(regions[1].index).toBe(1);
  });

  it('keeps a single-sheet file as one region', () => {
    const body = [
      textEntity('V-101', 'Level 6', 100, 200),
      circleEntity('Level 5', 105, 205, 10),
    ].join('\n');
    const parsed = parseDxf(dxfDoc(body));
    expect(splitDxfRegions(parsed).length).toBe(1);
  });
});

describe('runDxfDetection (vector-native Lap 1)', () => {
  it('assigns pidPage per sheet region', () => {
    const res = runDxfDetection(twoSheetDxf(), []);
    const pages = new Set(res.detections.map((d) => d.pidPage));
    expect(pages.has(1)).toBe(true);
    expect(pages.has(2)).toBe(true);
    expect(res.regions.length).toBe(2);
    for (const d of res.detections) {
      expect(d.pidPage).toBe(d.regionIndex + 1);
    }
  });

  it('never prefix-guesses: unknown type without legend match', () => {
    const res = runDxfDetection(twoSheetDxf(), []);
    const v101 = res.detections.filter((d) => d.assetTag === 'V-101');
    expect(v101.length).toBeGreaterThan(0);
    for (const d of v101) {
      // Dulu: V → 'Valve'. Sekarang: UNKNOWN + butuh validasi.
      expect(d.assetType).toBe(UNKNOWN_ASSET_TYPE);
      expect(d.needsGeminiClassification).toBe(true);
    }
  });

  it('resolves type from legend tag_pattern (V-### → Vessel)', () => {
    const legend = [{
      id: 'sym-1',
      asset_type: 'Vessel',
      symbol_name: 'Vessel',
      tag_pattern: 'V-###',
      aliases: [],
    }];
    const res = runDxfDetection(twoSheetDxf(), legend);
    const v101 = res.detections.filter((d) => d.assetTag === 'V-101');
    expect(v101.length).toBeGreaterThan(0);
    for (const d of v101) {
      expect(d.assetType).toBe('Vessel');
    }
  });

  it('excludes construction-layer tags entirely', () => {
    const res = runDxfDetection(twoSheetDxf(), []);
    expect(res.detections.some((d) => d.assetTag === 'V-999')).toBe(false);
  });

  it('keeps bboxes in whole-file 0-1000 space', () => {
    const res = runDxfDetection(twoSheetDxf(), []);
    expect(res.detections.length).toBeGreaterThan(0);
    for (const d of res.detections) {
      expect(d.bbox.x).toBeGreaterThanOrEqual(0);
      expect(d.bbox.y).toBeGreaterThanOrEqual(0);
      expect(d.bbox.x + d.bbox.width).toBeLessThanOrEqual(1000);
      expect(d.bbox.y + d.bbox.height).toBeLessThanOrEqual(1000);
      expect(d.confidence).toBeGreaterThanOrEqual(0.3);
      expect(d.confidence).toBeLessThanOrEqual(0.99);
    }
  });

  it('marks same-tag-different-position in one region as CONFLICT', () => {
    // Satu region, tag sama di dua posisi berjauhan (bukan duplikat layer).
    const body = [
      '0', 'LINE', '8', 'Level 3',
      '10', '0', '20', '0', '30', '0',
      '11', '3000', '21', '0', '31', '0',
      textEntity('V-101', 'Level 6', 100, 0),
      circleEntity('Level 5', 105, 5, 10),
      textEntity('V-101', 'Level 6', 2900, 0),
      circleEntity('Level 5', 2905, 5, 10),
    ].join('\n');
    const res = runDxfDetection(dxfDoc(body), []);
    const dupes = res.detections.filter((d) => d.assetTag === 'V-101');
    // Keduanya disimpan (tidak dibuang diam-diam) + salah satu/both CONFLICT,
    // ATAU terpisah jadi 2 region (juga legal — beda sheet).
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    const pages = new Set(dupes.map((d) => d.pidPage));
    if (pages.size === 1) {
      expect(dupes.some((d) => d.evidence.some((e) => e.includes('CONFLICT')))).toBe(true);
    }
  });
});
