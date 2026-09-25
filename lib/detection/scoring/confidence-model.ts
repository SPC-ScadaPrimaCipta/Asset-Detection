/**
 * Detection V2 — confidence contract (TypeScript mirror).
 *
 * Python source: services/cv/confidence_engine.py. Single implementation
 * lives in Python; TS consumes the auditable output. decisionBand is
 * ROUTING (HIGH → continue, REVIEW/LOW → Phase 7 verification / human
 * review) — never a final asset decision.
 */
export type DecisionBand = 'HIGH' | 'REVIEW' | 'LOW';

export interface ConfidenceEvidence {
  geometryScore: number | null;
  contourScore: number | null;
  templateScore: number | null;
  edgeScore: number | null;
  scaleScore: number | null;
  rotationScore: number | null;
  legendMatchScore: number | null;
  legendMargin: number | null;
  tagRecognitionScore: number | null;
  spatialAssociationScore: number | null;
  spatialMargin: number | null;
  ambiguityPenalty: number;
  missingEvidencePenalty: number;
  unavailable: string[];
}

export interface ConfidenceOutput {
  candidateId: string;
  confidence: number;
  decisionBand: DecisionBand;
  topMatch: { symbolId?: string; label?: string };
  margin: number;
  evidence: ConfidenceEvidence;
  reasons: string[];
  warnings: string[];
  configVersion: string;
  timings?: { name: string; ms: number }[];
  pipelineVersion?: string;
}

export interface ConfidenceSignals {
  geometryScore?: number | null;
  contourScore?: number | null;
  templateScore?: number | null;
  edgeScore?: number | null;
  scaleScore?: number | null;
  rotationScore?: number | null;
}

export interface ConfidenceRequest {
  candidateId: string;
  signals: ConfidenceSignals;
  legendMatches?: { legendSymbolId?: string; label?: string; score: number }[];
  spatialRanked?: { symbolId: string; score: number }[];
  /** null/undefined = OCR unavailable (NOT zero). */
  ocr?: { isTag: boolean; confidence: number } | null;
  config?: Record<string, number>;
}
