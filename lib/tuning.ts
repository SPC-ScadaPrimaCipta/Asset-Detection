/**
 * Runtime tuning — the single read path for every operational value.
 *
 * Precedence, highest first:
 *   1. settings.tuning  (DB, edited from the Settings UI)
 *   2. process.env      (.env.local / .env)
 *   3. literal fallback (the `env` schema default, i.e. code)
 *
 * Rule: a literal in code is a LAST resort only. Nothing outside this module may
 * read a tuning value from `process.env` directly, so there is exactly one place
 * to look when a threshold needs to change.
 *
 * Shape of `settings.tuning`:
 *   { "regions": { "overlap": 0.2 }, "detection": { "reviewThreshold": 0.7 } }
 *
 * It is a partial, deeply-merged document. Unknown keys are ignored rather than
 * trusted, and wrong-typed values fall back instead of propagating NaN into the
 * pipeline.
 */
import { env } from '@/lib/env';

// ── Groups ───────────────────────────────────────────────────────────────────

export interface GenerationTuning {
  temperature: number;
  maxOutputTokens: number;
}

export interface ModelTuning {
  preferred: string[];
  jsonIncompatible: Set<string>;
  listTimeoutMs: number;
  cacheTtlMs: number;
  deepseekModel: string;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  modelAttemptDelayMs: number;
  maxModelAttempts: number;
  circuitFailures: number;
  circuitCooldownMs: number;
  requestsPerMinute: number;
  geminiBaseUrl: string;
  deepseekBaseUrl: string;
}

export interface RegionTuning {
  mode: 'regions' | 'page';
  cols: number;
  rows: number;
  overlap: number;
  catchup: boolean;
  dedupeIou: number;
  delayMs: number;
  cropMinWidth: number;
  cropMaxWidth: number;
}

export interface DetectionTuning {
  renderScale: number;
  pageBatchSize: number | null;
  skipFeaturesConfidence: number;
  reviewThreshold: number;
  penaltyReviewThreshold: number;
  penaltyNoTag: number;
  penaltyThinEvidence: number;
  penaltyBboxOversize: number;
  bboxOversizeUnits: number;
  bboxDegenerateUnits: number;
  bboxMaxSymbolUnits: number;
  bboxMaxLargeEquipmentUnits: number;
  capUnknownConfidence: number;
  capOversizedBboxConfidence: number;
  capDegenerateBboxConfidence: number;
  defaultConfidence: number;
  fieldConfidenceVisionOnly: number;
  fieldConfidenceMainEquipmentVisionOnly: number;
  fieldConfidenceServiceVisionOnly: number;
  fieldConfidenceServiceInferred: number;
  fieldConfidenceMainEquipmentInferred: number;
  fieldConfidenceDescriptionVisionOnly: number;
  fieldConfidenceDescriptionInferred: number;
  fieldConfidenceMapped: number;
  fieldConfidenceBonus: number;
  nullFieldConfidenceThreshold: number;
  nmsIouThreshold: number;
  featureBatchSize: number;
  symbolFeatures: { extract: boolean; embed: boolean };
  /** Max legend symbol reference crops to send to Gemini per page (0 = disabled). */
  maxReferenceCrops: number;
}

export interface ValidatorTuning {
  confidenceThreshold: number;
  embeddingSkipThreshold: number;
  embeddingMinSimilarity: number;
  ruleScoreHit: number;
  ruleScoreNeutral: number;
  legendScoreIsa: number;
  legendScoreIso: number;
  legendScoreVerified: number;
  companyBaseScore: number;
  companyMaxScore: number;
  companyConfirmBonusStep: number;
  companyConfirmBonusMax: number;
  companyConfirmBonusEvery: number;
  capConflictConfidence: number;
  capUnknownConfidence: number;
  rejectionPenaltyLow: number;
  rejectionPenaltyMedium: number;
  rejectionPenaltyHigh: number;
  rejectionPenaltyCritical: number;
  rejectionTierLowMax: number;
  rejectionTierMediumMax: number;
  rejectionTierHighMax: number;
  similarityBands: { min: number; score: number }[];
  spatialMaxProximity: number;
  spatialMaxProximityByType: Record<string, number>;
}

