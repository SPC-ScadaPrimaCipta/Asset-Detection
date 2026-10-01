/**
 * Detection configuration.
 *
 * Single source of truth for detection tuning knobs. The pipeline is 100%
 * Gemini Vision (same model resolution, generation config, retry and JSON
 * salvage as Scan Legend — see lib/legend-extract.ts), so the only knob left
 * here is how finely each PDF page is rasterized before it is sent to the model.
 */
import { env } from '@/lib/env';

export const detectionConfig = {
  /**
   * Pipeline identity recorded in `agent_runs.model` and
   * `detections.pipeline_version` for observability. Not env-tunable: the
   * pipeline is no longer a sequence of switchable stages.
   */
  pipelineVersion: 'gemini-vision-only',

  /**
   * mupdf render scale for the page PNG sent to the model.
   * 3.0 ≈ 216 DPI — enough for small P&ID tags (6pt) while keeping an A3 page
   * well under Gemini's ~20MB inline image limit. Raise only if tags are being
   * missed; every +1.0 roughly quadruples PNG size.
   */
  renderScale: env.DETECTION_RENDER_SCALE,

  /**
   * Region (tiled) detection — the Scan Legend strategy applied to P&ID pages.
   *
   * Gemini downscales large images internally, so a full page compresses 6pt
   * tags into near-illegibility. Splitting the page into overlapping crops and
   * upscaling each one restores effective resolution, at the cost of one
   * generateContent call per region.
   */
  regions: {
    /** 'regions' = tiled sweep; 'page' = single full-page call. */
    mode: env.DETECTION_REGION_MODE,
    /** 0 = derive from page aspect ratio. */
    cols: env.DETECTION_REGION_COLS,
    rows: env.DETECTION_REGION_ROWS,
    overlap: env.DETECTION_REGION_OVERLAP,
    /** Full-page sweep after the regions, to catch split symbols. */
    catchup: env.DETECTION_REGION_CATCHUP === 'true',
    /** Delay between region calls, to respect per-minute request limits. */
    delayMs: env.DETECTION_REGION_DELAY_MS,
  },

  /**
   * Optional per-detection AI enrichment. Both are OFF by default because each
   * costs an extra Gemini request per detection, which exhausts the free-tier
   * rate limit (FR-JOB-008) and breaks the 120s/page budget (NFR-001).
   *
   * `image_hash` is always computed locally from the crop, so duplicate
   * detection and the confirm-time symbol cache keep working regardless.
   */
  symbolFeatures: {
    /** Structured visual attributes per symbol via an extra Gemini call. */
    extract: env.ENABLE_SYMBOL_FEATURE_EXTRACTION === 'true',
    /** pgvector embedding of the canonical string. Requires `extract`. */
    embed: env.ENABLE_SYMBOL_EMBEDDING === 'true',
  },

  debugArtifacts: env.DEBUG_ARTIFACTS === 1,
} as const;

export type DetectionConfig = typeof detectionConfig;
