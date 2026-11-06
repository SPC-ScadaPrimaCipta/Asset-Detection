export interface PidTextAnchor {
  text: string;
  x: number;
  y: number;
}

export interface PidRelations {
  from: string | null;
  to: string | null;
  of: string | null;
  at: string | null;
  direction: 'INLET' | 'OUTLET' | 'UNKNOWN';
  bypass: boolean;
  isolationStatus: string | null;
  evidence: string[];
  confidence: number;
}

export interface DxfCandidateQuality {
  source: 'INSERT' | 'TEXT' | 'CIRCLE' | 'ATTRIBUTE' | 'VISION';
  assetTag: string | null;
  assetType: string | null;
  evidence: string[];
}

export type QualityGateResult = 'KEEP' | 'REVIEW' | 'DROP';

export type HybridCandidateResult = 'FINAL' | 'REVIEW_CANDIDATE' | 'DROP';

export function classifyHybridCandidate(candidate: {
  source: 'DXF' | 'VISION' | 'YOLO_GEO2';
  assetTag: string | null;
  assetType: string | null;
  confidence: number;
  evidence: string[];
}): HybridCandidateResult {
  const quality = qualityGate(candidate);
  if (quality === 'DROP') return 'DROP';
  if (candidate.source === 'VISION' || candidate.source === 'YOLO_GEO2') return 'REVIEW_CANDIDATE';
  return 'FINAL';
}

export function qualityGate(candidate: {
  source: string;
  assetTag: string | null;
  assetType: string | null;
  confidence: number;
  evidence: string[];
}): QualityGateResult {
  const evidence = candidate.evidence.join(' ');
  const synthetic = candidate.assetTag && /^(?:UNK|PV|NV|VLV)-\d+$/i.test(candidate.assetTag)
    && /auto[- ]tag|generated unique/i.test(evidence);
  if (synthetic) return 'DROP';

  // Gate 1: tagged text-only detections (no symbol evidence) → DROP
  // Evidence keywords indicating real equipment symbol presence
  const hasSymbolEvidence = /symbol|legend|equipment|insert|block|circle|shape|visual|geometry|valve|pump|vessel|tank|instrument|transmitter|actuator/i.test(evidence);
  const isContinuation = /destination label|from continuation|to continuation/i.test(evidence);
  
  if (candidate.assetTag?.trim()) {
    // Continuation labels (FROM/TO routing) = text-only references, not equipment
    if (isContinuation) return 'REVIEW';
    // Tagged but NO equipment symbol evidence → likely isolated text → DROP
    if (!hasSymbolEvidence && !isContinuation) {
      // Exception: if assetType is strong AND confidence high, may be valid small symbol
      const strongType = candidate.assetType && !/^(UNKNOWN|OTHER|EQUIPMENT)$/i.test(candidate.assetType);
      if (strongType && candidate.confidence >= 0.8) return 'REVIEW';
      return 'DROP';
    }
    return 'KEEP';
  }

  if (isContinuation) return 'REVIEW';
  if (!candidate.assetType || /^(UNKNOWN|OTHER|EQUIPMENT)$/i.test(candidate.assetType)) return 'DROP';
  if (/legend\s+(?:match|symbol)|matches selected legend|symbol matches|rule:\s*legend/i.test(evidence)) return 'REVIEW';
  if (candidate.source === 'VISION' && candidate.confidence >= 0.75) return 'REVIEW';
  return 'DROP';
}

const LABEL_RE = /^(FROM|TO|OF|AT)\s+(.+)$/i;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[;,]+$/, '').trim();
}

function near(a: PidTextAnchor, center: { x: number; y: number }): number {
  return Math.hypot(a.x - center.x, a.y - center.y);
}

export function extractPidRelations(
  anchors: PidTextAnchor[],
  center: { x: number; y: number },
  radius = 250,
): PidRelations {
  const result: PidRelations = {
    from: null,
    to: null,
    of: null,
    at: null,
    direction: 'UNKNOWN',
    bypass: false,
    isolationStatus: null,
    evidence: [],
    confidence: 0,
  };

  const nearestByKey = new Map<'from' | 'to' | 'of' | 'at', { anchor: PidTextAnchor; value: string; distance: number }>();
  for (const anchor of anchors) {
    if (!anchor.text) continue;
    const match = clean(anchor.text).match(LABEL_RE);
    if (!match) continue;
    const key = match[1].toLowerCase() as 'from' | 'to' | 'of' | 'at';
    const value = clean(match[2]);
    if (!value) continue;
    // Continuation labels may sit far from the equipment symbol. FROM/TO are
    // sheet-level route anchors; OF/AT remain local to avoid cross-asset leaks.
    const distance = near(anchor, center);
    if (distance > radius) continue;
    const previous = nearestByKey.get(key);
    if (!previous || distance < previous.distance) nearestByKey.set(key, { anchor, value, distance });
  }

  for (const [key, candidate] of nearestByKey) {
    result[key] = candidate.value;
    result.evidence.push(`${key.toUpperCase()} continuation: ${candidate.value}`);
  }

  const localText = anchors
    .filter((anchor) => near(anchor, center) <= (radius ?? Infinity))
    .map((anchor) => anchor.text)
    .join(' ');
  if (/\bINLET\b|\bINLET CONNECTION\b/i.test(localText)) {
    result.direction = 'INLET';
    result.evidence.push('Inlet symbol/label near asset');
  }
  if (/\bOUTLET\b|\bOUTLET CONNECTION\b/i.test(localText)) {
    result.direction = 'OUTLET';
    result.evidence.push('Outlet symbol/label near asset');
  }

  if (result.from) result.direction = 'INLET';
  if (result.to) result.direction = result.from ? 'OUTLET' : 'OUTLET';
  if (result.from && result.to) result.confidence = 0.95;
  else if (result.from || result.to) result.confidence = 0.8;
  else result.confidence = 0;

  result.bypass = anchors.some((a) => /\bbypass\b/i.test(a.text) && near(a, center) <= radius);
  if (result.bypass) result.evidence.push('BYPASS label near connection');
  const isolation = localText.match(/\b(LO|LC|NO|NC)\b/i);
  if (isolation) {
    result.isolationStatus = isolation[1].toUpperCase();
    result.evidence.push(`Isolation status: ${result.isolationStatus}`);
  }
  return result;
}

export function classifyDxfCandidate(candidate: DxfCandidateQuality): 'KEEP' | 'DROP' {
  const tag = candidate.assetTag?.trim();
  const type = (candidate.assetType ?? '').trim().toUpperCase();
  if (tag) return 'KEEP';
  if (candidate.source === 'VISION') return 'KEEP';
  if (candidate.source === 'INSERT' || candidate.source === 'ATTRIBUTE') return type !== 'UNKNOWN' && type !== '' ? 'KEEP' : 'DROP';
  if (candidate.evidence.some((e) => !/no legend match|unknown/i.test(e) && /legend match|symbol match|equipment symbol|continuation/i.test(e))) return 'KEEP';
  return 'DROP';
}
