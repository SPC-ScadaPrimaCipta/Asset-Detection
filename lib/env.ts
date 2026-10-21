import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}
loadEnvFiles();

// Do NOT require GEMINI/DEEPSEEK keys at startup — they live in DB (Settings page)
// and are resolved at runtime via lib/ai-config.ts. This prevents `npm run worker` crash
// when keys are only in DB, not .env.local.
//
// Every value below is a FALLBACK. Resolution order is
//   settings.tuning (DB) > .env (here) > this literal
// enforced by lib/tuning.ts. Change behaviour via .env.local or the Settings UI,
// not by editing code.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required - set in .env.local'),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  // NOTE: left as-is on purpose. gemini-3.5-flash ignores responseMimeType, so
  // it is skipped at runtime by GEMINI_JSON_INCOMPATIBLE_MODELS — but the
  // configured value is never silently rewritten. Set a valid model yourself.
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-7-sonnet-20250219'),
  AI_PROVIDER: z.enum(['gemini', 'openai', 'anthropic', 'deepseek']).default('gemini'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  STORAGE_PATH: z.string().default('./storage'),

  // ── Provider endpoints (override for proxies / regional gateways) ──
  GEMINI_API_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  DEEPSEEK_API_BASE_URL: z.string().url().default('https://api.deepseek.com'),

  // ── Model selection ──
  // Ordered preference used when the configured model is unavailable. Comma list.
  GEMINI_PREFERRED_MODELS: z.string().default(
    'gemini-3.6-flash,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.7-flash',
  ),
  // Models that ignore responseMimeType: application/json and return prose.
  GEMINI_JSON_INCOMPATIBLE_MODELS: z.string().default('gemini-3.5-flash,gemini-3.5-flash-lite'),
  MODEL_LIST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  MODEL_CACHE_TTL_MS: z.coerce.number().int().positive().default(600_000),

  // ── Gemini generation parameters (per flow) ──
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.05),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(16384),
  LEGEND_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.05),
  LEGEND_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
  LEGEND_CATCHUP_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  LEGEND_CATCHUP_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  RULE_VALIDATOR_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
  VERIFIER_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),
  SYMBOL_FEATURES_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(512),

  // ── Retry / backoff (shared with Scan Legend) ──
  GEMINI_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  GEMINI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  // Upper bound on a single backoff sleep, so a large provider retry hint
  // cannot stall a job indefinitely.
  GEMINI_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(60_000),
  // Pause between per-region / per-chunk calls, to stay under per-minute limits.
  // 800ms: safe for PAGE_BATCH_SIZE=1 (≤10 calls/min from a single job, under 15 RPM free tier).
  DETECTION_REGION_DELAY_MS: z.coerce.number().int().min(0).default(800),
  LEGEND_REGION_DELAY_MS: z.coerce.number().int().min(0).default(300),
  LEGEND_ERROR_DELAY_MS: z.coerce.number().int().min(0).default(1000),
  // Delay between per-model attempts inside one detection request.
  GEMINI_MODEL_ATTEMPT_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  // Stop walking the fallback chain after this many models. 0 = unlimited
  // (every candidate is tried). Bounding attempts turns a slow 503 storm into a
  // fast, actionable "all models exhausted" failure.
  GEMINI_MAX_MODEL_ATTEMPTS: z.coerce.number().int().min(0).default(3),
  // Consecutive provider failures (503/429/404) that trip a per-model breaker.
  // 0 = breaker disabled.
  GEMINI_CIRCUIT_FAILURES: z.coerce.number().int().min(0).default(3),
  // How long a tripped model is skipped before being tried again.
  GEMINI_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().min(0).default(300_000),
  // Ceiling on Gemini requests per minute, enforced process-wide by
  // lib/gemini-request-gate.ts and shared by Scan Legend and Run Detection.
  // The free tier allows 15; a paid tier allows far more. This is the number to
  // raise when a quota is genuinely larger — the 429s in a region sweep are
  // almost always this ceiling being too low, not the per-loop delays.
  GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(15),

  // ── Detection (100% Gemini Vision) ──
  // mupdf render scale for the page PNG sent to Gemini. 3.0 ≈ 216 DPI; keeps an
  // A3 page under Gemini's ~20MB inline image limit. Raise only if small P&ID
  // tags are being missed.
  DETECTION_RENDER_SCALE: z.coerce.number().positive().default(3.0),
  DEBUG_ARTIFACTS: z.coerce.number().int().min(0).max(1).default(0),
  // 0 = derive PAGE_BATCH_SIZE from render scale.
  PAGE_BATCH_SIZE: z.coerce.number().int().positive().optional(),

  // ── Region (tiled) detection ──
  // 'regions' splits each page into overlapping crops so small P&ID tags stay
  // legible after Gemini's internal downscaling — same approach as Scan Legend.
  // Cost: one generateContent call per region instead of one per page, so it
  // trades quota for accuracy. 'page' keeps the single-call full-page pass.
  DETECTION_REGION_MODE: z.enum(['regions', 'page']).default('regions'),
  // 0 = derive the grid from the page aspect ratio (see gridForAspect).
  DETECTION_REGION_COLS: z.coerce.number().int().min(0).max(8).default(0),
  DETECTION_REGION_ROWS: z.coerce.number().int().min(0).max(8).default(0),
  // Fractional overlap so symbols on a region border are not cut in half.
  DETECTION_REGION_OVERLAP: z.coerce.number().min(0).max(0.4).default(0.15),
  // Full-page pass after the region sweep, to catch symbols the grid split
  // awkwardly. Set to false to skip it (saves one call per page).
  DETECTION_REGION_CATCHUP: z.enum(['true', 'false']).default('true'),
  // Skip likely non-P&ID pages (cover/title page 1, revision history last page)
  // in multi-page documents. Safe default: false (opt-in). Enable when documents
  // consistently have cover/revision pages that produce false positives.
  DETECTION_SKIP_NON_PID_PAGES: z.enum(['true', 'false']).default('false'),
  // Two detections merge when same tag (or same type when untagged) AND IoU
  // exceeds this. Higher = stricter = keeps more near-duplicates.
  DETECTION_REGION_DEDUPE_IOU: z.coerce.number().min(0).max(1).default(0.3),
  // Crop upscale bounds, in pixels, before the region is sent to Gemini.
  DETECTION_CROP_MIN_WIDTH: z.coerce.number().int().positive().default(800),
  DETECTION_CROP_MAX_WIDTH: z.coerce.number().int().positive().default(2400),

  // ── Scan Legend region grid ──
  // 0 = derive from page aspect ratio (see legend-extract.ts).
  LEGEND_REGION_COLS_LANDSCAPE: z.coerce.number().int().min(0).max(12).default(6),
  LEGEND_REGION_COLS_SQUARISH: z.coerce.number().int().min(0).max(12).default(4),
  LEGEND_REGION_COLS_PORTRAIT: z.coerce.number().int().min(0).max(12).default(3),
  LEGEND_REGION_ROWS: z.coerce.number().int().min(0).max(12).default(4),
  LEGEND_REGION_OVERLAP: z.coerce.number().min(0).max(0.5).default(0.15),
  LEGEND_RENDER_SCALE: z.coerce.number().positive().default(2.0),
  // Region crops are upscaled to at least this width before being sent to
  // Gemini, so small legend symbols survive its internal downscaling.
  LEGEND_CROP_MIN_WIDTH: z.coerce.number().int().positive().default(800),
  LEGEND_CROP_MAX_WIDTH: z.coerce.number().int().positive().default(2400),
  // Two symbols merge when same normalized name AND IoU exceeds this.
  LEGEND_DEDUPE_IOU: z.coerce.number().min(0).max(1).default(0.5),
  // Looser IoU that also merges symbols with identical names.
  LEGEND_DEDUPE_NAME_IOU: z.coerce.number().min(0).max(1).default(0.3),

  // ── Detection thresholds (decision bands + penalties) ──
  // Detections at or above this skip the per-detection feature/embedding path.
  DETECTION_SKIP_FEATURES_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.96),
  // Below this overall confidence a detection is flagged NEEDS_REVIEW.
  DETECTION_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  // A total penalty of at least this forces NEEDS_REVIEW.
  DETECTION_PENALTY_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.1),
  // Missing asset tag.
  DETECTION_PENALTY_NO_TAG: z.coerce.number().min(0).max(1).default(0.05),
  // Only one evidence string = thin evidence.
  DETECTION_PENALTY_THIN_EVIDENCE: z.coerce.number().min(0).max(1).default(0.03),
  // Bbox larger than the asset-type-aware limit (likely includes pipes).
  DETECTION_PENALTY_BBOX_OVERSIZE: z.coerce.number().min(0).max(1).default(0.08),
  // Bbox larger than this many 0-1000 units is treated as a whole region.
  DETECTION_BBOX_OVERSIZE_UNITS: z.coerce.number().int().positive().default(450),
  // Bbox at or below this size is degenerate (zero-area crop).
  DETECTION_BBOX_DEGENERATE_UNITS: z.coerce.number().int().min(0).default(1),
  // Asset-type-aware bbox limits, in 0-1000 units.
  DETECTION_BBOX_MAX_SYMBOL_UNITS: z.coerce.number().int().positive().default(150),
  DETECTION_BBOX_MAX_LARGE_EQUIPMENT_UNITS: z.coerce.number().int().positive().default(300),
  // Confidence caps.
  DETECTION_CAP_UNKNOWN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  DETECTION_CAP_OVERSIZED_BBOX_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.4),
  DETECTION_CAP_DEGENERATE_BBOX_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.3),
  // Applied when the model omitted a confidence value.
  DETECTION_DEFAULT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  // Per-field confidence for a Vision-only field with no corroboration.
  DETECTION_FIELD_CONFIDENCE_VISION_ONLY: z.coerce.number().min(0).max(1).default(0.45),
  DETECTION_FIELD_CONFIDENCE_MAIN_EQUIPMENT_VISION_ONLY: z.coerce.number().min(0).max(1).default(0.4),
  DETECTION_FIELD_CONFIDENCE_SERVICE_VISION_ONLY: z.coerce.number().min(0).max(1).default(0.45),
  DETECTION_FIELD_CONFIDENCE_SERVICE_INFERRED: z.coerce.number().min(0).max(1).default(0.65),
  DETECTION_FIELD_CONFIDENCE_MAIN_EQUIPMENT_INFERRED: z.coerce.number().min(0).max(1).default(0.6),
  DETECTION_FIELD_CONFIDENCE_DESCRIPTION_VISION_ONLY: z.coerce.number().min(0).max(1).default(0.5),
  DETECTION_FIELD_CONFIDENCE_DESCRIPTION_INFERRED: z.coerce.number().min(0).max(1).default(0.7),
  DETECTION_FIELD_CONFIDENCE_MAPPED: z.coerce.number().min(0).max(1).default(0.8),
  // Applied when both Legend and Company KB agree.
  DETECTION_FIELD_CONFIDENCE_BONUS: z.coerce.number().min(0).max(1).default(0.02),
  // Fields below this are stored as null (NULL_FIELD_CONFIDENCE_THRESHOLD).
  NULL_FIELD_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  // Overlapping boxes with the same tag merge above this IoU.
  NMS_IOU_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  // Rule validations resolved in parallel per batch.
  FEATURE_BATCH_SIZE: z.coerce.number().int().positive().default(5),

  // ── Rule validator thresholds ──
  // Overall confidence at or above this may keep a Vision classification.
  VALIDATOR_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.60),
  // Embedding similarity at or above this skips re-reading the image.
  VALIDATOR_EMBEDDING_SKIP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.88),
  // Below this the embedding step is treated as no match at all.
  VALIDATOR_EMBEDDING_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.65),
  // Rule-engine score at or above this counts as a hit.
  VALIDATOR_RULE_SCORE_HIT: z.coerce.number().min(0).max(1).default(0.5),
  // Score assigned when an asset type has no rule definitions yet.
  VALIDATOR_RULE_SCORE_NEUTRAL: z.coerce.number().min(0).max(1).default(0.5),
  // Evidence source scores, ordered Legend > Company KB > ISA > ISO.
  VALIDATOR_LEGEND_SCORE_ISA: z.coerce.number().min(0).max(1).default(0.75),
  VALIDATOR_LEGEND_SCORE_ISO: z.coerce.number().min(0).max(1).default(0.70),
  VALIDATOR_LEGEND_SCORE_VERIFIED: z.coerce.number().min(0).max(1).default(1.0),
  // Company KB base score, plus a bonus per confirmations, capped.
  VALIDATOR_COMPANY_BASE_SCORE: z.coerce.number().min(0).max(1).default(0.90),
  VALIDATOR_COMPANY_MAX_SCORE: z.coerce.number().min(0).max(1).default(0.98),
  VALIDATOR_COMPANY_CONFIRM_BONUS_STEP: z.coerce.number().min(0).max(1).default(0.05),
  VALIDATOR_COMPANY_CONFIRM_BONUS_MAX: z.coerce.number().min(0).max(1).default(0.10),
  // Confirmed detections per bonus step.
  VALIDATOR_COMPANY_CONFIRM_BONUS_EVERY: z.coerce.number().int().positive().default(5),
  // Caps applied at the end of the priority chain.
  VALIDATOR_CAP_CONFLICT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.79),
  VALIDATOR_CAP_UNKNOWN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.50),
  // Penalty for previously rejected asset types: 1-2 → -x, 3-5 → -y, 6-10 → -z, >10 → -w
  VALIDATOR_REJECTION_PENALTY_LOW: z.coerce.number().min(0).max(1).default(0.05),
  VALIDATOR_REJECTION_PENALTY_MEDIUM: z.coerce.number().min(0).max(1).default(0.10),
  VALIDATOR_REJECTION_PENALTY_HIGH: z.coerce.number().min(0).max(1).default(0.20),
  VALIDATOR_REJECTION_PENALTY_CRITICAL: z.coerce.number().min(0).max(1).default(0.30),
  // Rejection count boundaries for the tiers above.
  VALIDATOR_REJECTION_TIER_LOW_MAX: z.coerce.number().int().min(0).default(2),
  VALIDATOR_REJECTION_TIER_MEDIUM_MAX: z.coerce.number().int().min(0).default(5),
  VALIDATOR_REJECTION_TIER_HIGH_MAX: z.coerce.number().int().min(0).default(10),

  // ── Confidence fusion ──
  // Similarity → score bands: first band at or above 0.95 → 1.0, then descending.
  VALIDATOR_SIMILARITY_BANDS_JSON: z
    .string()
    .default('[{"min":0.95,"score":1.0},{"min":0.85,"score":0.8},{"min":0.75,"score":0.6},{"min":0.65,"score":0.4}]'),
  // Spatial max-proximity (0-1000 units) per rotating equipment class.
  SPATIAL_MAX_PROXIMITY: z.coerce.number().int().positive().default(150),
  SPATIAL_MAX_PROXIMITY_JSON: z.string().default(
    '{"valve":100,"vessel":250,"rotating":180}',
  ),

  // ── Crop / expansion helpers ──
  // Bounding boxes are padded before cropping so nearby tag text stays included.
  CROP_EXPAND_MIN_UNITS: z.coerce.number().int().min(0).default(20),
  CROP_EXPAND_MAX_UNITS: z.coerce.number().int().min(0).default(80),
  CROP_EXPAND_RATIO: z.coerce.number().min(0).max(2).default(0.40),

  // ── Upload limits ──
  UPLOAD_MAX_PDF_MB: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_DOCUMENT_UPLOADS_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LEGEND_UPLOADS_PER_MIN: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_DETECTION_TRIGGERS_PER_MIN: z.coerce.number().int().positive().default(5),

  // ── Worker startup ──
  WORKER_RECOVERY_DELAY_MS: z.coerce.number().int().min(0).default(3000),
  WORKER_PREWARM_DELAY_MS: z.coerce.number().int().min(0).default(5000),
  // How many detection jobs run at once. 1 on purpose: the Gemini free tier is
  // 15 RPM, so two concurrent region sweeps only multiply 503/429 responses and
  // double the wall-clock per job.
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  // BullMQ renews the job lock on this interval. The default is lockDuration/2,
  // which is too coarse for long region sweeps, so it is set explicitly.
  WORKER_LOCK_RENEW_TIME_MS: z.coerce.number().int().positive().default(30_000),
  // Must exceed the slowest realistic single job (many regions x model retries).
  // BullMQ's default is 30s, which expires mid-sweep and makes BullMQ treat the
  // job as stalled: it re-queues it, and the duplicate run persists a second copy
  // of every detection.
  WORKER_LOCK_DURATION_MS: z.coerce.number().int().positive().default(900_000),
  // How long the worker waits between stalled-job checks, and how many stalled
  // events are tolerated before the job is failed instead of retried.
  WORKER_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_MAX_STALLED_COUNT: z.coerce.number().int().min(0).default(1),
  VERIFIER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Hard limit for any Gemini generateContent call. Without this a provider
  // connection that never answers stalls the worker indefinitely.
  GEMINI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  VERIFIER_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  VERIFIER_MAX_CALLS_PER_PAGE: z.coerce.number().int().positive().default(10),

  // ── Optional per-detection AI enrichment (OFF by default) ──
  // Structured feature extraction makes ONE extra Gemini call per detection.
  // On a 19-symbol page that is 19 extra calls on top of the page call, which
  // exhausts the Gemini free tier (15 RPM) and pushes a page past the 120s
  // budget. Detection quality does not depend on it — confidence comes from
  // Gemini's own symbol/tag/matching scores. Enable only with quota headroom.
  ENABLE_SYMBOL_FEATURE_EXTRACTION: z
    .enum(['true', 'false'])
    .default('false'),
  // Embedding depends on the feature extraction above and must additionally
  // match the DB column width. gemini-embedding-001 emits 3072 dims while the
  // DB column is vector(768), so it is off by default too.
  ENABLE_SYMBOL_EMBEDDING: z.enum(['true', 'false']).default('false'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_MODEL_FALLBACKS: z.string().default(''),
  // Must match the DB column width (vector(768)) or every insert is rejected.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  EMBEDDING_REQUEST_DELAY_MS: z.coerce.number().int().min(0).default(200),

  // ── Hybrid Detection Pipeline (V3) ───────────────────────────────────────
  // Python CV service URL (FastAPI: YOLO, OCR, OpenCV, bbox refinement)
  CV_SERVICE_URL: z.string().default('http://localhost:8765'),
  // Whether to use Python CV service for YOLO + OCR + template matching
  // Falls back to Node-side YOLO (onnxruntime) when false or service unavailable
  CV_SERVICE_ENABLED: z.enum(['true', 'false']).default('false'),
  // OCR engine preference: 'tesseract' (Node), 'cv-service' (Python auto), 'none'
  OCR_ENGINE: z.enum(['tesseract', 'cv-service', 'none']).default('tesseract'),
  // AI verifier: call AI vision for UNKNOWN or low-confidence YOLO detections
  AI_VERIFIER_ENABLED: z.enum(['true', 'false']).default('true'),
  GEMINI_VERIFIER_ENABLED: z.enum(['true', 'false']).default('true'),
  // Confidence threshold below which AI verifier is invoked for YOLO detections
  AI_VERIFIER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  GEMINI_VERIFIER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  // AI full-page fallback: run AI vision on full page after YOLO to catch missed symbols
  AI_FALLBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  GEMINI_FALLBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  // Min IoU for merging YOLO + AI detections (avoid double-counting same symbol)
  HYBRID_MERGE_IOU: z.coerce.number().min(0).max(1).default(0.4),
  // BBox refinement via OpenCV contour detection (requires CV_SERVICE_ENABLED)
  BBOX_REFINE_ENABLED: z.enum(['true', 'false']).default('false'),
  // Template matching via OpenCV (requires CV_SERVICE_ENABLED)
  TEMPLATE_MATCH_ENABLED: z.enum(['true', 'false']).default('false'),
  // Min template match score to create a detection
  TEMPLATE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.70),
  // Negative learning penalty applied during YOLO path rule validation
  NEGATIVE_LEARNING_ENABLED: z.enum(['true', 'false']).default('true'),
  // Delete duplicate detections after a job finishes (same rules as the
  // Remove Duplicates button). Off by default: duplicates are annotated for
  // review so a false positive is never removed without a trace.
  DETECTION_AUTO_DEDUPE: z.enum(['true', 'false']).default('false'),
  // How many YOLO detections to process OCR in parallel per page
  OCR_BATCH_SIZE: z.coerce.number().int().positive().default(5),
});

let parsed: z.infer<typeof envSchema>;
try {
  parsed = envSchema.parse(process.env);
} catch (e: unknown) {
  if (e instanceof z.ZodError) {
    const msg = e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n  - ');
    console.error(`[env] Validation failed:\n  - ${msg}\n\nFix: create/update .env.local. Example:\n  DATABASE_URL=postgresql://user:password@localhost:5432/asset_detection\n  REDIS_URL=redis://localhost:6379\n  # API keys can also be set via Settings page UI (stored in DB)\n`);
  }
  throw e;
}
export const env = parsed;
