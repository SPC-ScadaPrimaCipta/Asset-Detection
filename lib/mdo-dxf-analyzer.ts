/**
 * DXF Process Flow Analyzer for MDO (FROM/TO/OF/AT/SIZE/DIRECTION)
 *
 * Traces piping connections directly from DXF vector entities:
 * - LINE, POLYLINE, ARC entities = physical pipe routes
 * - Spatial proximity = connection relationships
 * - Text labels near lines = size/label annotations
 *
 * Much more accurate than PDF pixel tracing because:
 * 1. Exact vector coordinates (not OCR)
 * 2. Direct entity connectivity graph
 * 3. Layer context (equipment/pipe/tag layers)
 */

import type {
  DxfParseResult,
  DxfLineEntity,
  DxfPolylineEntity,
  DxfArcEntity,
  DxfTextEntity,
  DxfInsertEntity,
  DxfCircleEntity,
  DxfPoint,
} from '@/lib/dxf-parser';
import { cleanMdoFieldValue } from '@/lib/mdo-description';
import {
  detectDxfArrows,
  matchArrowsToPipes,
  findArrowsNearAsset,
  type ArrowMatch,
  type PipeSegment as ArrowPipeSegment,
} from '@/lib/dxf-arrow-detector';

export interface MdoFlowRelation {
  assetTag: string;
  from: string | null;
  to: string | null;
  of: string | null;
  at: string | null;
  size: string | null;
  direction: 'INLET' | 'OUTLET' | 'UNKNOWN';
  confidence?: number;
}

interface AssetNode {
  tag: string;
  type: string;
  description?: string | null;
  bbox: { x: number; y: number; width: number; height: number };
  center: DxfPoint;
}

interface PipeSegment {
  start: DxfPoint;
  end: DxfPoint;
  layer: string;
  entity: DxfLineEntity | DxfPolylineEntity | DxfArcEntity;
}

interface TextLabel {
  content: string;
  position: DxfPoint;
  layer: string;
}

/**
 * Analyzes DXF process flow for detected assets using vector geometry.
 * Returns Map keyed by assetTag (uppercase) -> MdoFlowRelation.
 */
export async function analyzeDxfProcessFlow(
  dxfData: DxfParseResult,
  assets: Array<{
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    bbox: { x: number; y: number; width: number; height: number };
  }>,
): Promise<Map<string, MdoFlowRelation>> {
  const results = new Map<string, MdoFlowRelation>();

  // Filter valid assets
  const validAssets = assets.filter((a) => a.assetTag && a.assetTag.trim().length > 0);
  if (validAssets.length === 0) return results;

  console.log(`[dxf-flow] Starting analysis for ${validAssets.length} assets`);

  // Convert assets to nodes with center points
  const nodes: AssetNode[] = validAssets.map((a) => ({
    tag: a.assetTag!.trim().toUpperCase(),
    type: a.assetType,
    description: a.description,
    bbox: a.bbox,
    center: {
      x: a.bbox.x + a.bbox.width / 2,
      y: a.bbox.y + a.bbox.height / 2,
    },
  }));

  // Extract pipe segments (LINE, POLYLINE, ARC on pipe layers)
  const pipeSegments = extractPipeSegments(dxfData);
  console.log(`[dxf-flow] Extracted ${pipeSegments.length} pipe segments`);

  // Extract text labels near pipes (size, labels)
  const textLabels = extractTextLabels(dxfData);
  console.log(`[dxf-flow] Extracted ${textLabels.length} text labels`);
  
  // Log first 5 text samples for debugging
  if (textLabels.length > 0) {
    console.log(`[dxf-flow] Sample text labels:`);
    textLabels.slice(0, 5).forEach((lbl, i) => {
      console.log(`[dxf-flow]   ${i + 1}. "${lbl.content}" @ (${lbl.position.x.toFixed(1)}, ${lbl.position.y.toFixed(1)}) [${lbl.layer}]`);
    });
  }

  // Detect arrows from SOLID entities
  const arrows = detectDxfArrows(dxfData);
  
  // Match arrows to pipe segments
  const arrowMatches = matchArrowsToPipes(
    arrows,
    pipeSegments.map(seg => ({
      start: seg.start,
      end: seg.end,
      layer: seg.layer,
    })),
    50, // search radius
  );
  console.log(`[dxf-flow] Detected ${arrows.length} arrows, matched ${arrowMatches.length} to pipes`);

  // Build spatial index for fast proximity queries
  const spatialIndex = buildSpatialIndex(pipeSegments, textLabels);

  // Analyze each asset
  for (const node of nodes) {
    console.log(`[dxf-flow] Analyzing ${node.tag} @ (${node.center.x.toFixed(1)}, ${node.center.y.toFixed(1)})`);
    const relation = analyzeAssetConnections(
      node,
      pipeSegments,
      textLabels,
      nodes,
      spatialIndex,
      dxfData.extents,
      arrowMatches, // ← Pass arrow matches
    );
    console.log(`[dxf-flow]   FROM: ${relation.from || 'null'}, TO: ${relation.to || 'null'}, OF: ${relation.of || 'null'}, SIZE: ${relation.size || 'null'}`);
    results.set(node.tag, relation);
  }

  return results;
}

