import { extractPidRelations, type PidTextAnchor } from '@/lib/mdo-pid-rules';
import { graphRelationEvidence, type PidGraph } from '@/lib/pid-graph';
import { suggestAbbreviation } from '@/lib/tag-generator';
export const suggestTagPrefix = suggestAbbreviation;
import { assembleMdoDescription } from '@/lib/mdo-description';
import type { MdoFlowRelation } from '@/lib/mdo-ai-analyzer';
import type { DxfParseResult } from '@/lib/dxf-parser';

export interface MdoDetectionInput {
  assetTag: string | null;
  assetType: string;
  description?: string | null;
  size?: string | null;
  rawPosition: { x: number; y: number };
  relationRadius?: number;
  graph?: PidGraph;
  graphTolerance?: number;
  arrowDirection?: 'INLET' | 'OUTLET' | 'UNKNOWN';
  locationPrefix?: string | null;
}

export interface PdfMdoDetectionInput {
  detection: {
    id: string;
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    size?: string | null;
    pidPage?: number;
    bboxNorm?: { x: number; y: number; width: number; height: number };
  };
  anchors: Array<{ text: string; x: number; y: number }>;
  aiRelation?: MdoFlowRelation | null;
  relationRadiusNorm?: number;
  locationPrefix?: string | null;
}