export interface FusionTuning {
  weights: {
    legend: number;
    company: number;
    embedding: number;
    ocr: number;
    rules: number;
    vision: number;
  };
}

export interface PerformanceTuning {
  legendRegionColsLandscape: number;
  legendRegionColsSquarish: number;
  legendRegionColsPortrait: number;
  legendRegionRows: number;
  legendRegionOverlap: number;
  legendRenderScale: number;
  legendCropMinWidth: number;
  legendCropMaxWidth: number;
  legendDedupeIou: number;
  legendDedupeNameIou: number;
  legendRegionDelayMs: number;
  legendErrorDelayMs: number;
  cropExpandMinUnits: number;
  cropExpandMaxUnits: number;
  cropExpandRatio: number;
  uploadMaxPdfMb: number;
  rateLimitDocumentUploads: number;
  rateLimitLegendUploads: number;
  rateLimitDetectionTriggers: number;
  workerRecoveryDelayMs: number;
  workerPrewarmDelayMs: number;
  workerConcurrency: number;
  workerLockRenewTimeMs: number;
  workerLockDurationMs: number;
  workerStalledIntervalMs: number;
  workerMaxStalledCount: number;
  verifierTimeoutMs: number;
  verifierCacheMaxEntries: number;
  verifierMaxCallsPerPage: number;
  embeddingModel: string;
  embeddingModelFallbacks: string[];
  embeddingDimensions: number;
  embeddingRequestDelayMs: number;
}

export interface Tuning {
  generation: {
    gemini: GenerationTuning;
    legend: GenerationTuning;
    legendCatchup: GenerationTuning;
    ruleValidator: GenerationTuning;
    verifier: GenerationTuning;
    symbolFeatures: GenerationTuning;
  };
  model: ModelTuning;
  regions: RegionTuning;
  detection: DetectionTuning;
  validator: ValidatorTuning;
  fusion: FusionTuning;
  performance: PerformanceTuning;
}

/**
 * DB document shape — partial, all the way down, so a UI form can override one
 * nested key (e.g. only `generation.gemini.temperature`) without restating the
 * rest of the group.
 */
type DeepPartial<T> = T extends Set<unknown>
  ? T
  : { [K in keyof T]?: DeepPartial<T[K]> };

export type TuningOverrides = {
  [K in keyof Tuning]?: DeepPartial<Tuning[K]>;
};

// ── Parsing helpers (pure, so they are directly testable) ───────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accept only finite numbers; anything else keeps the fallback. */
export function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Accept only finite numbers strictly greater than zero.
 *
 * `num` alone is wrong for settings where 0 is not merely "off" but actively
 * breaks the caller — BullMQ throws at Worker construction on a non-positive
 * lock duration, so an override of 0 from the Settings UI must fall back rather
 * than crash the worker at import time.
 */
export function pos(value: unknown, fallback: number): number {
  const n = num(value, Number.NaN);
  return n > 0 ? n : fallback;
}

export function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

export function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

export function strList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const out = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    if (out.length > 0) return out;
  }
  if (typeof value === 'string') {
    const out = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (out.length > 0) return out;
  }
  return fallback;
}

function csv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function jsonOr<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Build the full tuning object from env, then overlay DB overrides.
 *
 * Split out from any I/O so the merge rules are unit-testable without a database.
 */
