/**
 * Geometry-first duplicate detection.
 *
 * Regression target: the previous "same tag + same type" rule left duplicates
 * in place whenever the two lanes labelled the same symbol differently, and the
 * UI's tag+type key hid every untagged detection of a type behind a single row.
 */
import {
  findDuplicates,
  typeCompatible,
  tagBase,
  isJunkAssetType,
  type DuplicateRow,
} from '@/lib/detection/duplicate-detection';

function row(overrides: Partial<DuplicateRow> & { id: string }): DuplicateRow {
  return {
    assetTag: 'P-101',
    assetType: 'Pump',
    confidence: 0.9,
    page: 1,
    bbox: { x: 100, y: 100, width: 100, height: 100 },
    ...overrides,
  };
}

describe('findDuplicates', () => {
  it('marks same tag + same type + overlapping boxes', () => {
    const res = findDuplicates([
      row({ id: 'a', confidence: 0.95 }),
      row({ id: 'b', confidence: 0.8 }),
    ]);
    expect([...res.duplicateIds]).toEqual(['b']);
    expect(res.duplicateOf.get('b')).toBe('a');
  });

  it('marks duplicate boxes even when the type labels disagree', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: null, assetType: 'Valve', confidence: 0.94 }),
      row({ id: 'b', assetTag: null, assetType: 'iso', confidence: 0.7 }),
    ]);
    expect(res.duplicateIds.has('b')).toBe(true);
  });

  it('marks synthetic UNK-tagged duplicates (different tags, same symbol)', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: 'UNK-350', assetType: 'UNKNOWN' }),
      row({ id: 'b', assetTag: 'UNK-351', assetType: 'UNKNOWN' }),
    ]);
    expect(res.duplicateIds.has('b')).toBe(true);
  });

  it('does not merge two different instruments that share one tap', () => {
    const res = findDuplicates([
      row({
        id: 'pi',
        assetTag: 'PI-232',
        assetType: 'Pressure Indicator',
        bbox: { x: 100, y: 100, width: 100, height: 100 },
      }),
      row({
        id: 'pt',
        assetTag: 'PT-232',
        assetType: 'Pressure Transmitter',
        bbox: { x: 118, y: 100, width: 100, height: 100 },
      }),
    ]);
    expect(res.duplicateIds.size).toBe(0);
  });

  it('merges near-identical boxes regardless of labels', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: 'XV-001', assetType: 'Valve' }),
      row({
        id: 'b',
        assetTag: null,
        assetType: 'UNKNOWN',
        bbox: { x: 102, y: 101, width: 99, height: 99 },
      }),
    ]);
    expect(res.duplicateIds.has('b')).toBe(true);
  });

  it('matches OCR tag variants with an inserted separator', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: 'LSLL-0601', assetType: 'Level Switch' }),
      row({
        id: 'b',
        assetTag: 'LSLL-V-0601',
        assetType: 'Level Switch',
        bbox: { x: 108, y: 100, width: 100, height: 100 },
      }),
    ]);
    expect(res.duplicateIds.has('b')).toBe(true);
  });

  it('marks OCR suffix drift on the same symbol', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: 'PCV-003', assetType: 'Control Valve' }),
      row({
        id: 'b',
        assetTag: 'PCV-003B',
        assetType: 'Control Valve',
        bbox: { x: 110, y: 100, width: 100, height: 100 },
      }),
    ]);
    expect(res.duplicateIds.has('b')).toBe(true);
  });

  it('does not mark distinct assets that merely touch', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: 'P-101' }),
      row({ id: 'b', assetTag: 'P-102', assetType: 'Pump', bbox: { x: 170, y: 100, width: 100, height: 100 } }),
    ]);
    expect(res.duplicateIds.size).toBe(0);
  });

  it('does not mark an instrument nested inside a vessel outline', () => {
    const res = findDuplicates([
      row({
        id: 'v',
        assetTag: 'V-101',
        assetType: 'Vessel',
        bbox: { x: 0, y: 0, width: 400, height: 400 },
        confidence: 0.99,
      }),
      row({
        id: 'i',
        assetTag: 'TI-101',
        assetType: 'Temperature Indicator',
        bbox: { x: 180, y: 180, width: 20, height: 40 },
        confidence: 0.95,
      }),
    ]);
    expect(res.duplicateIds.size).toBe(0);
  });

  it('never merges across pages', () => {
    const res = findDuplicates([
      row({ id: 'a', page: 1 }),
      row({ id: 'b', page: 2 }),
    ]);
    expect(res.duplicateIds.size).toBe(0);
  });

  it('keeps every untagged symbol that does not actually overlap', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: null, assetType: 'Valve' }),
      row({ id: 'b', assetTag: null, assetType: 'Valve', bbox: { x: 500, y: 500, width: 80, height: 80 } }),
      row({ id: 'c', assetTag: null, assetType: 'Valve', bbox: { x: 900, y: 100, width: 60, height: 60 } }),
    ]);
    expect(res.duplicateIds.size).toBe(0);
  });

  it('prefers approved / typed / high-confidence rows as the winner', () => {
    const res = findDuplicates([
      row({ id: 'low', confidence: 0.5, assetType: 'UNKNOWN', assetTag: null }),
      row({ id: 'approved', confidence: 0.7, assetType: 'Valve', reviewStatus: 'APPROVED' }),
      row({ id: 'typed', confidence: 0.95, assetType: 'Control Valve' }),
    ]);
    expect(res.duplicateOf.get('low')).toBe('approved');
    expect(res.groups[0].winnerId).toBe('approved');
  });

  it('pairs a tagged detection with an UNKNOWN duplicate of it', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: null, assetType: 'UNKNOWN', bbox: { x: 100, y: 100, width: 100, height: 100 } }),
      row({ id: 'b', assetTag: 'XV-001', assetType: 'Valve', bbox: { x: 105, y: 105, width: 100, height: 100 } }),
    ]);
    expect(res.duplicateOf.get('a')).toBe('b');
  });

  it('marks duplicate with same tag on same sheet within centroid distance even when type labels disagree', () => {
    const res = findDuplicates([
      row({ id: 'a', assetTag: 'W-0201', assetType: 'Equipment', bbox: { x: 617, y: 553, width: 23, height: 20 }, confidence: 0.8 }),
      row({ id: 'b', assetTag: 'W-0201', assetType: 'DIESEL ENGINE', bbox: { x: 617, y: 565, width: 20, height: 16 }, confidence: 0.98 }),
    ]);
    expect(res.duplicateIds.has('a')).toBe(true);
    expect(res.groups[0].winnerId).toBe('b');
  });
});

describe('type helpers', () => {
  it('treats junk type labels as wildcards', () => {
    expect(isJunkAssetType('iso')).toBe(true);
    expect(isJunkAssetType('niso')).toBe(true);
    expect(isJunkAssetType('UNKNOWN')).toBe(true);
    expect(isJunkAssetType('Equipment')).toBe(true);
    expect(isJunkAssetType('generic')).toBe(true);
    expect(isJunkAssetType('valve.general.iso')).toBe(true);
    expect(isJunkAssetType('Valve')).toBe(false);
  });

  it('matches related type labels but not unrelated ones', () => {
    expect(typeCompatible('Control Valve', 'Valve')).toBe(true);
    expect(typeCompatible('Pressure Differential Transmitter', 'Pressure Transmitter')).toBe(true);
    expect(typeCompatible('Valve', 'UNKNOWN')).toBe(true);
    expect(typeCompatible('Vessel', 'Pump')).toBe(false);
  });

  it('strips a revision letter but keeps numeric identity', () => {
    expect(tagBase('PCV-003B')).toBe('PCV-003');
    expect(tagBase('PCV-003')).toBe('PCV-003');
    expect(tagBase('P-101')).toBe('P-101');
    expect(tagBase('P-102')).toBe('P-102');
  });
});
