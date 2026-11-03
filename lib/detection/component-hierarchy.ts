/**
 * Nested Component Hierarchy for Complex P&ID Symbols
 *
 * Problem: Complex P&ID symbols consist of nested sub-components:
 *   - A Control Valve (FCV) has: valve body + actuator + positioner
 *   - An instrumented valve has: valve + circle (instrument bubble)
 *   - A pump with instruments has: pump symbol + 2-4 instrument circles
 *
 * Current behavior: YOLO + Gemini detect these as separate overlapping
 * detections. Without hierarchy, NMS incorrectly suppresses the smaller
 * sub-components because they overlap heavily with the parent symbol.
 *
 * This module:
 *   1. Identifies parent-child relationships between detections
 *   2. Prevents NMS from suppressing legitimate child components
 *   3. Assigns proper hierarchy metadata for the Asset Register
 *   4. Handles the common case of instrument circles nested inside equipment symbols
 *
 * Hierarchy rules are based on ISA 5.1 conventions:
 *   - Instruments (FT, PT, LT, TT, AT, etc.) are often nested inside equipment
 *   - Small symbols (< 40% of parent area) inside larger symbols are children
 *   - Children inherit the parent's asset tag prefix for identification
 */

// ΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export interface HierarchyBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HierarchyDetection {
  id: string;
  assetTag: string | null;
  assetType: string | null;
  confidence: number;
  bbox: HierarchyBBox;
  page: number;
  source: string;
  evidence: string[];
  legendSymbolId?: string | null;
  /** Populated after buildHierarchy() */
  parentId?: string | null;
  /** Populated after buildHierarchy() */
  children?: string[];
  /** Populated after buildHierarchy() */
  hierarchyLevel?: number;
}

export interface HierarchyNode {
  detection: HierarchyDetection;
  children: HierarchyNode[];
  parent: HierarchyNode | null;
  level: number;
}

export interface HierarchyResult {
  /** Root nodes (parent-less detections) */
  roots: HierarchyNode[];
  /** All nodes flat, with parent/children populated */
  allNodes: HierarchyNode[];
  /** Flat list of all detections with hierarchy metadata filled in */
  detections: HierarchyDetection[];
}

export interface HierarchyConfig {
  /**
   * Containment ratio required to be a child (default 0.6).
   * Child must have 60%+ of its area inside the parent.
   */
  containmentThreshold: number;
  /**
   * Max area ratio child/parent (default 0.5).
   * Child must be at most 50% the area of parent to be considered nested.
   * Prevents two similar-sized overlapping detections from creating bogus hierarchy.
   */
  maxChildAreaRatio: number;
  /**
   * Min confidence for parent candidates (default 0.3).
   * Prevents low-confidence ghost detections from claiming children.
   */
  minParentConfidence: number;
}

export const DEFAULT_HIERARCHY_CONFIG: HierarchyConfig = {
  containmentThreshold: 0.6,
  maxChildAreaRatio: 0.5,
  minParentConfidence: 0.3,
};

// ΓöÇΓöÇ ISA 5.1 asset type classification ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Asset types that are typically parent containers in P&ID hierarchy.
 * These are larger physical equipment that instruments are mounted on.
 */
const PARENT_ASSET_TYPES = new Set([
  'pump', 'compressor', 'turbine', 'motor', 'fan', 'blower',
  'heat exchanger', 'condenser', 'reboiler', 'cooler',
  'vessel', 'drum', 'tank', 'column', 'reactor', 'separator',
  'furnace', 'heater', 'boiler',
  'filter', 'strainer', 'coalescer',
  'valve', 'control valve', 'gate valve', 'ball valve',
  'butterfly valve', 'check valve', 'needle valve', 'globe valve',
  'relief valve', 'pressure safety valve', 'psv',
  'flow element', 'orifice plate', 'flow meter',
]);

/**
 * Asset types that are typically child/sub-components mounted on equipment.
 * Mostly ISA instruments and actuators.
 */
const CHILD_ASSET_TYPES = new Set([
  // Instruments
  'instrument', 'indicator', 'transmitter', 'controller', 'recorder',
  'ft', 'pt', 'lt', 'tt', 'at', 'wt',
  'fi', 'pi', 'li', 'ti', 'ai',
  'fic', 'pic', 'lic', 'tic',
  'fq', 'pq', 'lq',
  'fsl', 'psl', 'lsl', 'tsl',
  'fsh', 'psh', 'lsh', 'tsh',
  'fsll', 'psll', 'lsll', 'tsll',
  'fshh', 'pshh', 'lshh', 'tshh',
  // Actuators
  'actuator', 'solenoid', 'motor operator', 'handwheel',
  'positioner', 'i/p converter',
  // Small devices
  'thermowell', 'sight glass', 'rotameter', 'sample point',
]);

