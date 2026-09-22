import { associateTagsToSymbols, nearestTagForSymbol } from '@/lib/spatial';
import type { Detection } from '@/lib/ai-schemas';

const makeDetection = (overrides: Partial<Detection> = {}): Detection => ({
  assetType: 'Pump',
  assetTag: 'P-101',
  confidence: 0.9,
  bbox: { x: 100, y: 100, width: 50, height: 50 },
  evidence: ['Symbol matches legend'],
  description: null,
  equipmentClass: null,
  service: null,
  mainEquipment: null,
  location: null,
  unit: null,
  area: null,
  legendSymbol: null,
  ...overrides,
});

describe('associateTagsToSymbols', () => {
  it('passes through detection when no tag patterns configured', () => {
    const d = makeDetection({ assetTag: 'P-101' });
    const result = associateTagsToSymbols([d], []);
    expect(result).toHaveLength(1);
    expect(result[0].assetTag).toBe('P-101');
    expect(result[0].confidence).toBe(0.9); // unchanged
  });

  it('passes through when tag matches pattern', () => {
    const d = makeDetection({ assetTag: 'P-101' });
    const result = associateTagsToSymbols([d], [/^P-\d+$/i]);
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].evidence).toHaveLength(1);
  });

  it('downgrades confidence when tag does not match any pattern', () => {
    const d = makeDetection({ assetTag: 'XYZ-999', confidence: 0.95 });
    const result = associateTagsToSymbols([d], [/^P-\d+$/i]);
    expect(result[0].confidence).toBeLessThanOrEqual(0.79);
    expect(result[0].evidence.some((e) => e.includes('Tag pattern'))).toBe(true);
  });

  it('passes through detection with null assetTag unchanged', () => {
    const d = makeDetection({ assetTag: null });
    const result = associateTagsToSymbols([d], [/^P-\d+$/i]);
    expect(result[0].assetTag).toBeNull();
    expect(result[0].confidence).toBe(0.9);
  });

  it('handles multiple detections independently', () => {
    const d1 = makeDetection({ assetTag: 'P-101' });
    const d2 = makeDetection({ assetTag: 'WRONG', confidence: 0.95 });
    const result = associateTagsToSymbols([d1, d2], [/^P-\d+$/i]);
    expect(result[0].confidence).toBe(0.9);  // passes
    expect(result[1].confidence).toBeLessThanOrEqual(0.79); // downgraded
  });
});

describe('nearestTagForSymbol', () => {
  const symbol = { bbox: { x: 100, y: 100, width: 50, height: 50 }, label: 'Pump' };

  it('returns nearest tag within maxDist', () => {
    const tags = [
      { text: 'P-101', bbox: { x: 120, y: 120, width: 40, height: 15 } },
      { text: 'V-201', bbox: { x: 900, y: 900, width: 40, height: 15 } },
    ];
    const result = nearestTagForSymbol(symbol, tags);
    expect(result?.text).toBe('P-101');
  });

  it('returns null when no tag within maxDist', () => {
    const tags = [
      { text: 'V-201', bbox: { x: 900, y: 900, width: 40, height: 15 } },
    ];
    const result = nearestTagForSymbol(symbol, tags, 100);
    expect(result).toBeNull();
  });

  it('returns null for empty tag list', () => {
    expect(nearestTagForSymbol(symbol, [])).toBeNull();
  });
});
