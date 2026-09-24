/**
 * Detection V2 — centralized configuration.
 *
 * Single source of truth for all pipeline thresholds. Values come from env
 * (see lib/env.ts) so they can be tuned without code changes. All thresholds
 * here are INITIAL engineering targets — Phase 8 calibrates them against the
 * ground-truth benchmark (precision/recall/F1), they are NOT final.
 */
import { env } from '@/lib/env';

export const detectionConfig = {
  pipelineVersion: env.PIPELINE_VERSION,
  aiMode: env.AI_MODE as 'disabled' | 'assisted',

  cvServiceUrl: env.CV_SERVICE_URL.replace(/\/$/, ''),

  tiling: {
    tileSize: env.TILE_SIZE,
    overlap: env.TILE_OVERLAP,
  },

  confidence: {
    /** score >= high → deterministic accept, no Gemini call */
    high: env.HIGH_CONFIDENCE_THRESHOLD,
    /** low <= score < high → Gemini verification (budgeted) */
    low: env.LOW_CONFIDENCE_THRESHOLD,
  },

  geminiBudget: {
    /** Max Gemini verification calls per page (§35: initial target ≤10) */
    maxCallsPerPage: env.MAX_GEMINI_CALLS_PER_PAGE,
    maxRetryPerPage: env.MAX_GEMINI_RETRY_PER_PAGE,
  },

  debugArtifacts: env.DEBUG_ARTIFACTS === 1,

  /** Local worker wiring → Python CV service (Phase 10 recommended defaults). */
  cv: {
    renderScale: env.CV_RENDER_SCALE,
    ocrProvider: env.CV_OCR_PROVIDER,
    legendExtractPages: env.LEGEND_EXTRACT_PAGES,
    masking: true,
    lineSplit: true,
    reunion: true,
    bboxRefine: true,
    matchRepair: true,
    mask: {} as Record<string, number>,
    refine: true,
    repair: {} as Record<string, number | boolean>,
  },
} as const;

export type DetectionConfig = typeof detectionConfig;