/**
 * ISA tag prefix patterns that indicate instrument types (child components).
 * These 1-4 letter prefixes per ISA 5.1 measurement type codes.
 */
const INSTRUMENT_PREFIX_PATTERN = /^(F|P|L|T|A|W|X|Y|Z|FI|PI|LI|TI|AI|FT|PT|LT|TT|AT|FIC|PIC|LIC|TIC|FCV|PCV|LCV|TCV|XCV|XV|LV|FV|MOV|SDV|BDV|PSV|PRV|TSV|LSV|FSV|FICAHL|LSLL|LSHH|PSLL|PSHH|FSLL|FSHH)/i;

function isInstrumentType(assetType: string | null): boolean {
  if (!assetType) return false;
  const t = assetType.toLowerCase().trim();
  return CHILD_ASSET_TYPES.has(t) ||
    Array.from(CHILD_ASSET_TYPES).some((c) => t.includes(c));
}

function isEquipmentType(assetType: string | null): boolean {
  if (!assetType) return false;
  const t = assetType.toLowerCase().trim();
  return PARENT_ASSET_TYPES.has(t) ||
    Array.from(PARENT_ASSET_TYPES).some((p) => t.includes(p));
}

function isInstrumentTag(tag: string | null): boolean {
  if (!tag) return false;
  const prefix = tag.split('-')[0].toUpperCase();
  return INSTRUMENT_PREFIX_PATTERN.test(prefix);
}

// ΓöÇΓöÇ Geometry helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function computeContainmentHierarchy(
  inner: HierarchyBBox,
  outer: HierarchyBBox,
): number {
  const ix0 = Math.max(inner.x, outer.x);
  const iy0 = Math.max(inner.y, outer.y);
  const ix1 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const iy1 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const innerArea = inner.width * inner.height;
  if (innerArea <= 0) return 0;
  return (iw * ih) / innerArea;
}

function bboxArea(bbox: HierarchyBBox): number {
  return bbox.width * bbox.height;
}

// ΓöÇΓöÇ Main: build hierarchy ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build a parent-child hierarchy from a flat list of detections.
 *
 * Algorithm:
 *   1. Sort detections by area descending (largest = most likely parent)
 *   2. For each detection, check all smaller detections:
 *      - If smaller is ΓëÑ60% contained in larger ΓåÆ candidate child
 *      - If child/parent area ratio < 0.5 ΓåÆ accept as child
 *      - Type heuristic: instrument types ΓåÆ prefer to be children of equipment
 *   3. Assign each detection to its best (most specific) parent
 *   4. Return tree structure
 */
export function buildComponentHierarchy(
  detections: HierarchyDetection[],
  config: Partial<HierarchyConfig> = {},
): HierarchyResult {
  const cfg: HierarchyConfig = { ...DEFAULT_HIERARCHY_CONFIG, ...config };

  // Sort by area descending (parents are larger)
  const sorted = [...detections].sort(
    (a, b) => bboxArea(b.bbox) - bboxArea(a.bbox),
  );

  const nodeMap = new Map<string, HierarchyNode>();

  // Create nodes
  for (const d of sorted) {
    nodeMap.set(d.id, {
      detection: { ...d, parentId: null, children: [], hierarchyLevel: 0 },
      children: [],
      parent: null,
      level: 0,
    });
  }

  // Assign parents
  for (let i = 0; i < sorted.length; i++) {
    const child = sorted[i];
    const childNode = nodeMap.get(child.id)!;

    // Already has a parent assigned
    if (childNode.parent !== null) continue;

    // Never merge across pages
    let bestParent: HierarchyNode | null = null;
    let bestParentArea = Infinity;

    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue;
      const parent = sorted[j];
      if (parent.page !== child.page) continue;

      const parentNode = nodeMap.get(parent.id)!;
      const parentArea = bboxArea(parent.bbox);
      const childArea = bboxArea(child.bbox);

      // Parent must be larger than child
      if (parentArea <= childArea) continue;

      // Parent must have minimum confidence
      if (parent.confidence < cfg.minParentConfidence) continue;

      // Child must be sufficiently contained in parent
      const containment = computeContainmentHierarchy(child.bbox, parent.bbox);
      if (containment < cfg.containmentThreshold) continue;

      // Child area must be small relative to parent
      const areaRatio = childArea / parentArea;
      if (areaRatio > cfg.maxChildAreaRatio) continue;

      // Type-aware heuristic: instrument types prefer equipment parents
      const childIsInstrument = isInstrumentType(child.assetType) || isInstrumentTag(child.assetTag);
      const parentIsEquipment = isEquipmentType(parent.assetType);

      // Avoid creating hierarchy between two instruments (both children of another parent)
      if (childIsInstrument && isInstrumentType(parent.assetType)) {
        // Allow only if containment is very high (>0.85) ΓÇö prevents instrument bubbles
        // from claiming other small instruments as children
        if (containment < 0.85) continue;
      }

      // Prefer the smallest valid parent (most specific ancestor)
      if (parentArea < bestParentArea) {
        bestParent = parentNode;
        bestParentArea = parentArea;
      }
    }

    if (bestParent !== null) {
      childNode.parent = bestParent;
      childNode.level = bestParent.level + 1;
      childNode.detection.parentId = bestParent.detection.id;
      childNode.detection.hierarchyLevel = childNode.level;
      bestParent.children.push(childNode);
      if (!bestParent.detection.children) bestParent.detection.children = [];
      bestParent.detection.children.push(child.id);
    }
  }

  // Collect roots (no parent)
  const roots: HierarchyNode[] = [];
  const allNodes: HierarchyNode[] = [];

  for (const node of nodeMap.values()) {
    allNodes.push(node);
    if (node.parent === null) roots.push(node);
  }

  const detectionResult: HierarchyDetection[] = allNodes.map((n) => n.detection);

  return { roots, allNodes, detections: detectionResult };
}

