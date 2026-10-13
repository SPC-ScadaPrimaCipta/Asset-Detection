/**
 * CV Service Client
 *
 * HTTP client to the Python FastAPI CV service (YOLO, OCR, OpenCV).
 * Service URL: CV_SERVICE_URL env var (default http://localhost:8765).
 *
 * Graceful degradation: if the service is unavailable, functions throw with
 * a [cv-client] prefix so callers can catch and fall back to Node-side logic.
 */

export interface CvBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CvDetection {
  class_id: number;
  label: string;
  score: number;
  bbox: CvBBox; // pixel coords in original page space
}

export interface CvDetectResult {
  detections: CvDetection[];
  duration_ms: number;
}

export interface CvOcrResult {
  text: string;
  confidence: number; // 0-1
  engine_used: string;
}

export interface CvTemplateMatch {
  score: number;
  bbox: CvBBox;
}

export interface CvTemplateMatchResult {
  matches: CvTemplateMatch[];
  duration_ms: number;
}

export interface CvBBoxRefineResult {
  refined_bbox: CvBBox;
  confidence: number;
  method: string;
}

export interface CvHealth {
  status: string;
  engines: {
    yolo: boolean;
    ocr_tesseract: boolean;
    ocr_easyocr: boolean;
    opencv: boolean;
  };
  model_path: string | null;
}

// ── Circuit breaker state ──────────────────────────────────────────────────
let _consecutiveFailures = 0;
let _serviceAvailable = true;
const MAX_CONSECUTIVE_FAILURES = 3;

function recordSuccess() {
  _consecutiveFailures = 0;
  _serviceAvailable = true;
}

function recordFailure() {
  _consecutiveFailures++;
  if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    if (_serviceAvailable) {
      console.log(`[cv-client] service marked unavailable after ${_consecutiveFailures} consecutive failures`);
    }
    _serviceAvailable = false;
  }
}

export function CV_SERVICE_AVAILABLE(): boolean {
  // Respect kill-switch before checking circuit breaker state
  if (process.env.CV_SERVICE_ENABLED === 'false') return false;
  return _serviceAvailable;
}

// ── Config ─────────────────────────────────────────────────────────────────
function getCvServiceUrl(): string {
  return (process.env.CV_SERVICE_URL ?? 'http://localhost:8765').replace(/\/$/, '');
}

function getTimeoutMs(): number {
  const v = parseInt(process.env.AUTOCAD_BRIDGE_TIMEOUT_MS ?? '30000', 10);
  return Number.isFinite(v) && v > 0 ? v : 30000;
}

// ── Core fetch helper ──────────────────────────────────────────────────────
async function cvFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${getCvServiceUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  let res: Response;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err: unknown) {
    recordFailure();
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[cv-client] service unavailable: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    recordFailure();
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`[cv-client] HTTP ${res.status}: ${body}`);
  }

  recordSuccess();
  return res.json() as Promise<T>;
}

// ── Health ─────────────────────────────────────────────────────────────────
export async function getCvHealth(): Promise<CvHealth> {
  return cvFetch<CvHealth>('/health');
}

export async function isCvServiceAvailable(): Promise<boolean> {
  try {
    const h = await getCvHealth();
    return h.status === 'ok';
  } catch {
    return false;
  }
}

// ── YOLO Detection ─────────────────────────────────────────────────────────
export async function cvDetect(
  imageB64: string,
  pageWidth: number,
  pageHeight: number,
  confidenceThreshold = 0.3,
): Promise<CvDetectResult> {
  return cvFetch<CvDetectResult>('/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_b64: imageB64,
      page_width: pageWidth,
      page_height: pageHeight,
      confidence_threshold: confidenceThreshold,
    }),
  });
}

// ── OCR ────────────────────────────────────────────────────────────────────
export async function cvOcr(
  imageB64: string,
  engine = 'auto',
  lang = 'eng',
): Promise<CvOcrResult> {
  return cvFetch<CvOcrResult>('/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_b64: imageB64, engine, lang }),
  });
}

// ── Template Matching ──────────────────────────────────────────────────────
export async function cvTemplateMatch(
  pageB64: string,
  templateB64: string,
  threshold = 0.7,
  maxMatches = 20,
): Promise<CvTemplateMatchResult> {
  return cvFetch<CvTemplateMatchResult>('/template-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page_b64: pageB64,
      template_b64: templateB64,
      threshold,
      max_matches: maxMatches,
    }),
  });
}

// ── BBox Refinement ────────────────────────────────────────────────────────
export async function cvBBoxRefine(
  imageB64: string,
  bbox: CvBBox,
  pageWidth: number,
  pageHeight: number,
): Promise<CvBBoxRefineResult> {
  return cvFetch<CvBBoxRefineResult>('/bbox-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_b64: imageB64,
      bbox,
      page_width: pageWidth,
      page_height: pageHeight,
    }),
  });
}