export interface DxfMdoDetectionInput {
  detection: {
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    size?: string | null;
    bbox: { x: number; y: number; width: number; height: number };
  };
  dxfData: DxfParseResult;
  allDetections: Array<{
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  anchors?: Array<{ text: string; x: number; y: number }>;
  locationPrefix?: string | null;
}

export interface MdoRecordDraft {
  tagNoProposed: string | null;
  equipmentTypeShort: string;
  equipmentName: string;
  size: string | null;
  from: string | null;
  to: string | null;
  of: string | null;
  description: string;
  locationPrefix: string | null;
  // Backwards compatibility aliases
  equipmentType: string;
  componentName: string | null;
  at: string | null;
}

function upper(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

const KNOWN_EQUIPMENT_NAMES: Record<string, string> = {
  PT: 'Pressure Transmitter',
  TT: 'Temperature Transmitter',
  FT: 'Flow Transmitter',
  LT: 'Level Transmitter',
  PI: 'Pressure Indicator',
  TI: 'Temperature Indicator',
  FI: 'Flow Indicator',
  LI: 'Level Indicator',
  PG: 'Pressure Gauge',
  TG: 'Temperature Gauge',
  LG: 'Level Gauge',
  PSV: 'Pressure Safety Valve',
  PRV: 'Pressure Relief Valve',
  SDV: 'Shutdown Valve',
  BDV: 'Blowdown Valve',
  XV: 'Actuated Valve',
  BV: 'Ball Valve',
  GV: 'Gate Valve',
  GLV: 'Globe Valve',
  CKV: 'Check Valve',
  CV: 'Control Valve',
  FV: 'Flow Control Valve',
  PV: 'Pressure Control Valve',
  LV: 'Level Control Valve',
  TV: 'Temperature Control Valve',
  P: 'Pump',
  PUMP: 'Centrifugal Pump',
  V: 'Vessel',
  VSL: 'Pressure Vessel',
  TK: 'Storage Tank',
  TANK: 'Storage Tank',
  E: 'Heat Exchanger',
  HX: 'Heat Exchanger',
  C: 'Compressor',
  K: 'Compressor',
  FL: 'Filter / Strainer',
  STR: 'Strainer',
  PIPE: 'Piping Segment',
};

/**
 * Derives Short for Equipment Type (e.g. PT, BV, CKV, PIPE)
 * and Equipment Name (e.g. Pressure Transmitter, Ball Valve).
 */
export function deriveEquipmentNaming(
  assetType: string,
  assetTag?: string | null,
  customDescription?: string | null,
): {
  shortType: string;
  equipmentName: string;
} {
  const normType = assetType?.trim() || 'EQUIPMENT';
  let shortCode = suggestTagPrefix(normType);

  // If assetTag is present and has letter prefix (e.g. "30756-PT-1020A" or "PT-1020A"),
  // check if an explicit instrument/equipment code can be extracted
  if (assetTag) {
    const tagMatch = assetTag.match(/(?:^|-)([A-Z]{1,4})(?:-|\d|$)/i);
    if (tagMatch && tagMatch[1]) {
      const code = tagMatch[1].toUpperCase();
      if (code.length >= 1 && code.length <= 4) {
        shortCode = code;
      }
    }
  }

  return {
    shortType: shortCode.toUpperCase(),
    equipmentName: normType,
  };
}

/**
 * Builds MDO Record for DXF drawings using geometric graph & text anchors.
 */
export function buildMdoRecord(
  detection: MdoDetectionInput,
  anchors: PidTextAnchor[],
): MdoRecordDraft {
  const relations = extractPidRelations(anchors, detection.rawPosition, detection.relationRadius);
  if (detection.graph) {
    relations.evidence.push(...graphRelationEvidence(detection.graph, detection.rawPosition, detection.graphTolerance ?? 100));
    if (relations.evidence.some((item) => item.startsWith('Connected piping graph node'))) {
      relations.confidence = Math.min(0.99, relations.confidence + 0.05);
    }
  }
  if (detection.arrowDirection && detection.arrowDirection !== 'UNKNOWN') {
    relations.direction = detection.arrowDirection;
    relations.confidence = Math.min(0.99, Math.max(relations.confidence, 0.85));
    relations.evidence.push(`Flow arrow geometry: ${detection.arrowDirection}`);
  }

  const { shortType, equipmentName } = deriveEquipmentNaming(
    detection.assetType,
    detection.assetTag,
    detection.description,
  );
  const size = detection.size?.trim() || null;
  const locationPrefix = detection.locationPrefix ?? null;

  const description = assembleMdoDescription({
    locationPrefix,
    equipmentTypeShort: shortType,
    size,
    ofValue: relations.of,
    fromValue: relations.from,
    toValue: relations.to,
    atValue: relations.at,
  });

  return {
    tagNoProposed: detection.assetTag,
    equipmentTypeShort: shortType,
    equipmentName,
    size,
    from: relations.from,
    to: relations.to,
    of: relations.of,
    description,
    locationPrefix,
    equipmentType: upper(detection.assetType),
    componentName: detection.description?.trim() || null,
    at: relations.at,
  };
}

/**
 * Builds MDO Record for PDF drawings fusing Vision AI relations with spatial text anchors.
 */
export function buildPdfMdoRecord(input: PdfMdoDetectionInput): MdoRecordDraft {
  const { detection, anchors, aiRelation, relationRadiusNorm = 250, locationPrefix = null } = input;
  const rawCenter = {
    x: detection.bboxNorm?.x ?? 500,
    y: detection.bboxNorm?.y ?? 500,
  };

  // 1. Spatial text token fallback
  const spatialRelations = extractPidRelations(anchors, rawCenter, relationRadiusNorm);

  // 2. Fusion: AI relation takes precedence when available, spatial fills gaps
  const from = aiRelation?.from ?? spatialRelations.from ?? null;
  const to = aiRelation?.to ?? spatialRelations.to ?? null;
  let of = aiRelation?.of ?? spatialRelations.of ?? null;
  const at = aiRelation?.at ?? spatialRelations.at ?? null;
  const size = detection.size?.trim() || aiRelation?.size?.trim() || null;

  // Fallback: If 'of' is still null but detection description mentions a service or line (e.g. "HEADER LINE")
  if (!of && detection.description && detection.description.trim().length > 0) {
    const desc = detection.description.trim();
    if (desc.toUpperCase().includes('LINE') || desc.toUpperCase().includes('HEADER') || desc.toUpperCase().includes('SYSTEM')) {
      of = desc;
    }
  }

  const { shortType, equipmentName } = deriveEquipmentNaming(
    detection.assetType,
    detection.assetTag,
    detection.description,
  );

  const description = assembleMdoDescription({
    locationPrefix,
    equipmentTypeShort: shortType,
    size,
    ofValue: of,
    fromValue: from,
    toValue: to,
    atValue: at,
  });

  return {
    tagNoProposed: detection.assetTag,
    equipmentTypeShort: shortType,
    equipmentName,
    size,
    from,
    to,
    of,
    description,
    locationPrefix,
    equipmentType: upper(detection.assetType),
    componentName: detection.description?.trim() || null,
    at,
  };
}

export interface DxfMdoDetectionInput {
  detection: {
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    size?: string | null;
    bbox: { x: number; y: number; width: number; height: number };
  };
  dxfData: DxfParseResult;
  allDetections: Array<{
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  anchors?: PidTextAnchor[];
  locationPrefix?: string | null;
}

/**
 * Builds MDO Record for DXF drawings using vector flow analysis.
 * Traces pipe connections directly from DXF geometry (LINE, POLYLINE, ARC).
 * Much more accurate than PDF pixel tracing.
 */
export async function buildDxfMdoRecordWithFlowAnalysis(input: DxfMdoDetectionInput): Promise<MdoRecordDraft> {
  const { detection, dxfData, allDetections, anchors = [], locationPrefix = null } = input;

  // 1. Run DXF flow analysis
  const { analyzeDxfProcessFlow } = await import('@/lib/mdo-dxf-analyzer');
  const flowMap = await analyzeDxfProcessFlow(dxfData, allDetections);

  const detectionTag = detection.assetTag?.trim().toUpperCase();
  const flowRelation = detectionTag ? flowMap.get(detectionTag) : null;

  // 2. Spatial text anchor fallback (if no flow relation or missing fields)
  const rawCenter = {
    x: detection.bbox.x + detection.bbox.width / 2,
    y: detection.bbox.y + detection.bbox.height / 2,
  };
  const spatialRelations = anchors.length > 0
    ? extractPidRelations(anchors, rawCenter, 250)
    : { from: null, to: null, of: null, at: null, confidence: 0.5, evidence: [] };

  // 3. Fusion: DXF flow takes precedence, spatial text fills gaps
  const from = flowRelation?.from ?? spatialRelations.from ?? null;
  const to = flowRelation?.to ?? spatialRelations.to ?? null;
  let of = flowRelation?.of ?? spatialRelations.of ?? null;
  const at = flowRelation?.at ?? spatialRelations.at ?? null;
  const size = detection.size?.trim() || flowRelation?.size?.trim() || null;

  // Fallback: check description for OF clues
  if (!of && detection.description && detection.description.trim().length > 0) {
    const desc = detection.description.trim();
    if (desc.toUpperCase().includes('LINE') || desc.toUpperCase().includes('HEADER') || desc.toUpperCase().includes('SYSTEM')) {
      of = desc;
    }
  }

  const { shortType, equipmentName } = deriveEquipmentNaming(
    detection.assetType,
    detection.assetTag,
    detection.description,
  );

  const description = assembleMdoDescription({
    locationPrefix,
    equipmentTypeShort: shortType,
    size,
    ofValue: of,
    fromValue: from,
    toValue: to,
    atValue: at,
  });

  return {
    tagNoProposed: detection.assetTag,
    equipmentTypeShort: shortType,
    equipmentName,
    size,
    from,
    to,
    of,
    description,
    locationPrefix,
    equipmentType: upper(detection.assetType),
    componentName: detection.description?.trim() || null,
    at,
  };
}