/**
 * Extract pipe segments from LINE, POLYLINE, ARC entities.
 * Filter by pipe-related layers (configurable).
 */
function extractPipeSegments(dxf: DxfParseResult): PipeSegment[] {
  const segments: PipeSegment[] = [];
  // Expanded patterns to catch more variations
  const pipeLayerPatterns = [
    /pipe/i, /piping/i, /line/i, /flow/i, /proc/i, /process/i,
    /fluid/i, /conduit/i, /tubing/i, /duct/i, /route/i
  ];

  const isPipeLayer = (layer: string): boolean => {
    const lower = layer.toLowerCase();
    // Also accept if layer is categorized as 'pipe' by DXF parser
    if (dxf.layerMap[layer] === 'pipe') return true;
    return pipeLayerPatterns.some((re) => re.test(lower));
  };

  let lineCount = 0, polyCount = 0, arcCount = 0, skippedCount = 0;
  const matchedLayers = new Set<string>();

  for (const entity of dxf.entities) {
    if (!isPipeLayer(entity.layer)) {
      skippedCount++;
      continue;
    }

    matchedLayers.add(entity.layer);

    if (entity.kind === 'LINE') {
      segments.push({
        start: entity.start,
        end: entity.end,
        layer: entity.layer,
        entity,
      });
      lineCount++;
    } else if (entity.kind === 'LWPOLYLINE') {
      const vertices = entity.vertices;
      for (let i = 0; i < vertices.length - 1; i++) {
        segments.push({
          start: vertices[i],
          end: vertices[i + 1],
          layer: entity.layer,
          entity,
        });
      }
      polyCount++;
    } else if (entity.kind === 'ARC') {
      const start = arcStartPoint(entity);
      const end = arcEndPoint(entity);
      segments.push({
        start,
        end,
        layer: entity.layer,
        entity,
      });
      arcCount++;
    }
  }

  console.log(`[dxf-flow] Pipe segments: ${lineCount} LINE, ${polyCount} POLYLINE, ${arcCount} ARC (skipped ${skippedCount} non-pipe entities)`);
  console.log(`[dxf-flow] Matched pipe layers: ${Array.from(matchedLayers).join(', ') || '(none)'}`);

  // Fallback: if no pipe segments found, use ALL LINE/POLYLINE/ARC (with warning)
  if (segments.length === 0) {
    console.warn('[dxf-flow] ⚠️  No pipe layers detected. Falling back to ALL geometric entities.');
    for (const entity of dxf.entities) {
      if (entity.kind === 'LINE') {
        segments.push({
          start: entity.start,
          end: entity.end,
          layer: entity.layer,
          entity,
        });
      } else if (entity.kind === 'LWPOLYLINE') {
        const vertices = entity.vertices;
        for (let i = 0; i < vertices.length - 1; i++) {
          segments.push({
            start: vertices[i],
            end: vertices[i + 1],
            layer: entity.layer,
            entity,
          });
        }
      } else if (entity.kind === 'ARC') {
        const start = arcStartPoint(entity);
        const end = arcEndPoint(entity);
        segments.push({
          start,
          end,
          layer: entity.layer,
          entity,
        });
      }
    }
    console.log(`[dxf-flow] Fallback loaded ${segments.length} segments from all layers`);
  }

  return segments;
}

