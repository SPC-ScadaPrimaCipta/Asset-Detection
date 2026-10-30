import type { DxfEntity, DxfPoint } from '@/lib/dxf-parser';

export interface GraphNode { id: string; point: DxfPoint; kind: 'ENDPOINT' | 'JUNCTION' | 'EQUIPMENT'; }
export interface GraphEdge { id: string; from: string; to: string; length: number; source: 'LINE' | 'POLYLINE'; }
export interface PidGraph { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface Arrowhead { point: DxfPoint; direction: DxfPoint; confidence: number; }

function distance(a: DxfPoint, b: DxfPoint) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function buildPidGraph(entities: DxfEntity[], snapTolerance: number): PidGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeAt = (point: DxfPoint) => {
    const found = nodes.find((n) => n.kind !== 'EQUIPMENT' && distance(n.point, point) <= snapTolerance);
    if (found) return found;
    const node = { id: `N${nodes.length + 1}`, point, kind: 'ENDPOINT' as const };
    nodes.push(node); return node;
  };
  const addEdge = (a: DxfPoint, b: DxfPoint, source: GraphEdge['source']) => {
    const from = nodeAt(a), to = nodeAt(b);
    edges.push({ id: `E${edges.length + 1}`, from: from.id, to: to.id, length: distance(a, b), source });
  };
  for (const entity of entities) {
    if (entity.kind === 'LINE') addEdge(entity.start, entity.end, 'LINE');
    if (entity.kind === 'LWPOLYLINE') for (let i = 1; i < entity.vertices.length; i++) addEdge(entity.vertices[i - 1], entity.vertices[i], 'POLYLINE');
  }
  const degree = new Map<string, number>();
  for (const edge of edges) { degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1); degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1); }
  for (const node of nodes) if ((degree.get(node.id) ?? 0) > 2) node.kind = 'JUNCTION';
  return { nodes, edges };
}

export function nearestGraphNode(graph: PidGraph, point: DxfPoint, maxDistance: number): GraphNode | null {
  return graph.nodes.filter((n) => n.kind !== 'JUNCTION').sort((a, b) => distance(a.point, point) - distance(b.point, point)).find((n) => distance(n.point, point) <= maxDistance) ?? null;
}

export function graphNodeDegree(graph: PidGraph, nodeId: string): number {
  return graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
}

export function graphRelationEvidence(graph: PidGraph, point: DxfPoint, tolerance: number): string[] {
  const node = nearestGraphNode(graph, point, tolerance);
  if (!node) return [];
  const degree = graphNodeDegree(graph, node.id);
  return [`Connected piping graph node ${node.id}`, `Connected segment count: ${degree}`];
}

export function detectArrowheads(entities: DxfEntity[], maxSize: number): Arrowhead[] {
  const arrows: Arrowhead[] = [];
  for (const entity of entities) {
    if (entity.kind !== 'LWPOLYLINE' || !entity.closed || entity.vertices.length < 3) continue;
    const xs = entity.vertices.map((p) => p.x), ys = entity.vertices.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = maxX - minX, height = maxY - minY;
    if (Math.max(width, height) > maxSize || Math.min(width, height) <= 0) continue;
    const point = width >= height ? { x: maxX, y: (minY + maxY) / 2 } : { x: (minX + maxX) / 2, y: maxY };
    const center = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
    const dx = point.x - center.x, dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    arrows.push({ point, direction: { x: dx / length, y: dy / length }, confidence: 0.75 });
  }
  return arrows;
}

export function classifyPortDirection(
  arrow: Arrowhead,
  equipmentPoint: DxfPoint,
  tolerance: number,
): 'INLET' | 'OUTLET' | 'UNKNOWN' {
  const distanceToPoint = distance(arrow.point, equipmentPoint);
  if (distanceToPoint > tolerance) return 'UNKNOWN';
  const towardEquipment = { x: equipmentPoint.x - arrow.point.x, y: equipmentPoint.y - arrow.point.y };
  const dot = arrow.direction.x * towardEquipment.x + arrow.direction.y * towardEquipment.y;
  return dot > 0 ? 'INLET' : 'OUTLET';
}
