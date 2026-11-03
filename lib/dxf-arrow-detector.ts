/**
 * DXF Arrow Detector
 *
 * Detects flow direction arrows from SOLID entities (filled triangles).
 * Arrows are typically drawn as 3-vertex SOLID entities in P&ID drawings.
 *
 * Algorithm:
 * 1. Filter SOLID entities with 3 vertices (triangles)
 * 2. Calculate centroid (center point)
 * 3. Determine pointing direction (angle of triangle apex)
 * 4. Match arrows to nearby pipe segments
 * 5. Classify flow direction (INLET/OUTLET based on angle)
 */

import type {
  DxfParseResult,
  DxfPoint,
  DxfSolidEntity,
} from "@/lib/dxf-parser";

export interface ArrowEntity {
  position: DxfPoint; // centroid of triangle
  pointingAngle: number; // degrees (0=right, 90=up, 180=left, 270=down)
  direction: "RIGHT" | "UP" | "LEFT" | "DOWN" | "UNKNOWN";
  vertices: DxfPoint[]; // original 3 vertices
  layer: string;
  nearestPipeDistance: number | null;
}

/**
 * Detect arrows from SOLID entities in DXF.
 */
export function detectDxfArrows(dxfData: DxfParseResult): ArrowEntity[] {
  const arrows: ArrowEntity[] = [];

  for (const entity of dxfData.entities) {
    if (entity.kind !== "SOLID") continue;
    if (entity.vertices.length !== 3) continue; // Only triangles

    const arrow = analyzeTriangleArrow(entity);
    if (arrow) arrows.push(arrow);
  }

  console.log(`[arrow-detector] Found ${arrows.length} arrow entities`);
  return arrows;
}

/**
 * Analyze a triangle SOLID entity to determine arrow direction.
 */
function analyzeTriangleArrow(solid: DxfSolidEntity): ArrowEntity | null {
  const vertices = solid.vertices;
  if (vertices.length !== 3) return null;

  // Calculate centroid (center of triangle)
  const centroid = calculateCentroid(vertices);

  // Determine pointing direction
  const pointingAngle = calculatePointingAngle(vertices, centroid);
  const direction = angleToDirection(pointingAngle);

  return {
    position: centroid,
    pointingAngle,
    direction,
    vertices,
    layer: solid.layer,
    nearestPipeDistance: null, // will be set later during matching
  };
}

/**
 * Calculate centroid (geometric center) of triangle.
 */
function calculateCentroid(vertices: DxfPoint[]): DxfPoint {
  const sumX = vertices.reduce((sum, v) => sum + v.x, 0);
  const sumY = vertices.reduce((sum, v) => sum + v.y, 0);
  return {
    x: sumX / vertices.length,
    y: sumY / vertices.length,
  };
}

/**
 * Calculate pointing angle of triangle arrow.
 * Strategy: Find the vertex farthest from centroid (the "apex" of arrow).
 * The angle from centroid to apex is the pointing direction.
 */
function calculatePointingAngle(
  vertices: DxfPoint[],
  centroid: DxfPoint,
): number {
  // Find apex (farthest vertex from centroid)
  let maxDist = 0;
  let apex = vertices[0];

  for (const v of vertices) {
    const dist = distance(v, centroid);
    if (dist > maxDist) {
      maxDist = dist;
      apex = v;
    }
  }

  // Calculate angle from centroid to apex
  const dx = apex.x - centroid.x;
  const dy = apex.y - centroid.y;
  const angleRad = Math.atan2(dy, dx);
  let angleDeg = (angleRad * 180) / Math.PI;

  // Normalize to 0-360
  if (angleDeg < 0) angleDeg += 360;

  return angleDeg;
}

/**
 * Convert angle to cardinal direction.
 */
function angleToDirection(
  angle: number,
): "RIGHT" | "UP" | "LEFT" | "DOWN" | "UNKNOWN" {
  // Normalize angle to 0-360
  const normalized = ((angle % 360) + 360) % 360;

  // Cardinal directions with 45-degree tolerance
  if (normalized >= 315 || normalized < 45) return "RIGHT";
  if (normalized >= 45 && normalized < 135) return "UP";
  if (normalized >= 135 && normalized < 225) return "LEFT";
  if (normalized >= 225 && normalized < 315) return "DOWN";

  return "UNKNOWN";
}

