/**
 * Detection V2 — HTTP client for the Python CV sidecar (services/cv).
 *
 * Topology: Node stays primary; Python only does deterministic CV
 * (OpenCV/OCR/geometry/template matching) behind a clean API.
 * Dev runs Windows-native (`python services/cv/app.py`); Docker optional.
 *
 * Resilience: if the service is unreachable, callers MUST degrade
 * (fallback to existing mupdf text / deterministic path) — never throw
 * a page into FAILED solely because CV is down.
 */
import { detectionConfig } from '@/lib/detection/config';
import type {
  CvCandidatesResponse,
  CvCandidate,
  CvTileMeta,
} from '@/lib/detection/candidates/schema';

export interface CvHealth {
  status: string;
  version: string;
}

export interface CvPreprocessResult {
  pageWidth: number;
  pageHeight: number;
  layers: Record<string, { width: number; height: number }>;
  pipelineVersion: string;
}

async function post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T | null> {
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
    return null; // service down → caller degrades, never throws
  } finally {
    clearTimeout(timer);
  }
}

export async function cvHealth(timeoutMs = 5_000): Promise<CvHealth | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${detectionConfig.cvServiceUrl}/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as CvHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Debug helper (Fase 1): verify derived-layer pipeline on a page PNG. */
export async function cvPreprocess(pngBase64: string): Promise<CvPreprocessResult | null> {
  return post<CvPreprocessResult>('/preprocess', { pngBase64 });
}

export interface CvCandidatesRequest {
  pngBase64: string;
  pageNumber: number;
  /** Tile metadata from renderPageTiles — bbox stays tile-local on the wire. */
  tile?: Partial<CvTileMeta> | null;
  preprocess?: { variant?: string; denoise?: boolean };
  detector?: { min_area?: number; max_area_ratio?: number };
  ocrProvider?: string;
  tagPatterns?: { id: string; regex: string }[];
  /** Phase 9.1 glyph suppression (default ON in service; null/false disables). */
  mask?: Record<string, number> | null | false;
  lineSplit?: boolean;
  reunion?: boolean;
}

/**
 * Full deterministic candidate pass over one image (page or tile).
 * Returns null when the service is unreachable — caller degrades, never throws.
 */
export async function cvCandidates(
  req: CvCandidatesRequest,
  timeoutMs = 120_000
): Promise<CvCandidatesResponse | null> {
  return post<CvCandidatesResponse>('/candidates', req, timeoutMs);
}

export interface CvOcrText {
  text: string;
  bbox: CvCandidate['bbox'];
  confidence: number;
  rotation: number;
}

/** OCR probe over one image. Null when service is down or provider missing. */
export async function cvOcr(
  pngBase64: string,
  ocrProvider = 'mock',
  timeoutMs = 60_000
): Promise<{ texts: CvOcrText[]; provider: string } | null> {
  return post('/ocr', { pngBase64, ocrProvider }, timeoutMs);
}
