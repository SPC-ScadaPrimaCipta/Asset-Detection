/**
 * Detection V2 — candidate output contract (TypeScript mirror).
 *
 * Python source: services/cv/schemas.py. Field names are IDENTICAL
 * (snake_case on neither side — both use the JSON keys below).
 * Version truth: detectionConfig.pipelineVersion (Phase 1).
 *
 * Wire rule: candidate `bbox` from the CV service is TILE-LOCAL pixels.
 * Map to canonical page pixels via tileToPage (coordinate-transform.ts) —
 * never persist tile-local coords. Never duplicate the formulas here.
 */
import type { PageBox } from '@/lib/detection/geometry/coordinate-transform';

export interface CvTileMeta {
  pageNumber: number;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  pageWidth: number;
  pageHeight: number;
  sourceDpi: number;
  overlap: number;
  tileIndex: number;
}

export interface CvCandidateGeometry {
  area: number;
  aspectRatio: number;
  centerX: number;
  centerY: number;
  perimeter: number;
  circularity: number;
  convexity: number;
}

export interface CvCandidateEvidence {
  contourArea: number;
  connectedComponentArea: number;
  lineCount: number;
  textProximity?: number | null;
  sourceTiles: number[];
  notes: string[];
}

export interface CvOcrQuality {
  charCount: number;
  confidence: number;
  tagPatternMatch: boolean;
  alphanumericRatio: number;
  normalizationDistance: number;
  bboxArea: number;
  aspectRatio: number;
  rotation: number;
}

export interface CvOcrResult {
  text: string;
  bbox: PageBox;
  confidence: number;
  rotation: number;
  provider: string;
  /** Phase 4 (additive): auditable normalization. */
  rawText?: string;
  normalizedText?: string;
  transformations?: string[];
  quality?: CvOcrQuality | null;
}

export interface CvTagParse {
  raw: string;
  normalized: string;
  isTag: boolean;
  prefix?: string | null;
  number?: string | null;
  suffix?: string | null;
  patternId?: string | null;
}

export type CvCandidateType = 'visual' | 'text' | 'merged';

/** As received from the CV service — bbox is TILE-LOCAL pixels. */
export interface CvCandidate {
  candidateId: string;
  pageNumber: number;
  tileId?: number | null;
  bbox: PageBox;
  candidateType: CvCandidateType;
  geometry?: CvCandidateGeometry;
  evidence?: CvCandidateEvidence;
  ocr?: CvOcrResult | null;
  tag?: CvTagParse | null;
  source: string;
  provenance: string[];
  pipelineVersion: string;
  groundTruthId?: string | null;
  matchStatus?: string | null;
}

export interface CvStageTiming {
  name: string;
  ms: number;
  detail?: Record<string, unknown>;
}

export interface CvCandidatesResponse {
  candidates: CvCandidate[];
  tile: CvTileMeta;
  timings: CvStageTiming[];
  pipelineVersion: string;
  warnings: string[];
  suppressed?: { candidateId: string; reason: string }[];
  associations?: { textId: string; ranked: unknown[] }[];
  stageCounts?: {
    visual: number;
    ocr: number;
    masked: number;
    splitFragments: number;
    reunited: number;
  };
}

/** Page-space candidate after tileToPage + validateBox. Canonical pixels. */
export interface PageCandidate extends Omit<CvCandidate, 'bbox'> {
  bbox: PageBox;
  pageWidth: number;
  pageHeight: number;
}
