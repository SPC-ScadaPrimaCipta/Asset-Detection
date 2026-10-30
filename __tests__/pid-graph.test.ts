import { buildPidGraph, detectArrowheads, classifyPortDirection } from '@/lib/pid-graph';

test('snaps connected DXF line endpoints into graph nodes', () => {
  const graph = buildPidGraph([
    { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, layer: 'PIPE' },
    { kind: 'LINE', start: { x: 100.5, y: 0 }, end: { x: 200, y: 0 }, layer: 'PIPE' },
  ], 1);
  expect(graph.nodes).toHaveLength(3);
  expect(graph.edges).toHaveLength(2);
  expect(graph.edges[0].to).toBe(graph.edges[1].from);
});

test('detects closed triangular arrowhead and classifies flow toward equipment as inlet', () => {
  const markers = detectArrowheads([
    { kind: 'LWPOLYLINE', vertices: [{ x: 0, y: -5 }, { x: 10, y: 0 }, { x: 0, y: 5 }], layer: 'FLOW', closed: true },
  ], 20);
  expect(markers).toHaveLength(1);
  expect(classifyPortDirection(markers[0], { x: 12, y: 0 }, 20)).toBe('INLET');
});
