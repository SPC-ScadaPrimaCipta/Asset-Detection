/**
 * Detection V2 — Legend client (Node → Python CV service).
 *
 * Respects the selected legend: every request carries selectedLegendId and
 * every match retains that provenance. No legend selected → caller skips
 * matching entirely (matching unavailable, detection continues) — the
 * service never invents a legend, and empty definitions yield an explicit
 * LEGEND_UNAVAILABLE warning, not an error.
 *
 * Degrades gracefully (null) when the service is unreachable — same
 * contract as cv-client.ts.
 */
import { detectionConfig } from '@/lib/detection/config';
import type {
  LegendDefinition,
  LegendMatchResult,
  LegendMatchThresholds,
  MatchInstrumentation,
} from '@/lib/detection/legend/legend-model';

async function post<T>(path: string, body: unknown, timeoutMs = 120_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${detectionConfig.cvServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface LegendPageInput {
  pageNumber: number;
  pngBase64: string;
}

export interface LegendExtractResponse {
  legendId: string;
  definitions: LegendDefinition[];
  debug: unknown[];
  timings: { name: string; ms: number }[];
  warnings: string[];
  pipelineVersion: string;
  extractorVersion: string;
  legendCache?: { hits: number; misses: number; hitRate: number; size: number };
}

export async function cvLegendExtract(
  legendId: string,
  pages: LegendPageInput[],
  opts: {
    pdfSha256?: string;
    renderDpi?: number;
    ocrProvider?: string;
    minAssocScore?: number;
  } = {},
  timeoutMs = 180_000
): Promise<LegendExtractResponse | null> {
  if (!legendId || pages.length === 0) return null;
  return post<LegendExtractResponse>('/legend/extract', {
    legendId,
    pages,
    pdfSha256: opts.pdfSha256 ?? '',
    renderDpi: opts.renderDpi ?? 288,
    ocrProvider: opts.ocrProvider ?? 'mock',
    minAssocScore: opts.minAssocScore ?? 0.25,
  }, timeoutMs);
}

export interface LegendMatchQuery {
  id: string;
  /** Page-space bbox (canonical pixels). */
  bbox: { x: number; y: number; width: number; height: number };
}

export interface LegendMatchResponse {
  selectedLegendId: string;
  results: LegendMatchResult[];
  instrumentation: MatchInstrumentation;
  timings: { name: string; ms: number }[];
  pipelineVersion: string;
}

export async function cvLegendMatch(
  selectedLegendId: string,
  pngBase64: string,
  pageNumber: number,
  candidates: LegendMatchQuery[],
  definitions: LegendDefinition[],
  thresholds?: Partial<LegendMatchThresholds>,
  opts: { refine?: boolean; repair?: Record<string, number | boolean> | null } = {},
  timeoutMs = 180_000
): Promise<LegendMatchResponse | null> {
  // No legend selected → matching unavailable (caller continues without it).
  if (!selectedLegendId || candidates.length === 0) return null;
  return post<LegendMatchResponse>('/legend/match', {
    selectedLegendId,
    pngBase64,
    pageNumber,
    candidates,
    definitions,
    config: {
      min_geometry: thresholds?.minGeometry,
      min_contour: thresholds?.minContour,
      min_template: thresholds?.minTemplate,
      max_candidates: thresholds?.maxCandidates,
    },
    // Phase 10 recommended defaults: refine ON (guarded), repair ON (auditable).
    refine: opts.refine ?? true,
    repair: opts.repair ?? {},
  }, timeoutMs);
}

export interface LegendCropInput {
  symbolId: string;
  label: string;
  aliases?: string[];
  category?: string;
  rotationInvariant?: boolean;
  sourcePage?: number;
  cropPngBase64: string;
}

export interface LegendDefsResponse {
  legendId: string;
  definitions: LegendDefinition[];
  timings: { name: string; ms: number }[];
  pipelineVersion: string;
}

/** Preferred source: human-reviewed DB reference crops (labels approved). */
export async function cvLegendDefsFromCrops(
  legendId: string,
  symbols: LegendCropInput[],
  timeoutMs = 180_000
): Promise<LegendDefsResponse | null> {
  if (!legendId || symbols.length === 0) return null;
  return post<LegendDefsResponse>('/legend/defs-from-crops', { legendId, symbols }, timeoutMs);
}

export interface LabelMatchResponse {
  match: boolean;
  kind: string;
  score: number;
  reasons: string[];
  pipelineVersion: string;
}

export async function cvLabelMatch(
  query: string,
  definition: Pick<LegendDefinition, 'label' | 'aliases'>,
  timeoutMs = 30_000
): Promise<LabelMatchResponse | null> {
  if (!query || !definition) return null;
  return post<LabelMatchResponse>('/legend/label-match', { query, definition }, timeoutMs);
}
