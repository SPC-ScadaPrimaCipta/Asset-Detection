import { associateNearestPipingSize, extractPipingCandidatesFromTokens, type TextToken } from '@/lib/spatial-piping';

describe('Spatial Piping Size Association for PDF', () => {
  it('assigns size from nearest horizontal pipe label', () => {
    const valveBbox = { x: 100, y: 200, width: 40, height: 40 };
    const textTokens: TextToken[] = [
      { text: '2” - WS - B - 007', bbox: { x: 80, y: 180, width: 120, height: 16 } },
      { text: '6” - P - 1001', bbox: { x: 800, y: 900, width: 100, height: 16 } },
    ];

    const match = associateNearestPipingSize(valveBbox, textTokens);
    expect(match).not.toBeNull();
    expect(match?.size).toBe('2"');
    expect(match?.lineText).toBe('2” - WS - B - 007');
  });

  it('assigns size from nearest vertical pipe label', () => {
    const valveBbox = { x: 300, y: 500, width: 40, height: 40 };
    const textTokens: TextToken[] = [
      { text: '4” - NG - B8CS2F - A1 - 008', bbox: { x: 280, y: 400, width: 16, height: 150 } },
    ];

    const match = associateNearestPipingSize(valveBbox, textTokens);
    expect(match).not.toBeNull();
    expect(match?.size).toBe('4"');
    expect(match?.lineText).toBe('4” - NG - B8CS2F - A1 - 008');
  });

  it('returns null if no pipe label is within max distance', () => {
    const valveBbox = { x: 100, y: 200, width: 40, height: 40 };
    const textTokens: TextToken[] = [
      { text: '6” - P - 1001', bbox: { x: 800, y: 900, width: 100, height: 16 } },
    ];

    const match = associateNearestPipingSize(valveBbox, textTokens, 100);
    expect(match).toBeNull();
  });

  it('extracts piping candidates from raw OCR tokens', () => {
    const tokens: TextToken[] = [
      { text: 'P-101A', bbox: { x: 10, y: 10, width: 50, height: 20 } },
      { text: '4” - NG - B3CS2F - 01 - 004', bbox: { x: 100, y: 100, width: 150, height: 20 } },
      { text: 'PUMP', bbox: { x: 20, y: 30, width: 40, height: 15 } },
    ];

    const candidates = extractPipingCandidatesFromTokens(tokens);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].size).toBe('4"');
  });
});