/**
 * Extract text labels from TEXT/MTEXT entities.
 */
function extractTextLabels(dxf: DxfParseResult): TextLabel[] {
  const labels: TextLabel[] = [];

  for (const entity of dxf.entities) {
    if (entity.kind !== 'TEXT' && entity.kind !== 'MTEXT') continue;
    if (!entity.text || entity.text.trim().length === 0) continue;
    labels.push({
      content: entity.text.trim(),
      position: entity.position,
      layer: entity.layer,
    });
  }

  return labels;
}

/**
 * Build spatial index for fast proximity queries.
 * Groups segments and labels by grid cells.
 */
interface SpatialIndex {
  gridSize: number;
  segmentCells: Map<string, PipeSegment[]>;
  labelCells: Map<string, TextLabel[]>;
}

function buildSpatialIndex(segments: PipeSegment[], labels: TextLabel[]): SpatialIndex {
  const gridSize = 500; // DXF units (adjust based on typical drawing scale)
  const index: SpatialIndex = {
    gridSize,
    segmentCells: new Map(),
    labelCells: new Map(),
  };

  // Index segments
  for (const seg of segments) {
    const cells = getCellsForSegment(seg, gridSize);
    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      if (!index.segmentCells.has(key)) index.segmentCells.set(key, []);
      index.segmentCells.get(key)!.push(seg);
    }
  }

  // Index labels
  for (const lbl of labels) {
    const cell = getCell(lbl.position, gridSize);
    const key = `${cell.x},${cell.y}`;
    if (!index.labelCells.has(key)) index.labelCells.set(key, []);
    index.labelCells.get(key)!.push(lbl);
  }

  return index;
}

function getCell(pt: DxfPoint, gridSize: number): { x: number; y: number } {
  return {
    x: Math.floor(pt.x / gridSize),
    y: Math.floor(pt.y / gridSize),
  };
}

