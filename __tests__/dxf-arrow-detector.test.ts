import { parseDxf } from '@/lib/dxf-parser';
import {
  detectDxfArrows,
  matchArrowsToPipes,
  findArrowsNearAsset,
} from '@/lib/dxf-arrow-detector';
import { analyzeDxfProcessFlow } from '@/lib/mdo-dxf-analyzer';

function solidEntity(layer: string, pts: Array<[number, number]>): string {
  const codes = [10, 11, 12, 13];
  const parts = ['0', 'SOLID', '8', layer];
  pts.forEach(([x, y], i) => {
    parts.push(String(codes[i]), String(x), String(20 + i), String(y), String(30 + i), '0');
  });
  return parts.join('\n');
}

function dxfDoc(body: string): Buffer {
  return Buffer.from(
    ['0', 'SECTION', '2', 'ENTITIES', body, '0', 'ENDSEC', '0', 'EOF'].join('\n'),
    'utf-8',
  );
}

const rightArrow = solidEntity('FLOW', [
  [0, -5],
  [10, 0],
  [0, 5],
  [0, 5],
]);

describe('SOLID arrow detection', () => {
  it('parses SOLID entities from DXF', () => {
    const parsed = parseDxf(dxfDoc(rightArrow));
    const solid = parsed.entities.find(
      (e) => (e as { kind: string }).kind === 'SOLID',
    ) as unknown as { vertices: unknown[] } | undefined;
    expect(solid).toBeDefined();
    expect(solid?.vertices.length).toBe(4);
  });

  it('detects triangle apex direction from SOLID vertices', () => {
    const parsed = parseDxf(dxfDoc(rightArrow));
    const arrows = detectDxfArrows(parsed);
    expect(arrows).toHaveLength(1);
    expect(arrows[0].direction).toBe('RIGHT');
    expect(arrows[0].pointingAngle).toBeCloseTo(0, 0);
  });

  it('matches arrow to nearest pipe segment', () => {
    const parsed = parseDxf(dxfDoc(rightArrow));
    const arrows = detectDxfArrows(parsed);
    const matches = matchArrowsToPipes(
      arrows,
      [{ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, layer: 'PIPE' }],
      50,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].distance).toBeLessThan(10);
  });

  it('classifies arrow pointing toward asset as inlet and away as outlet', () => {
    const parsed = parseDxf(dxfDoc(rightArrow));
    const arrows = detectDxfArrows(parsed);
    const matches = matchArrowsToPipes(
      arrows,
      [{ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, layer: 'PIPE' }],
      50,
    );

    expect(findArrowsNearAsset({ x: 30, y: 0 }, matches, 100).primaryDirection).toBe('INLET');
    expect(findArrowsNearAsset({ x: -30, y: 0 }, matches, 100).primaryDirection).toBe('OUTLET');
  });

  it('feeds arrow direction into MDO flow analysis', async () => {
    const parsed = parseDxf(
      dxfDoc(
        [
          ['0', 'LINE', '8', 'PIPE', '10', '0', '20', '0', '11', '100', '21', '0'].join('\n'),
          rightArrow,
        ].join('\n'),
      ),
    );

    const flow = await analyzeDxfProcessFlow(parsed, [
      {
        assetTag: 'XV-101',
        assetType: 'VALVE',
        bbox: { x: -20, y: -20, width: 40, height: 40 },
      },
    ]);

    expect(flow.get('XV-101')?.direction).toBe('OUTLET');
  });
});
