import { formatLegendAssetType, isSpecificAssetType } from '@/lib/rule-validator';

describe('formatLegendAssetType & isSpecificAssetType', () => {
  it('identifies generic types versus specific types', () => {
    expect(isSpecificAssetType('Valve')).toBe(false);
    expect(isSpecificAssetType('equipment')).toBe(false);
    expect(isSpecificAssetType('instrument')).toBe(false);
    expect(isSpecificAssetType('unknown')).toBe(false);

    expect(isSpecificAssetType('Ball Valve')).toBe(true);
    expect(isSpecificAssetType('Gate Valve')).toBe(true);
    expect(isSpecificAssetType('Check Valve')).toBe(true);
    expect(isSpecificAssetType('Centrifugal Pump')).toBe(true);
  });

  it('formats uppercase legend symbol names to Title Case', () => {
    expect(formatLegendAssetType('BALL VALVE', 'Valve')).toBe('Ball Valve');
    expect(formatLegendAssetType('CENTRIFUGAL COMPRESSOR', 'Compressor')).toBe('Centrifugal Compressor');
    expect(formatLegendAssetType('DOUBLE PIPE HEAT EXCHANGER', 'Heat Exchanger')).toBe('Double Pipe Heat Exchanger');
  });

  it('strips operational annotations and parentheses correctly', () => {
    expect(formatLegendAssetType('BALL VALVE (OPEN/CLOSED)', 'Valve')).toBe('Ball Valve');
    expect(formatLegendAssetType('GATE VALVE (OPEN/CLOSED)', 'Valve')).toBe('Gate Valve');
    expect(formatLegendAssetType('(GLOBE VALVE) 1) OPEN POSITION 2) CLOSED POSITION', 'Valve')).toBe('Globe Valve');
    expect(formatLegendAssetType('AIR-COOLED HEAT EXCHANGER (FORCED FAN)', 'Heat Exchanger')).toBe('Air-Cooled Heat Exchanger');
  });

  it('falls back to fallbackType when symbolName is empty or generic', () => {
    expect(formatLegendAssetType('', 'Valve')).toBe('Valve');
    expect(formatLegendAssetType(null, 'Pump')).toBe('Pump');
    expect(formatLegendAssetType('other', 'Valve')).toBe('Valve');
  });
});