/**
 * Flatten the hierarchy into a list of NMS-aware groups.
 * Returns {parent, children[]} groups for use in NMS pipeline.
 *
 * NMS should NOT suppress:
 *   - Children in a parent-child relationship (different symbols)
 *   - Siblings (two children of the same parent)
 *
 * NMS SHOULD suppress:
 *   - Two detections at the same hierarchy level with high IoU (duplicates)
 */
export interface HierarchyGroup {
  parentId: string | null;
  memberIds: string[];
}

export function getHierarchyGroups(result: HierarchyResult): HierarchyGroup[] {
  const groups: HierarchyGroup[] = [];

  function processNode(node: HierarchyNode): void {
    if (node.children.length > 0) {
      groups.push({
        parentId: node.detection.id,
        memberIds: node.children.map((c) => c.detection.id),
      });
      for (const child of node.children) {
        processNode(child);
      }
    }
  }

  for (const root of result.roots) {
    processNode(root);
  }

  return groups;
}

/**
 * Get the set of (childId, parentId) pairs that should be exempted from NMS suppression.
 * Two detections in this set should NOT be merged by NMS even if their IoU is high.
 */
export function getHierarchyExemptions(
  result: HierarchyResult,
): Set<string> {
  // Key format: "id1:id2" where id1 < id2 lexicographically
  const exemptions = new Set<string>();

  for (const node of result.allNodes) {
    if (!node.parent) continue;
    const parentId = node.parent.detection.id;
    const childId = node.detection.id;
    const key =
      parentId < childId ? `${parentId}:${childId}` : `${childId}:${parentId}`;
    exemptions.add(key);
  }

  return exemptions;
}

/**
 * Apply NMS with hierarchy awareness.
 * Prevents NMS from suppressing parent-child pairs.
 *
 * Usage: Call buildComponentHierarchy first, then pass exemptions to this function.
 */
export function applyHierarchyAwareNms<
  T extends {
    id: string;
    confidence: number;
    bbox: HierarchyBBox;
    page: number;
  },
>(
  detections: T[],
  hierarchyExemptions: Set<string>,
  iouThreshold = 0.4,
): T[] {
  if (detections.length === 0) return [];

  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const result: T[] = [];
  const suppressed = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const winner = sorted[i];
    if (suppressed.has(winner.id)) continue;

    result.push(winner);

    for (let j = i + 1; j < sorted.length; j++) {
      const candidate = sorted[j];
      if (suppressed.has(candidate.id)) continue;
      if (winner.page !== candidate.page) continue;

      // Check hierarchy exemption
      const key =
        winner.id < candidate.id
          ? `${winner.id}:${candidate.id}`
          : `${candidate.id}:${winner.id}`;
      if (hierarchyExemptions.has(key)) continue;

      // Standard NMS: suppress by IoU
      const iou = computeIouForHierarchy(winner.bbox, candidate.bbox);
      if (iou >= iouThreshold) {
        suppressed.add(candidate.id);
      }
    }
  }

  return result;
}

function computeIouForHierarchy(a: HierarchyBBox, b: HierarchyBBox): number {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.width, b.x + b.width);
  const iy1 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