function getCellsForSegment(seg: PipeSegment, gridSize: number): { x: number; y: number }[] {
  const cells = new Set<string>();
  const startCell = getCell(seg.start, gridSize);
  const endCell = getCell(seg.end, gridSize);

  // Bresenham-like grid walk
  const dx = Math.abs(endCell.x - startCell.x);
  const dy = Math.abs(endCell.y - startCell.y);
  const sx = startCell.x < endCell.x ? 1 : -1;
  const sy = startCell.y < endCell.y ? 1 : -1;
  let err = dx - dy;
  let x = startCell.x;
  let y = startCell.y;

  while (true) {
    cells.add(`${x},${y}`);
    if (x === endCell.x && y === endCell.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return Array.from(cells).map((key) => {
    const [cx, cy] = key.split(',').map(Number);
    return { x: cx, y: cy };
  });
}

/**
 * Analyze connections for a single asset node.
 */
function analyzeAssetConnections(
  node: AssetNode,
  allSegments: PipeSegment[],
  allLabels: TextLabel[],
  allNodes: AssetNode[],
  spatialIndex: SpatialIndex,
  extents: { width: number; height: number },
  arrowMatches: ArrowMatch[], // ← New parameter
): MdoFlowRelation {
  // Scale search radius with drawing size (10% of drawing dimension for large drawings)
  const drawingScale = Math.max(extents.width, extents.height);
  const searchRadius = Math.max(1500, drawingScale * 0.20); // min 1500, or 20% of drawing (increased from 10%)
  console.log(`[dxf-flow]   Search radius: ${searchRadius.toFixed(0)} units (drawing scale: ${drawingScale.toFixed(0)})`);

  // Find pipe segments near this asset
  const nearSegments = findNearbySegments(node.center, allSegments, spatialIndex, searchRadius);
  console.log(`[dxf-flow]   Found ${nearSegments.length} nearby pipe segments`);

  // Find text labels near these segments
  const nearLabels = findNearbyLabels(node.center, allLabels, spatialIndex, searchRadius);
  console.log(`[dxf-flow]   Found ${nearLabels.length} nearby text labels`);

  // Find arrows near this asset
  const arrowAnalysis = findArrowsNearAsset(node.center, arrowMatches, searchRadius);
  if (arrowAnalysis.inletArrows.length > 0 || arrowAnalysis.outletArrows.length > 0) {
    console.log(`[dxf-flow]   Found ${arrowAnalysis.inletArrows.length} inlet arrows, ${arrowAnalysis.outletArrows.length} outlet arrows`);
    console.log(`[dxf-flow]   Primary direction from arrows: ${arrowAnalysis.primaryDirection}`);
  }

  // Extract labeled relations (FROM/TO/OF/AT explicit text)
  const labeledRelations = extractLabeledRelations(nearLabels, node.center, searchRadius);

  // Trace upstream (FROM) and downstream (TO) via pipe connectivity
  const connectedNodes = traceConnections(node, nearSegments, allNodes);

  // Fusion: labeled text takes precedence over traced connections
  const from = labeledRelations.from || connectedNodes.upstream || null;
  const to = labeledRelations.to || connectedNodes.downstream || null;

  // Extract size from nearby labels
  const size = extractSizeFromLabels(nearLabels);

  // Extract OF (parent line/header) - labeled text OR keyword match
  // If no nearby labels, search entire label pool
  let ofLabels = nearLabels;
  if (ofLabels.length === 0) {
    ofLabels = allLabels; // fallback to all labels
    console.log(`[dxf-flow]   No near labels for ${node.tag}, using global pool (${allLabels.length} total)`);
  }
  const of = labeledRelations.of || extractOfFromLabels(ofLabels, node.description);

  // Extract AT (location) - labeled text OR keyword match OR description
  // If no nearby labels, search entire label pool
  let atLabels = nearLabels;
  if (atLabels.length === 0) {
    atLabels = allLabels; // fallback to all labels
  }
  const at = labeledRelations.at || extractAtFromContext(node, atLabels);

  // Determine flow direction from arrows OR segment context
  const direction = determineFlowDirection(
    node,
    nearSegments,
    connectedNodes,
    arrowAnalysis, // ← Use arrow analysis
  );

  return {
    assetTag: node.tag,
    from,
    to,
    of,
    at,
    size,
    direction,
    confidence: calculateConfidence(
      { upstream: from, downstream: to },
      size,
      of,
      at,
      labeledRelations.from !== null || labeledRelations.to !== null, // boost if labeled
      arrowAnalysis.primaryDirection !== 'UNKNOWN', // boost if arrow detected
    ),
  };
}

/**
 * Find pipe segments within search radius of point.
 */
function findNearbySegments(
  center: DxfPoint,
  allSegments: PipeSegment[],
  spatialIndex: SpatialIndex,
  radius: number,
): PipeSegment[] {
  const cell = getCell(center, spatialIndex.gridSize);
  const nearby: PipeSegment[] = [];

  // Search in 3x3 grid around center cell
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cell.x + dx},${cell.y + dy}`;
      const segs = spatialIndex.segmentCells.get(key);
      if (!segs) continue;

      for (const seg of segs) {
        const dist = pointToSegmentDistance(center, seg.start, seg.end);
        if (dist <= radius) nearby.push(seg);
      }
    }
  }

  return nearby;
}

/**
 * Find text labels within search radius.
 */
function findNearbyLabels(
  center: DxfPoint,
  allLabels: TextLabel[],
  spatialIndex: SpatialIndex,
  radius: number,
): TextLabel[] {
  const cell = getCell(center, spatialIndex.gridSize);
  const nearby: TextLabel[] = [];

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cell.x + dx},${cell.y + dy}`;
      const lbls = spatialIndex.labelCells.get(key);
      if (!lbls) continue;

      for (const lbl of lbls) {
        const dist = distance(center, lbl.position);
        if (dist <= radius) nearby.push(lbl);
      }
    }
  }

  return nearby;
}

