import { extractPidRelations, type PidTextAnchor, type PidRelations } from '@/lib/mdo-pid-rules';
import { graphRelationEvidence, type PidGraph } from '@/lib/pid-graph';

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
}

export interface MdoRecordDraft {
  equipment: string;
  tagNoProposed: string | null;
  equipmentType: string;
  size: string | null;
  from: string | null;
  to: string | null;
  of: string | null;
  at: string | null;
  tagNumber: string | null;
  alternativeDescriptionOld: null;
  alternativeDescriptionAcn: string;
  descriptionProposed: string;
  descriptionLen: number;
  class: null;
  objectType: string;
  weight: null;
  uom: null;
  sizeDimension: string | null;
  relations: PidRelations;
  isolationStatus: string | null;
}

function upper(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

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
  const equipmentType = upper(detection.assetType);
  const size = detection.size?.trim() || null;
  const parts = [
    equipmentType,
    size ? `${size}"` : null,
    relations.of ? `OF ${relations.of}` : null,
    relations.at ? `AT ${relations.at}` : null,
    relations.from ? `FROM ${relations.from}` : null,
    relations.to ? `TO ${relations.to}` : null,
  ].filter(Boolean) as string[];
  const descriptionProposed = parts.join(' ');
  return {
    equipment: equipmentType || 'EQUIPMENT',
    tagNoProposed: detection.assetTag,
    equipmentType,
    size,
    from: relations.from,
    to: relations.to,
    of: relations.of,
    at: relations.at,
    tagNumber: detection.assetTag,
    alternativeDescriptionOld: null,
    alternativeDescriptionAcn: descriptionProposed,
    descriptionProposed,
    descriptionLen: descriptionProposed.length,
    class: null,
    objectType: equipmentType || 'EQUIPMENT',
    weight: null,
    uom: null,
    sizeDimension: size,
    relations,
    isolationStatus: relations.isolationStatus,
  };
}
