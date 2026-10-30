import {
  suggestAbbreviation,
  formatTagPattern,
  extractPrefixAndDigitsFromPattern,
  allocateNextProjectTag,
  applyProjectAutoTagging,
} from '@/lib/tag-generator';

describe('Smart Tag Abbreviation & Project Tag Allocator', () => {
  describe('suggestAbbreviation', () => {
    it('suggests standard ISA/PIP abbreviation for known valve types', () => {
      expect(suggestAbbreviation('Gate Valve')).toBe('GTV');
      expect(suggestAbbreviation('Ball Valve')).toBe('BV');
      expect(suggestAbbreviation('Globe Valve')).toBe('GLV');
      expect(suggestAbbreviation('Check Valve')).toBe('CV');
      expect(suggestAbbreviation('Control Valve')).toBe('FCV');
    });

    it('suggests standard abbreviation for rotating & static equipment', () => {
      expect(suggestAbbreviation('Pump')).toBe('P');
      expect(suggestAbbreviation('Centrifugal Pump')).toBe('P');
      expect(suggestAbbreviation('Compressor')).toBe('C');
      expect(suggestAbbreviation('Heat Exchanger')).toBe('E');
      expect(suggestAbbreviation('Tank')).toBe('TK');
      expect(suggestAbbreviation('Vessel')).toBe('V');
    });

    it('suggests standard abbreviation for instruments', () => {
      expect(suggestAbbreviation('Pressure Safety Valve')).toBe('PSV');
      expect(suggestAbbreviation('Pressure Transmitter')).toBe('PT');
      expect(suggestAbbreviation('Flow Transmitter')).toBe('FT');
      expect(suggestAbbreviation('Temperature Indicator')).toBe('TI');
    });

    it('creates acronym heuristic for custom equipment names', () => {
      expect(suggestAbbreviation('High Pressure Separator')).toBe('HPS');
      expect(suggestAbbreviation('Double Block Bleed')).toBe('DBB');
    });
  });

  describe('formatTagPattern & extractPrefixAndDigitsFromPattern', () => {
    it('formats prefix into standard tag pattern string', () => {
      expect(formatTagPattern('GTV', 3)).toBe('GTV-###');
      expect(formatTagPattern('P', 4)).toBe('P-####');
    });

    it('extracts prefix and digits count from pattern string', () => {
      expect(extractPrefixAndDigitsFromPattern('GTV-###')).toEqual({
        prefix: 'GTV',
        digits: 3,
        delimiter: '-',
      });
      expect(extractPrefixAndDigitsFromPattern('P-####')).toEqual({
        prefix: 'P',
        digits: 4,
        delimiter: '-',
      });
      expect(extractPrefixAndDigitsFromPattern('TK001')).toEqual({
        prefix: 'TK',
        digits: 3,
        delimiter: '',
      });
    });
  });

  describe('allocateNextProjectTag', () => {
    it('starts with 001 if no tags exist in project for this prefix', () => {
      const existing = new Set<string>();
      const tag = allocateNextProjectTag('GTV', existing, 3);
      expect(tag).toBe('GTV-001');
    });

    it('increments from highest existing number in the project', () => {
      const existing = new Set(['GTV-001', 'GTV-002', 'P-101']);
      const tag = allocateNextProjectTag('GTV', existing, 3);
      expect(tag).toBe('GTV-003');
    });

    it('handles gaps by taking max + 1 to prevent collision', () => {
      const existing = new Set(['GTV-001', 'GTV-015', 'GTV-004']);
      const tag = allocateNextProjectTag('GTV', existing, 3);
      expect(tag).toBe('GTV-016');
    });

    it('supports 4 digits padding when configured', () => {
      const existing = new Set(['P-0001', 'P-0002']);
      const tag = allocateNextProjectTag('P', existing, 4);
      expect(tag).toBe('P-0003');
    });

    it('is case-insensitive to existing tags', () => {
      const existing = new Set(['gtv-005', 'GTV-006']);
      const tag = allocateNextProjectTag('GTV', existing, 3);
      expect(tag).toBe('GTV-007');
    });
  });

  describe('applyProjectAutoTagging', () => {
    it('preserves missing tags when generation is disabled', () => {
      const detections = [{ assetTag: null, assetType: 'Pump', evidence: [] }];
      const result = applyProjectAutoTagging(detections, {
        existingProjectTags: new Set(),
        legendSymbols: [],
        allowGeneratedTags: false,
      });
      expect(result.generatedCount).toBe(0);
      expect(detections[0].assetTag).toBeNull();
    });
    it('leaves existing OCR/detected tags untouched and uses them to avoid collision', () => {
      const existingProjectTags = new Set<string>();
      const detections = [
        { assetTag: 'GTV-001', assetType: 'Gate Valve', evidence: ['OCR found GTV-001'] },
        { assetTag: null, assetType: 'Gate Valve', evidence: [] },
      ];

      const legendSymbols = [
        { asset_type: 'Gate Valve', tag_pattern: 'GTV-###' },
      ];

      const result = applyProjectAutoTagging(detections, { existingProjectTags, legendSymbols });
      expect(result.generatedCount).toBe(1);
      expect(detections[0].assetTag).toBe('GTV-001');
      // Must not collide with GTV-001, so it allocates GTV-002
      expect(detections[1].assetTag).toBe('GTV-002');
      expect(detections[1].evidence).toContain('[Auto-Tag] Generated unique project tag GTV-002 (GTV)');
    });

    it('honors legend-symbol tag_pattern configured by the user', () => {
      const existingProjectTags = new Set(['GV-010']);
      const detections = [
        { assetTag: null, assetType: 'Gate Valve', legendSymbol: 'Special GV', evidence: [] },
      ];

      const legendSymbols = [
        { id: 'sym-1', asset_type: 'Gate Valve', symbol_name: 'Special GV', tag_pattern: 'GV-####' },
      ];

      const result = applyProjectAutoTagging(detections, { existingProjectTags, legendSymbols });
      expect(result.generatedCount).toBe(1);
      expect(detections[0].assetTag).toBe('GV-0011');
      expect(existingProjectTags.has('GV-0011')).toBe(true);
    });

    it('falls back to standard ISA abbreviation when no pattern is defined', () => {
      const existingProjectTags = new Set<string>();
      const detections = [
        { assetTag: null, assetType: 'Centrifugal Pump', evidence: [] },
      ];

      const result = applyProjectAutoTagging(detections, { existingProjectTags, legendSymbols: [] });
      expect(result.generatedCount).toBe(1);
      expect(detections[0].assetTag).toBe('P-001');
    });
  });
});