/**
 * Trace pipe connections to find upstream (FROM) and downstream (TO) assets.
 */
function traceConnections(
  node: AssetNode,
  segments: PipeSegment[],
  allNodes: AssetNode[],
): { upstream: string | null; downstream: string | null } {
  let upstream: string | null = null;
  let downstream: string | null = null;

  if (segments.length === 0) {
    return { upstream, downstream };
  }

  // Build connectivity graph from segments
  const graph = buildConnectivityGraph(segments);

  // Find connected segments to node's bounding box
  const connectedPoints = findConnectedPoints(node, segments);
  console.log(`[dxf-flow]   Connected points found: ${connectedPoints.length}`);
  if (connectedPoints.length === 0 && segments.length > 0) {
    console.log(`[dxf-flow]   DEBUG: bbox = ${JSON.stringify(node.bbox)}`);
    console.log(`[dxf-flow]   DEBUG: sample segments (first 3):`);
    segments.slice(0, 3).forEach((seg, i) => {
      console.log(`[dxf-flow]     seg${i}: (${seg.start.x.toFixed(1)}, ${seg.start.y.toFixed(1)}) → (${seg.end.x.toFixed(1)}, ${seg.end.y.toFixed(1)}) [${seg.layer}]`);
    });
  }

  // Trace from each connection point
  const allReachedAssets: string[] = [];
  for (const point of connectedPoints) {
    // Walk along connected segments
    const reachedAssets = walkPipeNetwork(point, graph, allNodes, node.tag, 10); // max 10 hops
    allReachedAssets.push(...reachedAssets);
  }

  // Remove duplicates while preserving order
  const uniqueReached = Array.from(new Set(allReachedAssets));

  // Assign: first reached = upstream (inlet), second = downstream (outlet)
  // This is a heuristic; arrow direction or flow context would be more accurate
  if (uniqueReached.length > 0) {
    upstream = uniqueReached[0];
  }
  if (uniqueReached.length > 1) {
    downstream = uniqueReached[1];
  }
  // If only 1 asset reached, try to classify via arrow direction or heuristic
  if (uniqueReached.length === 1 && !downstream) {
    // Could be inlet or outlet — leave for arrow/heuristic logic
    downstream = uniqueReached[0]; // fallback: assume it's downstream
  }

  // Fallback: if no connected points or single connection, find nearby assets by proximity
  if (uniqueReached.length === 0 && allNodes.length > 0) {
    console.log(`[dxf-flow]   No pipe connections found, using spatial proximity fallback`);
    const nearbyAssets = allNodes
      .filter((n) => n.tag !== node.tag)
      .map((n) => ({
        tag: n.tag,
        distance: Math.hypot(n.center.x - node.center.x, n.center.y - node.center.y),
      }))
      .sort((a, b) => a.distance - b.distance);

    if (nearbyAssets.length > 0) {
      upstream = nearbyAssets[0].tag;
      console.log(`[dxf-flow]   Fallback upstream (spatial): ${upstream} @ distance ${nearbyAssets[0].distance.toFixed(0)}`);
    }
    if (nearbyAssets.length > 1) {
      downstream = nearbyAssets[1].tag;
      console.log(`[dxf-flow]   Fallback downstream (spatial): ${downstream} @ distance ${nearbyAssets[1].distance.toFixed(0)}`);
    }
  }

  return { upstream, downstream };
}

/**
 * Build connectivity graph from pipe segments.
 * Returns Map of point -> connected points.
 */
function buildConnectivityGraph(segments: PipeSegment[]): Map<string, DxfPoint[]> {
  const graph = new Map<string, DxfPoint[]>();
  const snap = 5; // tolerance for point equality

  const pointKey = (p: DxfPoint): string => {
    const sx = Math.round(p.x / snap) * snap;
    const sy = Math.round(p.y / snap) * snap;
    return `${sx},${sy}`;
  };

  for (const seg of segments) {
    const sk = pointKey(seg.start);
    const ek = pointKey(seg.end);

    if (!graph.has(sk)) graph.set(sk, []);
    if (!graph.has(ek)) graph.set(ek, []);

    graph.get(sk)!.push(seg.end);
    graph.get(ek)!.push(seg.start);
  }

  return graph;
}