/**
 * Match arrows to pipe segments and determine flow direction for assets.
 */
export interface PipeSegment {
  start: DxfPoint;
  end: DxfPoint;
  layer: string;
}

export interface ArrowMatch {
  arrow: ArrowEntity;
  segment: PipeSegment;
  distance: number;
  flowDirection: "INLET" | "OUTLET";
}

/**
 * Match arrows to nearby pipe segments within search radius.
 */
export function matchArrowsToPipes(
  arrows: ArrowEntity[],
  pipeSegments: PipeSegment[],
  searchRadius = 50, // DXF units
): ArrowMatch[] {
  const matches: ArrowMatch[] = [];

  for (const arrow of arrows) {
    let closestSegment: PipeSegment | null = null;
    let minDistance = Infinity;

    // Find nearest pipe segment
    for (const segment of pipeSegments) {
      const dist = pointToSegmentDistance(
        arrow.position,
        segment.start,
        segment.end,
      );
      if (dist < minDistance && dist <= searchRadius) {
        minDistance = dist;
        closestSegment = segment;
      }
    }

    if (closestSegment) {
      // Determine flow direction relative to segment
      const flowDirection = determineFlowDirection(arrow, closestSegment);

      matches.push({
        arrow,
        segment: closestSegment,
        distance: minDistance,
        flowDirection,
      });

      // Update arrow with nearest pipe distance
      arrow.nearestPipeDistance = minDistance;
    }
  }

  console.log(`[arrow-detector] Matched ${matches.length} arrows to pipes`);
  return matches;
}

/**
 * Determine if arrow indicates INLET or OUTLET flow.
 * Strategy: Check if arrow points toward or away from pipe segment.
 */
function determineFlowDirection(
  arrow: ArrowEntity,
  segment: PipeSegment,
): "INLET" | "OUTLET" {
  // Calculate segment direction vector
  const segmentAngle = Math.atan2(
    segment.end.y - segment.start.y,
    segment.end.x - segment.start.x,
  );
  let segmentAngleDeg = (segmentAngle * 180) / Math.PI;
  if (segmentAngleDeg < 0) segmentAngleDeg += 360;

  // Calculate angle difference
  const angleDiff = Math.abs(arrow.pointingAngle - segmentAngleDeg);
  const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

  // If arrow points roughly same direction as segment (±90°) = OUTLET
  // If arrow points opposite direction (>90°) = INLET
  if (normalizedDiff < 90) {
    return "OUTLET"; // Flow going out in direction of arrow
  } else {
    return "INLET"; // Flow coming in opposite to arrow
  }
}

/**
 * Find arrows near an asset and determine its primary flow direction.
 */
export function findArrowsNearAsset(
  assetCenter: DxfPoint,
  arrowMatches: ArrowMatch[],
  searchRadius = 100, // DXF units
): {
  inletArrows: ArrowMatch[];
  outletArrows: ArrowMatch[];
  primaryDirection: "INLET" | "OUTLET" | "UNKNOWN";
} {
  const inletArrows: ArrowMatch[] = [];
  const outletArrows: ArrowMatch[] = [];

  for (const match of arrowMatches) {
    const dist = distance(assetCenter, match.arrow.position);
    if (dist <= searchRadius) {
      if (match.flowDirection === "INLET") {
        inletArrows.push(match);
      } else {
        outletArrows.push(match);
      }
    }
  }

  // Determine primary direction
  let primaryDirection: "INLET" | "OUTLET" | "UNKNOWN" = "UNKNOWN";
  if (outletArrows.length > inletArrows.length) {
    primaryDirection = "OUTLET";
  } else if (inletArrows.length > outletArrows.length) {
    primaryDirection = "INLET";
  } else if (inletArrows.length > 0 && outletArrows.length > 0) {
    // Equal count or both present → equipment with inlet/outlet (like pump)
    primaryDirection = "OUTLET"; // Default to outlet for equipment
  }

  return { inletArrows, outletArrows, primaryDirection };
}

// ── Geometry Utilities ────────────────────────────────────────────────────────

function distance(a: DxfPoint, b: DxfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistance(
  pt: DxfPoint,
  a: DxfPoint,
  b: DxfPoint,
): number {
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
