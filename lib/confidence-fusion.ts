/**
 * Confidence Fusion Engine
 *
 * Calculates final detection confidence from multiple evidence sources.
 * Each source contributes independently with configurable weights.
 *
 * Default weights:
 *   Legend         45%
 *   Company KB     20%
 *   Embedding      15%
 *   OCR Validation 10%
 *   Rule Engine     5%
 *   Vision AI       5%
 */

export interface FusionWeights {
  legend: number;
  company: number;
  embedding: number;
  ocr: number;
  rules: number;
  vision: number;
}

export const DEFAULT_WEIGHTS: FusionWeights = {
  legend: 0.45,
  company: 0.20,
  embedding: 0.15,
  ocr: 0.10,
  rules: 0.05,
  vision: 0.05,
};

/** Similarity → score bands; overridden by VALIDATOR_SIMILARITY_BANDS_JSON. */
export const DEFAULT_SIMILARITY_BANDS = [
  { min: 0.95, score: 1.0 },
  { min: 0.85, score: 0.8 },
  { min: 0.75, score: 0.6 },
  { min: 0.65, score: 0.4 },
];

/** Score for a similarity below every configured band. */
export const SIMILARITY_FLOOR_SCORE = 0.2;

/**
 * Phase 4: env override untuk tuning tanpa ubah kode.
 * Contoh: FUSION_WEIGHTS_JSON='{"legend":0.5,"vision":0.05,...}'
 * Nilai dinormalisasi ulang di fuseConfidence, jadi cukup proporsional.
 * Resolution: `tuning.fusion.weights` (Settings → .env → literal default below).
 */
