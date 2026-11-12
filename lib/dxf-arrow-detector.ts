/**
 * DXF Arrow Detector (Stub)
 * 
 * SOLID entity type not yet defined in dxf-parser.ts.
 * Arrow detection disabled temporarily.
 * 
 * TODO: Add SOLID entity support to dxf-parser.ts
 */

import type {
  DxfParseResult,
  DxfPoint,
} from "@/lib/dxf-parser";

export interface ArrowEntity {
  position: DxfPoint;
  pointingAngle: number;
  direction: "RIGHT" | "UP" | "LEFT" | "DOWN" | "UNKNOWN";
  vertices: DxfPoint[];
  layer: string;
  nearestPipeDistance: number | null;
}

export interface ArrowMatch {
  arrow: ArrowEntity;
  pipeSegment: { start: DxfPoint; end: DxfPoint; layer: string };
  distance: number;
}

export interface PipeSegment {
  start: DxfPoint;
  end: DxfPoint;
  layer: string;
}

/**
 * Detect arrows from SOLID entities in DXF.
 * Currently disabled — SOLID entity type not available.
 */
export function detectDxfArrows(dxfData: DxfParseResult): ArrowEntity[] {
  // SOLID entity detection disabled
  console.log(`[arrow-detector] Arrow detection disabled (SOLID type pending)`);
  return [];
}

/**
 * Match detected arrows to pipe segments.
 */
export function matchArrowsToPipes(
  arrows: ArrowEntity[],
  pipeSegments: PipeSegment[],
  searchRadius: number = 50
): ArrowMatch[] {
  // Match disabled
  return [];
}

/**
 * Find arrows near an asset center point.
 */
export function findArrowsNearAsset(
  assetCenter: DxfPoint,
  arrowMatches: ArrowMatch[],
  searchRadius: number
): { primaryDirection: "INLET" | "OUTLET" | "UNKNOWN"; inletArrows: ArrowMatch[]; outletArrows: ArrowMatch[] } {
  return {
    primaryDirection: "UNKNOWN",
    inletArrows: [],
    outletArrows: [],
  };
}
