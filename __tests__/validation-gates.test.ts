/**
 * Validation gate tests (Blok 6) — locks down the DB-forensics findings:
 * tags "9"/"10"/"11" and types "iso"/"pip"/"niso" must never persist.
 */
import {
  isValidAssetTag,
  buildTagRegexes,
  humanizeYoloLabel,
  sanitizeAssetType,
} from '@/lib/validation';

describe('isValidAssetTag', () => {
  const rx = buildTagRegexes(['P-###', 'V-###']);
  it.each([
    ['P-2001', true],
    ['V-0101', true],
    ['T-0401A', true],
    ['FIC-2101-01', true],
    ['LI-0201', true],
  ])('accepts real tag %s', (tag, expected) => {
    expect(isValidAssetTag(tag, rx)).toBe(expected);
  });
  it.each([
    ['9', 'pure number (Gemini hallucination)'],
    ['10', 'pure number'],
    ['X', 'single letter (OCR fragment)'],
    ['4', 'single digit (OCR fragment)'],
    ['M', 'status code'],
    ['R-ST', 'status code'],
    ['PIT', 'word without digits'],
    ['FLARE STACK', 'description text'],
    ['3/4"DRAIN', 'dimension starting with digit'],
    ['2"-150#', 'pipe spec'],
    ['V-0101 B', 'tag with trailing word (kept as description, not tag)'],
  ])('rejects junk %s (%s)', (tag) => {
    expect(isValidAssetTag(tag, rx)).toBe(false);
  });
  it('accepts structurally valid A-00N (type was the junk part, not the tag)', () => {
    expect(isValidAssetTag('A-00N', rx)).toBe(true);
  });
});

describe('humanizeYoloLabel', () => {
  it.each([
    ['valve.ball.iso', 'Ball Valve'],
    ['valve.pressure_relief.pip', 'Pressure Relief Valve'],
    ['equipment.pump.niso', 'Pump'],
    ['equipment.centrifugal_blower.pip', 'Centrifugal Blower'],
    ['instrument.level_indicator.niso', 'Level Indicator'],
    ['instrument.level_transmitter.niso', 'Level Transmitter'],
    ['valve.3way_ball.iso', '3-Way Ball Valve'],
  ])('%s → %s', (raw, expected) => {
    expect(humanizeYoloLabel(raw)).toBe(expected);
  });
  it.each([
    'iso',
    'pip',
    'niso',
    'unknown.cylinder.niso',
    'mystery',
    '',
    null,
  ])('returns null for %s', (raw) => {
    expect(humanizeYoloLabel(raw)).toBeNull();
  });
});

describe('sanitizeAssetType', () => {
  it.each(['iso', 'pip', 'niso', 'valve.general.iso', '', 'ab', null])(
    'nukes %s to UNKNOWN',
    (t) => {
      expect(sanitizeAssetType(t)).toBe('UNKNOWN');
    },
  );
  it('keeps legit types', () => {
    expect(sanitizeAssetType('Vessel')).toBe('Vessel');
    expect(sanitizeAssetType('Ball Valve')).toBe('Ball Valve');
  });
  it('enforces vocabulary when provided', () => {
    const vocab = new Set(['vessel', 'tank', 'centrifugal pump']);
    expect(sanitizeAssetType('Vessel', vocab)).toBe('Vessel');
    expect(sanitizeAssetType('Ball Valve', vocab)).toBe('UNKNOWN');
  });
});