export function getFusionWeights(): FusionWeights {
  const raw = process.env.FUSION_WEIGHTS_JSON;
  if (!raw) return DEFAULT_WEIGHTS;
  try {
    const p = JSON.parse(raw) as Partial<FusionWeights>;
    const w: FusionWeights = { ...DEFAULT_WEIGHTS };
    (Object.keys(DEFAULT_WEIGHTS) as (keyof FusionWeights)[]).forEach((k) => {
      const v = p[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) w[k] = v;
    });
    return w;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

export interface EvidenceScores {
  legend: number | null;    // 0-1, null = not applicable
  company: number | null;
  embedding: number | null;
  ocr: number | null;
  rules: number | null;
  vision: number | null;
}

export interface FusionResult {
  confidence: number;
  confidence_breakdown: {
    legend: number;
    company: number;
    embedding: number;
    ocr: number;
    rules: number;
    vision: number;
  };
  active_sources: string[];
  weights_used: FusionWeights;
}

/**
 * Fuse multiple evidence scores into a single confidence value.
 *
 * Algorithm:
 * 1. For each source with a non-null score, compute weighted contribution.
 * 2. Re-normalize weights for only active sources (so they sum to 1.0).
 * 3. Final confidence = sum of (normalized_weight * score) for active sources.
 *
 * This ensures confidence is never artificially deflated by missing sources.
 */
export function fuseConfidence(
  scores: EvidenceScores,
  weights: FusionWeights = DEFAULT_WEIGHTS
): FusionResult {
  const sources = Object.keys(scores) as (keyof EvidenceScores)[];
  const active = sources.filter(k => scores[k] !== null);

  if (active.length === 0) {
    return {
      confidence: 0,
      confidence_breakdown: { legend: 0, company: 0, embedding: 0, ocr: 0, rules: 0, vision: 0 },
      active_sources: [],
      weights_used: weights,
    };
  }

  // Sum of weights for active sources
  const activeWeightSum = active.reduce((sum, k) => sum + weights[k], 0);

  const breakdown = { legend: 0, company: 0, embedding: 0, ocr: 0, rules: 0, vision: 0 };
  let totalConfidence = 0;

  for (const k of active) {
    const score = scores[k] as number;
    // Normalize weight so active sources sum to 1.0
    const normalizedWeight = weights[k] / activeWeightSum;
    const contribution = normalizedWeight * score;
    breakdown[k] = parseFloat(contribution.toFixed(4));
    totalConfidence += contribution;
  }

  return {
    confidence: parseFloat(Math.min(1, Math.max(0, totalConfidence)).toFixed(4)),
    confidence_breakdown: breakdown,
    active_sources: active,
    weights_used: weights,
  };
}

/**
 * Quick helper: compute OCR validation score.
 * Checks if assetTag appears in OCR text.
 *
 * Semantics:
 *   null  = OCR unavailable OR tag not found → fusion ignores this source entirely
 *   0.7   = prefix match → weak positive (tag family present in OCR)
 *   1.0   = exact match → strong positive evidence
 *
 * M8/M11: Previously returned 0.0 when tag not found in OCR. This caused confidence
 * fusion to treat OCR as an active source with score=0, dragging legend confidence
 * (~0.95) down to ~0.82 even for valid detections where small tags simply weren't
 * extracted by OCR. Returning null instead marks the source as inactive — fusion
 * re-normalizes over remaining active sources and confidence is preserved.
 * True contradiction (a different conflicting tag) is handled by TagConflict logic
 * in rule-validator.ts step 9, not here.
 */
export function computeOcrScore(assetTag: string | null, ocrText: string | undefined): number | null {
  // null = OCR unavailable → fusion ignores this source entirely
  if (!assetTag || !ocrText) return null;
  const upper = ocrText.toUpperCase();
  const tag = assetTag.toUpperCase();
  // M8: degenerate tags (e.g. 'P-') carry no information — a bare 'P-' prefix
  // is a substring of almost any tag-bearing text ('P-101 pump' includes 'P-').
  // Require ≥2 alphanumerics before any matching to avoid false positives.
  if (tag.replace(/[^A-Z0-9]/g, '').length < 2) return null;
  // Exact match → strong positive evidence
  if (upper.includes(tag)) return 1.0;
  // Prefix match → weak positive evidence (tag family present).
  // Require prefix.length >= 2 to avoid false positives from single-letter prefixes
  // like 'P' matching 'PIPE', 'PRESSURE', etc. in OCR text.
  const prefix = tag.split('-')[0];
  if (prefix && prefix.length >= 2 && upper.includes(prefix)) return 0.7;
  // Tag not found in OCR → treat as unavailable (null), not contradiction.
  return null;
}

/**
 * Convert embedding similarity (0-1) to an evidence score.
 *
 * Bands are tuning (`validator.similarityBands`, Settings → .env → fallback).
 * Ordered high → low; the first band whose `min` is met wins. A similarity below
 * every band falls to `floorScore`, so the result is always finite.
 */
export function embeddingSimilarityToScore(
  similarity: number,
  bands?: { min: number; score: number }[],
): number {
  const list = (bands ?? getSimilarityBands()).filter(
    (b) => b && Number.isFinite(b.min) && Number.isFinite(b.score),
  );
  if (list.length === 0) return 0;
  const ordered = [...list].sort((a, b) => b.min - a.min);
  for (const band of ordered) {
    if (similarity >= band.min) return Math.max(0, Math.min(1, band.score));
  }
  return SIMILARITY_FLOOR_SCORE;
}

/** Env-layer similarity bands, for synchronous callers without resolved tuning. */
export function getSimilarityBands(): { min: number; score: number }[] {
  const raw = process.env.VALIDATOR_SIMILARITY_BANDS_JSON;
  if (!raw) return DEFAULT_SIMILARITY_BANDS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_SIMILARITY_BANDS;
  } catch {
    return DEFAULT_SIMILARITY_BANDS;
  }
}

/**
 * Convert rule engine result (penalty/bonus) to evidence score.
 * Input: rulePassed (0-1 ratio of required rules passed), bonusPenalty (net ±)
 */
export function ruleResultToScore(rulePassed: number, bonusPenalty: number): number {
  return Math.max(0, Math.min(1, rulePassed + bonusPenalty));
}
