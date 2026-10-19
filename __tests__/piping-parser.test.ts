import { parseLineSpecText, extractSizeFromLineSpec } from '@/lib/piping-parser';

describe('Piping Spec Parser', () => {
  it('parses standard horizontal imperial line specs', () => {
    const res = parseLineSpecText('2” - WS - B - 007');
    expect(res).not.toBeNull();
    expect(res?.pipeSize).toBe('2"');
    expect(res?.service).toBe('WS');
    expect(res?.spec).toBe('B-007');
  });

  it('parses complex multi-part line specs', () => {
    const res = parseLineSpecText('4” - NG - B3CS2F - 01 - 004');
    expect(res).not.toBeNull();
    expect(res?.pipeSize).toBe('4"');
    expect(res?.service).toBe('NG');
    expect(res?.spec).toBe('B3CS2F-01-004');
  });

  it('parses vertical rotated specs with em-dash and straight quotes', () => {
    const res = parseLineSpecText('4" - NG - B8CS2F - A1 - 008');
    expect(res).not.toBeNull();
    expect(res?.pipeSize).toBe('4"');
    expect(res?.service).toBe('NG');
  });

  it('parses fractional and metric pipe sizes', () => {
    expect(extractSizeFromLineSpec('1-1/2" - P - 1001')).toBe('1-1/2"');
    expect(extractSizeFromLineSpec('1/2"-IA-200')).toBe('1/2"');
    expect(extractSizeFromLineSpec('DN100 - P - 1001')).toBe('DN100');
    expect(extractSizeFromLineSpec('DN 50 - HC - 2001')).toBe('DN50');
  });

  it('returns null for unrelated text strings', () => {
    expect(parseLineSpecText('FLOW TRANSMITTER')).toBeNull();
    expect(parseLineSpecText('P-101A')).toBeNull();
  });
});
