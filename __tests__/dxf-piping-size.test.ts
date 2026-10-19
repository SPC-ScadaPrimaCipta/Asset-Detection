import { associatePipingLinesToValves } from '@/lib/dxf-detection';

describe('DXF Piping Line Size Association', () => {
  it('associates valve with collinear pipe line size', () => {
    const lines = [
      { start: { x: 0, y: 100 }, end: { x: 500, y: 100 }, text: '4” - NG - B3CS2F - 01 - 004', size: '4"' }
    ];
    const valves = [
      {
        assetTag: 'VLV-001',
        assetType: 'Gate Valve',
        description: null,
        confidence: 0.9,
        bbox: { x: 240, y: 90, width: 20, height: 20 },
        evidence: [] as string[],
        blockName: 'GATE_VALVE',
        layer: 'EQUIP',
        source: 'INSERT' as const,
        rawPosition: { x: 250, y: 100 },
        regionIndex: 0,
        pidPage: 1,
        size: null as string | null,
      }
    ];

    const result = associatePipingLinesToValves(valves, lines);
    expect(result[0].size).toBe('4"');
    expect(result[0].evidence.some((e: string) => e.includes('Line-Size'))).toBe(true);
  });

  it('associates valve along vertical pipe line', () => {
    const lines = [
      { start: { x: 300, y: 0 }, end: { x: 300, y: 600 }, text: '2” - WS - B - 007', size: '2"' }
    ];
    const valves = [
      {
        assetTag: 'VLV-002',
        assetType: 'Check Valve',
        description: null,
        confidence: 0.85,
        bbox: { x: 290, y: 340, width: 20, height: 20 },
        evidence: [] as string[],
        blockName: 'CHECK_VALVE',
        layer: 'EQUIP',
        source: 'INSERT' as const,
        rawPosition: { x: 300, y: 350 },
        regionIndex: 0,
        pidPage: 1,
        size: null as string | null,
      }
    ];

    const result = associatePipingLinesToValves(valves, lines);
    expect(result[0].size).toBe('2"');
  });

  it('does not associate if valve is far away from pipe line', () => {
    const lines = [
      { start: { x: 0, y: 100 }, end: { x: 500, y: 100 }, text: '4” - NG - B3CS2F - 01 - 004', size: '4"' }
    ];
    const valves = [
      {
        assetTag: 'VLV-003',
        assetType: 'Ball Valve',
        description: null,
        confidence: 0.9,
        bbox: { x: 240, y: 800, width: 20, height: 20 },
        evidence: [] as string[],
        blockName: 'BALL_VALVE',
        layer: 'EQUIP',
        source: 'INSERT' as const,
        rawPosition: { x: 250, y: 800 },
        regionIndex: 0,
        pidPage: 1,
        size: null as string | null,
      }
    ];

    const result = associatePipingLinesToValves(valves, lines, 50);
    expect(result[0].size).toBeNull();
  });
});