export function buildTuning(overrides?: TuningOverrides | null): Tuning {
  // A null/garbage document must not throw here: this is the merge entry point
  // and a corrupted settings row should degrade to env values, not a 500.
  const doc: TuningOverrides = isRecord(overrides) ? overrides : {};
  const o = (group: keyof TuningOverrides): Record<string, unknown> => {
    const v = doc[group];
    return isRecord(v) ? (v as Record<string, unknown>) : {};
  };
  // Nested groups (e.g. generation.gemini) are read through this so a missing
  // or malformed value degrades to the fallback instead of throwing.
  const sub = (group: Record<string, unknown>, key: string): Record<string, unknown> => {
    const v = group[key];
    return isRecord(v) ? v : {};
  };

  const g = o('generation');
  const m = o('model');
  const r = o('regions');
  const d = o('detection');
  const v = o('validator');
  const f = o('fusion');
  const p = o('performance');

  const legendTemp = num(sub(g, 'legend').temperature, env.LEGEND_TEMPERATURE);
  const catchupTemp = num(sub(g, 'legendCatchup').temperature, env.LEGEND_CATCHUP_TEMPERATURE);
  const legendTokens = num(sub(g, 'legend').maxOutputTokens, env.LEGEND_MAX_OUTPUT_TOKENS);

  return {
    generation: {
      gemini: {
        temperature: num(sub(g, 'gemini').temperature, env.GEMINI_TEMPERATURE),
        maxOutputTokens: num(sub(g, 'gemini').maxOutputTokens, env.GEMINI_MAX_OUTPUT_TOKENS),
      },
      legend: { temperature: legendTemp, maxOutputTokens: legendTokens },
      legendCatchup: {
        temperature: catchupTemp,
        maxOutputTokens: num(sub(g, 'legendCatchup').maxOutputTokens, env.LEGEND_CATCHUP_MAX_OUTPUT_TOKENS),
      },
      ruleValidator: {
        temperature: num(sub(g, 'ruleValidator').temperature, env.GEMINI_TEMPERATURE),
        maxOutputTokens: num(sub(g, 'ruleValidator').maxOutputTokens, env.RULE_VALIDATOR_MAX_OUTPUT_TOKENS),
      },
      verifier: {
        temperature: num(sub(g, 'verifier').temperature, 0),
        maxOutputTokens: num(sub(g, 'verifier').maxOutputTokens, env.VERIFIER_MAX_OUTPUT_TOKENS),
      },
      symbolFeatures: {
        temperature: num(sub(g, 'symbolFeatures').temperature, 0),
        maxOutputTokens: num(sub(g, 'symbolFeatures').maxOutputTokens, env.SYMBOL_FEATURES_MAX_OUTPUT_TOKENS),
      },
    },
    model: {
      preferred: strList(m.preferred, csv(env.GEMINI_PREFERRED_MODELS)),
      jsonIncompatible: new Set(
        strList(m.jsonIncompatible, csv(env.GEMINI_JSON_INCOMPATIBLE_MODELS)).map((s) => s.toLowerCase()),
      ),
      listTimeoutMs: num(m.listTimeoutMs, env.MODEL_LIST_TIMEOUT_MS),
      cacheTtlMs: num(m.cacheTtlMs, env.MODEL_CACHE_TTL_MS),
      deepseekModel: str(m.deepseekModel, env.DEEPSEEK_MODEL),
      retryMaxAttempts: num(m.retryMaxAttempts, env.GEMINI_RETRY_MAX_ATTEMPTS),
      retryBaseDelayMs: num(m.retryBaseDelayMs, env.GEMINI_RETRY_BASE_DELAY_MS),
      retryMaxDelayMs: num(m.retryMaxDelayMs, env.GEMINI_RETRY_MAX_DELAY_MS),
      modelAttemptDelayMs: num(m.modelAttemptDelayMs, env.GEMINI_MODEL_ATTEMPT_DELAY_MS),
      maxModelAttempts: num(m.maxModelAttempts, env.GEMINI_MAX_MODEL_ATTEMPTS),
      circuitFailures: num(m.circuitFailures, env.GEMINI_CIRCUIT_FAILURES),
      circuitCooldownMs: num(m.circuitCooldownMs, env.GEMINI_CIRCUIT_COOLDOWN_MS),
      requestsPerMinute: num(m.requestsPerMinute, env.GEMINI_REQUESTS_PER_MINUTE),
      geminiBaseUrl: str(m.geminiBaseUrl, env.GEMINI_API_BASE_URL).replace(/\/$/, ''),
      deepseekBaseUrl: str(m.deepseekBaseUrl, env.DEEPSEEK_API_BASE_URL).replace(/\/$/, ''),
    },
    regions: {
      mode: r.mode === 'page' || r.mode === 'regions' ? r.mode : env.DETECTION_REGION_MODE,
      cols: num(r.cols, env.DETECTION_REGION_COLS),
      rows: num(r.rows, env.DETECTION_REGION_ROWS),
      overlap: num(r.overlap, env.DETECTION_REGION_OVERLAP),
      catchup: bool(r.catchup, env.DETECTION_REGION_CATCHUP === 'true'),
      dedupeIou: num(r.dedupeIou, env.DETECTION_REGION_DEDUPE_IOU),
      delayMs: num(r.delayMs, env.DETECTION_REGION_DELAY_MS),
      cropMinWidth: num(r.cropMinWidth, env.DETECTION_CROP_MIN_WIDTH),
      cropMaxWidth: num(r.cropMaxWidth, env.DETECTION_CROP_MAX_WIDTH),
    },
    detection: {
      renderScale: num(d.renderScale, env.DETECTION_RENDER_SCALE),
      // null = derive from render scale in the worker.
      pageBatchSize: d.pageBatchSize === undefined || d.pageBatchSize === null
        ? env.PAGE_BATCH_SIZE ?? null
        : num(d.pageBatchSize, env.PAGE_BATCH_SIZE ?? 3),
      skipFeaturesConfidence: num(d.skipFeaturesConfidence, env.DETECTION_SKIP_FEATURES_CONFIDENCE),
      reviewThreshold: num(d.reviewThreshold, env.DETECTION_REVIEW_THRESHOLD),
      penaltyReviewThreshold: num(d.penaltyReviewThreshold, env.DETECTION_PENALTY_REVIEW_THRESHOLD),
      penaltyNoTag: num(d.penaltyNoTag, env.DETECTION_PENALTY_NO_TAG),
      penaltyThinEvidence: num(d.penaltyThinEvidence, env.DETECTION_PENALTY_THIN_EVIDENCE),
      penaltyBboxOversize: num(d.penaltyBboxOversize, env.DETECTION_PENALTY_BBOX_OVERSIZE),
      bboxOversizeUnits: num(d.bboxOversizeUnits, env.DETECTION_BBOX_OVERSIZE_UNITS),
      bboxDegenerateUnits: num(d.bboxDegenerateUnits, env.DETECTION_BBOX_DEGENERATE_UNITS),
      bboxMaxSymbolUnits: num(d.bboxMaxSymbolUnits, env.DETECTION_BBOX_MAX_SYMBOL_UNITS),
      bboxMaxLargeEquipmentUnits: num(d.bboxMaxLargeEquipmentUnits, env.DETECTION_BBOX_MAX_LARGE_EQUIPMENT_UNITS),
      capUnknownConfidence: num(d.capUnknownConfidence, env.DETECTION_CAP_UNKNOWN_CONFIDENCE),
      capOversizedBboxConfidence: num(d.capOversizedBboxConfidence, env.DETECTION_CAP_OVERSIZED_BBOX_CONFIDENCE),
      capDegenerateBboxConfidence: num(d.capDegenerateBboxConfidence, env.DETECTION_CAP_DEGENERATE_BBOX_CONFIDENCE),
      defaultConfidence: num(d.defaultConfidence, env.DETECTION_DEFAULT_CONFIDENCE),
      fieldConfidenceVisionOnly: num(d.fieldConfidenceVisionOnly, env.DETECTION_FIELD_CONFIDENCE_VISION_ONLY),
      fieldConfidenceMainEquipmentVisionOnly: num(d.fieldConfidenceMainEquipmentVisionOnly, env.DETECTION_FIELD_CONFIDENCE_MAIN_EQUIPMENT_VISION_ONLY),
      fieldConfidenceServiceVisionOnly: num(d.fieldConfidenceServiceVisionOnly, env.DETECTION_FIELD_CONFIDENCE_SERVICE_VISION_ONLY),
      fieldConfidenceServiceInferred: num(d.fieldConfidenceServiceInferred, env.DETECTION_FIELD_CONFIDENCE_SERVICE_INFERRED),
      fieldConfidenceMainEquipmentInferred: num(d.fieldConfidenceMainEquipmentInferred, env.DETECTION_FIELD_CONFIDENCE_MAIN_EQUIPMENT_INFERRED),
      fieldConfidenceDescriptionVisionOnly: num(d.fieldConfidenceDescriptionVisionOnly, env.DETECTION_FIELD_CONFIDENCE_DESCRIPTION_VISION_ONLY),
      fieldConfidenceDescriptionInferred: num(d.fieldConfidenceDescriptionInferred, env.DETECTION_FIELD_CONFIDENCE_DESCRIPTION_INFERRED),
      fieldConfidenceMapped: num(d.fieldConfidenceMapped, env.DETECTION_FIELD_CONFIDENCE_MAPPED),
      fieldConfidenceBonus: num(d.fieldConfidenceBonus, env.DETECTION_FIELD_CONFIDENCE_BONUS),
      nullFieldConfidenceThreshold: num(d.nullFieldConfidenceThreshold, env.NULL_FIELD_CONFIDENCE_THRESHOLD),
      nmsIouThreshold: num(d.nmsIouThreshold, env.NMS_IOU_THRESHOLD),
      featureBatchSize: num(d.featureBatchSize, env.FEATURE_BATCH_SIZE),
      maxReferenceCrops: num(d.maxReferenceCrops, 10),
      symbolFeatures: {
        extract: bool(
          isRecord(d.symbolFeatures) ? d.symbolFeatures.extract : undefined,
          env.ENABLE_SYMBOL_FEATURE_EXTRACTION === 'true',
        ),
        embed: bool(
          isRecord(d.symbolFeatures) ? d.symbolFeatures.embed : undefined,
          env.ENABLE_SYMBOL_EMBEDDING === 'true',
        ),
      },
    },
    validator: {
      confidenceThreshold: num(v.confidenceThreshold, env.VALIDATOR_CONFIDENCE_THRESHOLD),
      embeddingSkipThreshold: num(v.embeddingSkipThreshold, env.VALIDATOR_EMBEDDING_SKIP_THRESHOLD),
      embeddingMinSimilarity: num(v.embeddingMinSimilarity, env.VALIDATOR_EMBEDDING_MIN_SIMILARITY),
      ruleScoreHit: num(v.ruleScoreHit, env.VALIDATOR_RULE_SCORE_HIT),
      ruleScoreNeutral: num(v.ruleScoreNeutral, env.VALIDATOR_RULE_SCORE_NEUTRAL),
      legendScoreIsa: num(v.legendScoreIsa, env.VALIDATOR_LEGEND_SCORE_ISA),
      legendScoreIso: num(v.legendScoreIso, env.VALIDATOR_LEGEND_SCORE_ISO),
      legendScoreVerified: num(v.legendScoreVerified, env.VALIDATOR_LEGEND_SCORE_VERIFIED),
      companyBaseScore: num(v.companyBaseScore, env.VALIDATOR_COMPANY_BASE_SCORE),
      companyMaxScore: num(v.companyMaxScore, env.VALIDATOR_COMPANY_MAX_SCORE),
      companyConfirmBonusStep: num(v.companyConfirmBonusStep, env.VALIDATOR_COMPANY_CONFIRM_BONUS_STEP),
      companyConfirmBonusMax: num(v.companyConfirmBonusMax, env.VALIDATOR_COMPANY_CONFIRM_BONUS_MAX),
      companyConfirmBonusEvery: num(v.companyConfirmBonusEvery, env.VALIDATOR_COMPANY_CONFIRM_BONUS_EVERY),
      capConflictConfidence: num(v.capConflictConfidence, env.VALIDATOR_CAP_CONFLICT_CONFIDENCE),
      capUnknownConfidence: num(v.capUnknownConfidence, env.VALIDATOR_CAP_UNKNOWN_CONFIDENCE),
      rejectionPenaltyLow: num(v.rejectionPenaltyLow, env.VALIDATOR_REJECTION_PENALTY_LOW),
      rejectionPenaltyMedium: num(v.rejectionPenaltyMedium, env.VALIDATOR_REJECTION_PENALTY_MEDIUM),
      rejectionPenaltyHigh: num(v.rejectionPenaltyHigh, env.VALIDATOR_REJECTION_PENALTY_HIGH),
      rejectionPenaltyCritical: num(v.rejectionPenaltyCritical, env.VALIDATOR_REJECTION_PENALTY_CRITICAL),
      rejectionTierLowMax: num(v.rejectionTierLowMax, env.VALIDATOR_REJECTION_TIER_LOW_MAX),
      rejectionTierMediumMax: num(v.rejectionTierMediumMax, env.VALIDATOR_REJECTION_TIER_MEDIUM_MAX),
      rejectionTierHighMax: num(v.rejectionTierHighMax, env.VALIDATOR_REJECTION_TIER_HIGH_MAX),
      similarityBands: Array.isArray(v.similarityBands) && v.similarityBands.length > 0
        ? (v.similarityBands as ValidatorTuning['similarityBands'])
        : jsonOr(env.VALIDATOR_SIMILARITY_BANDS_JSON, []),
      spatialMaxProximity: num(v.spatialMaxProximity, env.SPATIAL_MAX_PROXIMITY),
      spatialMaxProximityByType: isRecord(v.spatialMaxProximityByType)
        ? (v.spatialMaxProximityByType as Record<string, number>)
        : jsonOr(env.SPATIAL_MAX_PROXIMITY_JSON, {}),
    },
    fusion: {
      weights: {
        legend: num(isRecord(f.weights) ? f.weights.legend : undefined, 0.45),
        company: num(isRecord(f.weights) ? f.weights.company : undefined, 0.20),
        embedding: num(isRecord(f.weights) ? f.weights.embedding : undefined, 0.15),
        ocr: num(isRecord(f.weights) ? f.weights.ocr : undefined, 0.10),
        rules: num(isRecord(f.weights) ? f.weights.rules : undefined, 0.05),
        vision: num(isRecord(f.weights) ? f.weights.vision : undefined, 0.05),
      },
    },
    performance: {
      legendRegionColsLandscape: num(p.legendRegionColsLandscape, env.LEGEND_REGION_COLS_LANDSCAPE),
      legendRegionColsSquarish: num(p.legendRegionColsSquarish, env.LEGEND_REGION_COLS_SQUARISH),
      legendRegionColsPortrait: num(p.legendRegionColsPortrait, env.LEGEND_REGION_COLS_PORTRAIT),
      legendRegionRows: num(p.legendRegionRows, env.LEGEND_REGION_ROWS),
      legendRegionOverlap: num(p.legendRegionOverlap, env.LEGEND_REGION_OVERLAP),
      legendRenderScale: num(p.legendRenderScale, env.LEGEND_RENDER_SCALE),
      legendCropMinWidth: num(p.legendCropMinWidth, env.LEGEND_CROP_MIN_WIDTH),
      legendCropMaxWidth: num(p.legendCropMaxWidth, env.LEGEND_CROP_MAX_WIDTH),
      legendDedupeIou: num(p.legendDedupeIou, env.LEGEND_DEDUPE_IOU),
      legendDedupeNameIou: num(p.legendDedupeNameIou, env.LEGEND_DEDUPE_NAME_IOU),
      legendRegionDelayMs: num(p.legendRegionDelayMs, env.LEGEND_REGION_DELAY_MS),
      legendErrorDelayMs: num(p.legendErrorDelayMs, env.LEGEND_ERROR_DELAY_MS),
      cropExpandMinUnits: num(p.cropExpandMinUnits, env.CROP_EXPAND_MIN_UNITS),
      cropExpandMaxUnits: num(p.cropExpandMaxUnits, env.CROP_EXPAND_MAX_UNITS),
      cropExpandRatio: num(p.cropExpandRatio, env.CROP_EXPAND_RATIO),
      uploadMaxPdfMb: num(p.uploadMaxPdfMb, env.UPLOAD_MAX_PDF_MB),
      rateLimitDocumentUploads: num(p.rateLimitDocumentUploads, env.RATE_LIMIT_DOCUMENT_UPLOADS_PER_MIN),
      rateLimitLegendUploads: num(p.rateLimitLegendUploads, env.RATE_LIMIT_LEGEND_UPLOADS_PER_MIN),
      rateLimitDetectionTriggers: num(p.rateLimitDetectionTriggers, env.RATE_LIMIT_DETECTION_TRIGGERS_PER_MIN),
      workerRecoveryDelayMs: num(p.workerRecoveryDelayMs, env.WORKER_RECOVERY_DELAY_MS),
      workerPrewarmDelayMs: num(p.workerPrewarmDelayMs, env.WORKER_PREWARM_DELAY_MS),
      workerConcurrency: pos(p.workerConcurrency, env.WORKER_CONCURRENCY),
      workerLockRenewTimeMs: pos(p.workerLockRenewTimeMs, env.WORKER_LOCK_RENEW_TIME_MS),
      workerLockDurationMs: pos(p.workerLockDurationMs, env.WORKER_LOCK_DURATION_MS),
      workerStalledIntervalMs: pos(p.workerStalledIntervalMs, env.WORKER_STALLED_INTERVAL_MS),
      workerMaxStalledCount: num(p.workerMaxStalledCount, env.WORKER_MAX_STALLED_COUNT),
      verifierTimeoutMs: num(p.verifierTimeoutMs, env.VERIFIER_TIMEOUT_MS),
      verifierCacheMaxEntries: num(p.verifierCacheMaxEntries, env.VERIFIER_CACHE_MAX_ENTRIES),
      verifierMaxCallsPerPage: num(p.verifierMaxCallsPerPage, env.VERIFIER_MAX_CALLS_PER_PAGE),
      embeddingModel: str(p.embeddingModel, env.EMBEDDING_MODEL),
      embeddingModelFallbacks: strList(p.embeddingModelFallbacks, csv(env.EMBEDDING_MODEL_FALLBACKS)),
      embeddingDimensions: num(p.embeddingDimensions, env.EMBEDDING_DIMENSIONS),
      embeddingRequestDelayMs: num(p.embeddingRequestDelayMs, env.EMBEDDING_REQUEST_DELAY_MS),
    },
  };
}

// ── Cached accessor ──────────────────────────────────────────────────────────

const TTL_MS = 30_000;
let cache: { tuning: Tuning; at: number } | null = null;
let loadPromise: Promise<Tuning> | null = null;

/**
 * Resolve tuning for this request.
 *
 * Cached for 30s so a 20-page job does not hit the settings table per page,
 * while a Settings save still takes effect almost immediately.
 * DB failures are non-fatal: env/values are used, never a crash.
 */
export async function getTuning(opts?: { force?: boolean }): Promise<Tuning> {
  if (!opts?.force && cache && Date.now() - cache.at < TTL_MS) return cache.tuning;
  // Collapse concurrent first-loads (the worker resolves tuning per page).
  if (!opts?.force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    let overrides: TuningOverrides = {};
    try {
      const { pool } = await import('@/lib/db');
      const r = await pool.query('SELECT tuning FROM settings WHERE id = 1');
      const raw = r.rows[0]?.tuning;
      if (isRecord(raw)) overrides = raw as TuningOverrides;
    } catch {
      // Settings table missing (pre-migration) or DB down → env values only.
    }
    const tuning = buildTuning(overrides);
    cache = { tuning, at: Date.now() };
    return tuning;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function clearTuningCache(): void {
  cache = null;
}