/**
 * Find pipe connection points near asset bbox.
 */
function findConnectedPoints(node: AssetNode, segments: PipeSegment[]): DxfPoint[] {
  const points: DxfPoint[] = [];
  const threshold = 300; // Increased from 150 DXF units

  for (const seg of segments) {
    if (isPointNearBbox(seg.start, node.bbox, threshold)) {
      points.push(seg.start);
    }
    if (isPointNearBbox(seg.end, node.bbox, threshold)) {
      points.push(seg.end);
    }
  }

  return points;
}

function isPointNearBbox(
  pt: DxfPoint,
  bbox: { x: number; y: number; width: number; height: number },
  threshold: number,
): boolean {
  const bboxCenter = {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
  const dist = distance(pt, bboxCenter);
  return dist <= threshold;
}

/**
 * Walk pipe network from starting point to find connected assets.
 */
function walkPipeNetwork(
  start: DxfPoint,
  graph: Map<string, DxfPoint[]>,
  allNodes: AssetNode[],
  excludeTag: string,
  maxHops: number,
): string[] {
  const visited = new Set<string>();
  const queue: Array<{ pt: DxfPoint; hops: number }> = [{ pt: start, hops: 0 }];
  const reachedAssets: string[] = [];
  const snap = 5;

  const pointKey = (p: DxfPoint): string => {
    const sx = Math.round(p.x / snap) * snap;
    const sy = Math.round(p.y / snap) * snap;
    return `${sx},${sy}`;
  };

  while (queue.length > 0) {
    const { pt, hops } = queue.shift()!;
    if (hops >= maxHops) continue;

    const key = pointKey(pt);
    if (visited.has(key)) continue;
    visited.add(key);

    // Check if we reached another asset
    const assetAtPoint = allNodes.find(
      (n) => n.tag !== excludeTag && isPointNearBbox(pt, n.bbox, 400),
    );
    if (assetAtPoint) {
      reachedAssets.push(assetAtPoint.tag);
      continue; // stop walking beyond this asset
    }

    // Continue walking to connected points
    const connected = graph.get(key);
    if (connected) {
      for (const nextPt of connected) {
        queue.push({ pt: nextPt, hops: hops + 1 });
      }
    }
  }

  return reachedAssets;
}

/**
 * Extract FROM/TO/OF/AT from labeled text near asset.
 * Looks for text patterns: "FROM PSV-T-131", "TO V-101", "OF HEADER A", "AT DISCHARGE"
 */
function extractLabeledRelations(
  labels: TextLabel[],
  center: DxfPoint,
  searchRadius: number,
): { from: string | null; to: string | null; of: string | null; at: string | null } {
  const LABEL_RE = /^(FROM|TO|OF|AT)\s+(.+)$/i;
  const result = { from: null as string | null, to: null as string | null, of: null as string | null, at: null as string | null };

  for (const lbl of labels) {
    const dist = distance(center, lbl.position);
    if (dist > searchRadius) continue;

    const match = lbl.content.trim().match(LABEL_RE);
    if (!match) continue;

    const key = match[1].toLowerCase() as 'from' | 'to' | 'of' | 'at';
    const value = match[2].trim();
    if (!value) continue;

    // Take first match per key (closest already filtered by search radius)
    if (!result[key]) {
      result[key] = value;
      console.log(`[dxf-flow]   Found labeled ${key.toUpperCase()}: "${value}"`);
    }
  }

  return result;
}

/**
 * Extract size from nearby text labels (e.g. "2\"", "4\" 150#").
 */
function extractSizeFromLabels(labels: TextLabel[]): string | null {
  const sizePattern = /\b(\d+(?:\.\d+)?(?:\/\d+)?)\s*["″]/; // e.g. "2\"", "1/2\""

  for (const lbl of labels) {
    const match = lbl.content.match(sizePattern);
    if (match) return cleanMdoFieldValue(match[0]);
  }

  return null;
}

/**
 * Extract OF (parent line/header) from labels.
 */
function extractOfFromLabels(labels: TextLabel[], nodeDescription?: string | null): string | null {
  const ofPatterns = [/header|line|main|slug\s*catcher|metering|pipe|stream|circuit|loop|system/i];

  // Check node description first (highest priority)
  if (nodeDescription && ofPatterns.some((re) => re.test(nodeDescription))) {
    return cleanMdoFieldValue(nodeDescription);
  }

  for (const lbl of labels) {
    if (ofPatterns.some((re) => re.test(lbl.content))) {
      return cleanMdoFieldValue(lbl.content);
    }
  }

  return null;
}

/**
 * Extract AT (location) from context.
 */
function extractAtFromContext(node: AssetNode, labels: TextLabel[]): string | null {
  const atPatterns = [/wellhead|discharge|suction|nozzle|tower|top|bottom|inlet|outlet|connection|port|opening|takeoff/i];

  // Check node description first
  if (node.description) {
    if (atPatterns.some((re) => re.test(node.description!))) {
      return cleanMdoFieldValue(node.description);
    }
  }

  // Check nearby labels
  for (const lbl of labels) {
    if (atPatterns.some((re) => re.test(lbl.content))) {
      return cleanMdoFieldValue(lbl.content);
    }
  }

  return null;
}

/**
 * Determine flow direction from arrow geometry OR asset type heuristic.
 */
function determineFlowDirection(
  node: AssetNode,
  segments: PipeSegment[],
  connectedNodes: { upstream: string | null; downstream: string | null },
  arrowAnalysis: { primaryDirection: 'INLET' | 'OUTLET' | 'UNKNOWN' },
): 'INLET' | 'OUTLET' | 'UNKNOWN' {
  // Priority 1: Arrow geometry (most accurate)
  if (arrowAnalysis.primaryDirection !== 'UNKNOWN') {
    return arrowAnalysis.primaryDirection;
  }

  // Priority 2: Heuristic based on asset type
  const typeUpper = node.type.toUpperCase();

  if (typeUpper.includes('PUMP') || typeUpper.includes('COMPRESSOR')) {
    // Equipment with clear flow direction
    return connectedNodes.upstream && connectedNodes.downstream ? 'OUTLET' : 'UNKNOWN';
  }

  if (typeUpper.includes('VALVE') || typeUpper.includes('INSTRUMENT')) {
    // In-line equipment
    return 'UNKNOWN';
  }

  // Default: unknown without explicit arrow
  return 'UNKNOWN';
}

/**
 * Calculate confidence score based on data completeness.
 */
function calculateConfidence(
  connectedNodes: { upstream: string | null; downstream: string | null },
  size: string | null,
  of: string | null,
  at: string | null,
  hasLabeledRelations = false,
  hasArrowDetection = false, // ← New parameter
): number {
  let score = 0.5; // base

  if (connectedNodes.upstream) score += 0.15;
  if (connectedNodes.downstream) score += 0.15;
  if (size) score += 0.1;
  if (of) score += 0.05;
  if (at) score += 0.05;

  // Boost confidence if FROM/TO from explicit labels (not just traced)
  if (hasLabeledRelations) score += 0.1;

  // Boost confidence if arrow detected (direction certainty)
  if (hasArrowDetection) score += 0.05;

  return Math.min(score, 0.95);
}

// ── Geometry Utilities ────────────────────────────────────────────────────────

function distance(a: DxfPoint, b: DxfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistance(pt: DxfPoint, a: DxfPoint, b: DxfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return distance(pt, a);

  let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closest = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };

  return distance(pt, closest);
}

function arcStartPoint(arc: DxfArcEntity): DxfPoint {
  const rad = (arc.startAngle * Math.PI) / 180;
  return {
    x: arc.center.x + arc.radius * Math.cos(rad),
    y: arc.center.y + arc.radius * Math.sin(rad),
  };
}

function arcEndPoint(arc: DxfArcEntity): DxfPoint {
  const rad = (arc.endAngle * Math.PI) / 180;
  return {
    x: arc.center.x + arc.radius * Math.cos(rad),
    y: arc.center.y + arc.radius * Math.sin(rad),
  };
}
