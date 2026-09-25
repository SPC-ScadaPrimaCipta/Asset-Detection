/**
 * Detection V2 — CanonicalVisionObject (Stage 1: TYPE-ONLY adapter).
 *
 * Both Legend and Detection ALREADY speak the same visual language produced
 * by services/cv/template_extract.py:
 *   { bbox, 128px normalized crop, huMoments[7], edgeDensity, lineCount, aspectRatio }
 * Legend variants carry it (`LegendTemplateVariant`); detection queries build
 * it per candidate (`match_repair.candidate_query`, `/legend/match` endpoint).
 *
 * This module adds NO feature extraction and NO OpenCV. It only names the
 * shared shape in TypeScript and provides pure converters, so Legend and
 * Detection can exchange evidence without format drift.
 *
 * Domain lock (enforced by types + tests, not comments):
 * - Asset Type  ← Legend Description (label/symbol_name). Never derived here.
 * - Asset Tag   ← P&ID OCR. This adapter neither creates nor mutates tags.
 */
import type { PageBox } from '@/lib/detection/geometry/coordinate-transform';
import type { LegendTemplateVariant } from '@/lib/detection/legend/legend-model';

export const CANONICAL_NORM_SIZE = 128;
export const CANONICAL_HU_COUNT = 7;

export interface CanonicalVisionSource {
  kind: 'legend' | 'detection';
  legendId?: string;
  symbolId?: string;
  candidateId?: string;
  pageNumber?: number;
}

export interface CanonicalVisionObject {
  bbox: PageBox;
  normSize: number;
  huMoments: number[];
  edgeDensity: number;
  lineCount: number;
  aspectRatio: number;
  source?: CanonicalVisionSource;
  /** Opaque provenance strings passed through untouched. */
  provenance: string[];
}

/** Legend variant → canonical object. Label/Asset Type deliberately absent. */
export function fromLegendVariant(
  variant: Pick<
    LegendTemplateVariant,
    'bbox' | 'huMoments' | 'edgeDensity' | 'lineCount' | 'aspectRatio'
  >,
  source?: CanonicalVisionSource,
  provenance: string[] = []
): CanonicalVisionObject {
  return {
    bbox: { ...variant.bbox },
    normSize: CANONICAL_NORM_SIZE,
    huMoments: [...variant.huMoments],
    edgeDensity: variant.edgeDensity,
    lineCount: variant.lineCount,
    aspectRatio: variant.aspectRatio,
    ...(source ? { source: { ...source } } : {}),
    provenance: [...provenance],
  };
}

export interface DetectionQueryLike {
  bbox?: PageBox;
  huMoments: number[];
  edgeDensity: number;
  lineCount: number;
  aspectRatio: number;
}

/** Detection query features → canonical object. No tag in, no tag out. */
export function fromDetectionQuery(
  query: DetectionQueryLike,
  source?: CanonicalVisionSource,
  provenance: string[] = []
): CanonicalVisionObject {
  return {
    bbox: { ...(query.bbox ?? { x: 0, y: 0, width: 0, height: 0 }) },
    normSize: CANONICAL_NORM_SIZE,
    huMoments: [...query.huMoments],
    edgeDensity: query.edgeDensity,
    lineCount: query.lineCount,
    aspectRatio: query.aspectRatio,
    ...(source ? { source: { ...source } } : {}),
    provenance: [...provenance],
  };
}

/** Structural compatibility check (same feature language, no scoring). */
export function isCompatibleShape(obj: unknown): obj is CanonicalVisionObject {
  if (!obj || typeof obj !== 'object') return false;
  const v = obj as Record<string, unknown>;
  return (
    typeof v.edgeDensity === 'number' &&
    typeof v.lineCount === 'number' &&
    typeof v.aspectRatio === 'number' &&
    Array.isArray(v.huMoments) &&
    (v.huMoments as unknown[]).length === CANONICAL_HU_COUNT &&
    typeof v.normSize === 'number'
  );
}
