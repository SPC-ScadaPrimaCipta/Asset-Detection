/**
 * AI Detection Agent — Gemini Vision per page.
 *
 * Pipeline per page:
 *   Step 1: Gemini Vision detects symbols (symbol-detector prompt)
 *   Step 2: Rule Validator resolves each detection via priority chain
 *            Legend > Company KB > ISA > ISO > Vision > UNKNOWN
 *   Step 3: Calibrate confidence + apply UNKNOWN threshold
 *
 * Result: structured detections with detection_source, resolved names, calibrated confidence.
 *
 * Provider/model resolution, generation config, retry and JSON salvage are the
 * SAME helpers Scan Legend uses (lib/legend-extract.ts). No OCR, no OpenCV, no
 * tiling: the rendered page PNG is the only model input.
 */

import type { Part } from "@google/generative-ai";
import { getAiConfig } from "@/lib/ai-config";
import { resolveGeminiModels } from "@/lib/model-resolver";
import {
  isProviderUnavailable,
  getSharedModelBreaker,
} from "@/lib/ai-circuit-breaker";
import { getSharedGeminiGate } from "@/lib/gemini-request-gate";
import { callWithRetry, isJsonModeIncompatible } from "@/lib/legend-extract";
import { generationConfigFrom, getGenerationConfig } from "@/lib/ai-generation";
import { buildSymbolDetectorPrompt, buildRegionSymbolDetectorPrompt } from "@/lib/ai-prompts/symbol-detector";
import { buildRuleValidatorPrompt } from "@/lib/ai-prompts/rule-validator-prompt";
import { PageDetectionSchema } from "@/lib/ai-schemas";
import type { Detection } from "@/lib/ai-schemas";
import {
  validateDetection,
  extractTagPrefix,
  type LegendSymbol,
  type DetectionSource,
  type RuleValidationResult,
} from "@/lib/rule-validator";
import { DetectionAudit } from "@/lib/detection-audit";
import { imageToCanonical, type SymbolFeatures } from "@/lib/feature-extractor";
import { embedCanonical } from "@/lib/embedding-service";
import { hashImage } from "@/lib/symbol-cache";
import { cropPageRegion, adaptiveExpandBBox } from "@/lib/image-crop";
import { getTuning, buildTuning, type DetectionTuning } from "@/lib/tuning";
import { env } from "@/lib/env";
import {
  buildRegions,
  gridForAspect,
  mapRegionBboxToPage,
  bboxIou1000,
} from "@/lib/detection/region/region-plan";
import { cropAllRegions } from "@/lib/detection/region/region-crop";

export interface DetectionJobInput {
  page: number;
  /** Full-page PNG (0-1000 bbox space). Required — no PDF/file-URI fallback. */
  pageImageBase64: string;
  legendId: string;
  /**
   * Symbols merged from up to 3 legends, in priority order. Each element may
   * carry `sourceLegendName`/`sourcePriority` (set by mergeLegendSymbols in
   * lib/job-legends.ts); the prompt groups by source when several are present.
   */
  legendSymbols: Array<
    LegendSymbol & { sourceLegendName?: string | null; sourcePriority?: number | null }
  >;
  pngWidth?: number;
  pngHeight?: number;
  projectId?: string | null;
  drawingType?: string | null; // e.g. 'P&ID', 'PFD', 'ISOMETRIC' — inferred from filename
  /**
   * Reference crop images for legend symbols, keyed by symbol id.
   * Base64-encoded PNG. Sent to Gemini as inlineData parts alongside the page image
   * so the model can visually match symbols against these examples.
   * Max ~10 entries; missing entries are silently skipped.
   */
  referenceCrops?: Map<string, string>;
}

// Extended detection result with rule validation metadata + embedding data
export interface ResolvedDetection extends Detection {
  detection_source: DetectionSource;
  rule_applied: string;
  resolved_asset_name: string;
  // Knowledge-First fields — populated during detection, stored to DB
  image_hash: string | null;
  canonical_features: string | null;
  symbol_embedding: number[] | null;
  symbol_features: SymbolFeatures | null;
  confidence_breakdown: Record<string, number>;
  // Audit trail — populated by rule-validator, persisted to detection_audit_trail by worker
  audit: DetectionAudit | null;
  // F5/F8: validation_status — explicit field-level quality flag
  // VALID: all evidence consistent, high-confidence fields
  // NEEDS_REVIEW: low-evidence field (service/mainEquipment from Vision only, no OCR support)
  // CONFLICT: Vision type contradicts OCR tag prefix
  validation_status: "VALID" | "NEEDS_REVIEW" | "CONFLICT";
  // G2: per-field confidence scores — null means evidence not available for that field
  field_confidence: {
    tag: number | null;
    type: number | null;
    service: number | null;
    mainEquipment: number | null;
    description: number | null;
  };
  // G3: per-field provenance — source + normalization trace per metadata field
  field_provenance: {
    tag: {
      source: string;
      normalized: boolean;
      correctionReason: string | null;
    } | null;
    type: { source: string; inferred: boolean } | null;
    service: { source: string; inferred: boolean } | null;
    mainEquipment: { source: string; inferred: boolean } | null;
    description: { source: string; inferred: boolean } | null;
  };
}

export interface ResolvedPageDetection {
  page: number;
  detections: ResolvedDetection[];
}

// Model candidates resolved dynamically from Gemini API at runtime via resolveGeminiModels().
// No hardcoded list - system auto-discovers valid models for the configured API key.

/**
 * Local, API-free crop hash for one detection.
 *
 * Used when the per-detection Gemini feature path is disabled (default): the
 * crop is still produced locally so `image_hash` remains a stable per-symbol
 * fingerprint for duplicate detection and the confirm-time symbol cache —
 * without spending a generateContent call per detection.
 */
async function hashCropBBox(
  input: DetectionJobInput,
  bbox: Detection["bbox"],
): Promise<string | null> {
  try {
    const cropBase64 = await cropPageRegion(
      input.pageImageBase64,
      adaptiveExpandBBox(bbox),
      input.pngWidth!,
      input.pngHeight!,
      0.0,
    );
    return cropBase64 ? hashImage(cropBase64) : null;
  } catch {
    return null;
  }
}


/**
 * Env-layer `detection` tuning, for synchronous callers that have not resolved
 * tuning (tests, one-off scripts). Production passes the resolved slice.
 */
function envDetectionTuning(): DetectionTuning {
  return buildTuning().detection;
}

export async function runDetectionAgent(
  input: DetectionJobInput,
): Promise<ResolvedPageDetection> {
  const cfg = await assertVisionModelUsable();

  // Step 1: Vision detection — one page, or a sweep of overlapping regions.
  const rawDetections = await collectRawDetections(input, cfg);

  // Step 2 + 3: rule validation, field metadata, confidence calibration.
  return { page: input.page, detections: await resolveDetections(input, rawDetections) };
}

/** Provider/key guard. DeepSeek is text-only, so images need a vision provider. */
async function assertVisionModelUsable() {
  const cfg = await getAiConfig();
  if (cfg.provider === "deepseek") {
    throw new Error(
      "DeepSeek cannot analyse images — switch provider to Gemini, OpenAI, or Anthropic in Settings",
    );
  }
  if (cfg.provider === "gemini" && !cfg.geminiKey) {
    throw new Error(
      "GEMINI_API_KEY not configured — set in Settings page or .env.local",
    );
  }
  if (cfg.provider === "openai" && !cfg.openaiKey) {
    throw new Error(
      "OPENAI_API_KEY not configured — set in Settings page or .env.local",
    );
  }
  if (cfg.provider === "anthropic" && !cfg.anthropicKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured — set in Settings page or .env.local",
    );
  }
  return cfg;
}

/**
 * Few-shot symbol names, drawn round-robin across legends.
 *
 * A plain first-5 slice would only ever show the primary legend; round-robin
 * gives each selected legend at least one example so the model learns every
 * legend's naming style.
 */
function legendReferenceExamples(input: DetectionJobInput) {
  const symbols = input.legendSymbols ?? [];
  const bySource = new Map<string, typeof symbols>();
  for (const s of symbols) {
    const key = s.sourceLegendName ?? '\0single';
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(s);
  }
  const groups = [...bySource.values()];
  const picked: typeof symbols = [];
  for (let i = 0; picked.length < 5; i++) {
    let added = false;
    for (const g of groups) {
      if (g[i] && picked.length < 5) {
        picked.push(g[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked.map((s) => ({
    asset_type: s.asset_type,
    symbol_name: s.symbol_name ?? null,
    tag_pattern: s.tag_pattern ?? null,
  }));
}

/**
 * Merge duplicates produced by overlapping regions.
 *
 * A symbol sitting inside the region overlap is reported by two regions with
 * slightly different boxes. They are the same asset, so the higher-confidence
 * detection wins and the evidence of both is kept — losing the evidence would
 * hide the fact that two independent reads agreed.
 *
 * `iouThreshold` defaults to the env value; the region sweep passes the resolved
 * tuning value so a Settings change applies immediately.
 */
export function dedupeRegionDetections(
  detections: Detection[],
  iouThreshold = env.DETECTION_REGION_DEDUPE_IOU,
): Detection[] {
  const kept: Detection[] = [];

  /**
   * Fuzzy type match for untagged detections.
   * Handles slight naming differences ("Pressure Transmitter" vs
   * "Differential Pressure Transmitter") from overlapping region passes.
   */
  const typeNorm = (t: string) => t.toLowerCase().trim();
  const typesOverlap = (a: string, b: string): boolean => {
    const na = typeNorm(a);
    const nb = typeNorm(b);
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const wa = na.split(' ')[0];
    const wb = nb.split(' ')[0];
    return wa.length > 2 && wa === wb;
  };

  for (const d of detections) {
    const tag = (d.assetTag ?? "").toUpperCase().trim();
    const type = (d.assetType ?? "").toLowerCase();
    const dupIdx = kept.findIndex((k) => {
      const kTag = (k.assetTag ?? "").toUpperCase().trim();
      const kType = (k.assetType ?? "").toLowerCase();
      const sameTag = tag !== "" && kTag !== "" && tag === kTag;
      // Untagged: fuzzy type match + looser IoU (0.7× threshold)
      // because dense instrument clusters are tight and type names drift
      // slightly between region passes.
      const sameUntaggedType =
        tag === "" && kTag === "" &&
        type !== "" && kType !== "" &&
        typesOverlap(type, kType);
      if (!sameTag && !sameUntaggedType) return false;
      // Untagged: use 0.85× threshold (was 0.70×). Higher multiplier reduces
      // false deduplication of genuinely distinct small symbols that share the
      // same type and sit close together (e.g. two adjacent gate valves).
      const effectiveThreshold = sameUntaggedType && !sameTag
        ? iouThreshold * 0.85
        : iouThreshold;
      const iou = bboxIou1000(k.bbox, d.bbox);
      if (iou > effectiveThreshold) return true;

      // Small symbol proximity check: region border splits and overlapping passes
      // can produce slight coordinate offsets on tiny symbols.
      const dist = Math.hypot(
        k.bbox.x + k.bbox.width / 2 - (d.bbox.x + d.bbox.width / 2),
        k.bbox.y + k.bbox.height / 2 - (d.bbox.y + d.bbox.height / 2),
      );
      const ix0 = Math.max(k.bbox.x, d.bbox.x);
      const iy0 = Math.max(k.bbox.y, d.bbox.y);
      const ix1 = Math.min(k.bbox.x + k.bbox.width, d.bbox.x + d.bbox.width);
      const iy1 = Math.min(k.bbox.y + k.bbox.height, d.bbox.y + d.bbox.height);
      const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
      const minArea = Math.min(k.bbox.width * k.bbox.height, d.bbox.width * d.bbox.height);
      const containment = minArea > 0 ? inter / minArea : 0;

      // True duplicate symbols across overlapping passes have nearly coincident centers.
      // Do not suppress adjacent distinct symbols (e.g. block valve + drain valve on drop leg).
      return (containment >= 0.80 && dist <= 8) || (dist <= 5 && (containment >= 0.50 || iou >= 0.25));
    });

    if (dupIdx === -1) {
      kept.push(d);
      continue;
    }
    const winner = kept[dupIdx];
    const evidence = [...(winner.evidence ?? []), ...(d.evidence ?? [])];
    if ((d.confidence ?? 0) > (winner.confidence ?? 0)) {
      kept[dupIdx] = { ...d, evidence };
    } else {
      winner.evidence = evidence;
    }
  }
  return kept;
}

/**
 * Step 1 — get raw detections for one page.
 *
 * `page` mode: one call on the full page.
 * `regions` mode: overlapping upscaled crops, then a full-page catch-up sweep.
 * The catch-up pass matters because a symbol straddling a region border can be
 * reported as a fragment by both neighbours, or missed if the grid splits it
 * awkwardly; a whole-page read is good at finding outliers even if its bounding
 * boxes are looser.
 */
async function collectRawDetections(
  input: DetectionJobInput,
  cfg: Awaited<ReturnType<typeof getAiConfig>>,
): Promise<Detection[]> {
  const referenceExamples = legendReferenceExamples(input);
  const hasReferenceCrops = !!(input.referenceCrops && input.referenceCrops.size > 0);
  const fullPagePrompt = () =>
    buildSymbolDetectorPrompt(input.legendSymbols, { referenceExamples, hasReferenceCrops });

  const tuning = await getTuning();
  const regionsCfg = tuning.regions;

  if (regionsCfg.mode === "page") {
    const raw = await callWithRetry(
      () => runWithVisionProvider(cfg, input, fullPagePrompt()),
      { label: `detection page ${input.page}` },
    );
    return raw.detections;
  }

  const { cols, rows } = resolveGrid(input, regionsCfg);
  const regions = buildRegions(cols, rows, regionsCfg.overlap);
  const pngBuffer = Buffer.from(input.pageImageBase64, "base64");
  const crops = await cropAllRegions(pngBuffer, regions, {
    minWidth: regionsCfg.cropMinWidth,
    maxWidth: regionsCfg.cropMaxWidth,
  });

  if (crops.length === 0) {
    // Cropping failed (e.g. sharp unavailable) — degrade to the whole page
    // rather than losing the page entirely.
    console.warn(
      `[detection] page ${input.page} region crop produced 0 images — falling back to full page`,
    );
    const raw = await callWithRetry(
      () => runWithVisionProvider(cfg, input, fullPagePrompt()),
      { label: `detection page ${input.page} (full-page fallback)` },
    );
    return raw.detections;
  }

  const collected: Detection[] = [];
  let failed = 0;
  for (let i = 0; i < crops.length; i++) {
    const crop = crops[i];
    const prompt = buildRegionSymbolDetectorPrompt(
      input.legendSymbols,
      crop.region.label,
      { referenceExamples, hasReferenceCrops },
    );
    try {
      const raw = await callWithRetry(
        () =>
          runWithVisionProvider(cfg, input, prompt, {
            pngBase64: crop.pngBase64,
            regionLabel: crop.region.label,
          }),
        { label: `page ${input.page} region ${i + 1}/${crops.length}` },
      );
      for (const d of raw.detections) {
        collected.push({
          ...d,
          // Region-local 0-1000 → page 0-1000, or the viewer overlay breaks.
          bbox: mapRegionBboxToPage(d.bbox, crop.region),
          evidence: [...(d.evidence ?? []), `Region ${crop.region.label}`],
        });
      }
    } catch (e: unknown) {
      // One bad region must not lose the page: the remaining regions plus the
      // catch-up pass still cover it, and the count is logged.
      failed++;
      console.warn(
        `[detection] page ${input.page} region ${crop.region.label} failed: ${
          e instanceof Error ? e.message.slice(0, 160) : String(e)
        }`,
      );
    }
    if (i < crops.length - 1 && regionsCfg.delayMs > 0) {
      await sleep(regionsCfg.delayMs);
    }
  }

  if (regionsCfg.catchup) {
    try {
      const raw = await callWithRetry(
        () => runWithVisionProvider(cfg, input, fullPagePrompt()),
        { label: `detection page ${input.page} catch-up` },
      );
      // Pre-filter: skip catch-up detections already covered by a region pass.
      // Avoids O(n²) bloat in dedupeRegionDetections for dense pages and
      // prevents the same symbol entering the DB as two rows when dedupe
      // misses a near-duplicate (e.g. slightly different bbox from full-page
      // vs region coordinate systems).
      let catchupNew = 0;
      for (const d of raw.detections) {
        const tag = (d.assetTag ?? '').toUpperCase().trim();
        const covered = collected.some((e) => {
          if (tag !== '' && tag === (e.assetTag ?? '').toUpperCase().trim()) return true;
          return bboxIou1000(e.bbox, d.bbox) > regionsCfg.dedupeIou;
        });
        if (covered) continue;
        catchupNew++;
        collected.push({
          ...d,
          evidence: [...(d.evidence ?? []), "Full-page catch-up pass"],
        });
      }
      console.log(
        `[detection] page ${input.page} catch-up: ${raw.detections.length} raw, ${catchupNew} new`,
      );
    } catch (e: unknown) {
      console.warn(
        `[detection] page ${input.page} catch-up failed (non-fatal): ${
          e instanceof Error ? e.message.slice(0, 160) : String(e)
        }`,
      );
    }
  }

  const before = collected.length;
  const deduped = dedupeRegionDetections(collected, regionsCfg.dedupeIou);
  console.log(
    `[detection] page ${input.page} regions=${crops.length} failed=${failed} ` +
      `raw=${before} deduped=${deduped.length}`,
  );
  if (failed === crops.length && deduped.length === 0) {
    throw new Error(
      `All ${crops.length} region(s) failed and no detections were recovered`,
    );
  }
  return deduped;
}

/**
 * Configured grid, or one derived from the page aspect ratio when cols/rows are
 * both 0. The fallback grid is a literal because it is the last resort when the
 * rendered dimensions are also unknown.
 */
function resolveGrid(
  input: DetectionJobInput,
  regionsCfg: { cols: number; rows: number },
): { cols: number; rows: number } {
  const { cols, rows } = regionsCfg;
  if (cols > 0 && rows > 0) return { cols, rows };
  if (input.pngWidth && input.pngHeight) {
    return gridForAspect(input.pngWidth, input.pngHeight);
  }
  return { cols: 2, rows: 2 };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Steps 2 and 3 — rule validation, per-field metadata, confidence calibration.
 * Split out so both the region sweep and the full-page pass share one
 * implementation.
 */
async function resolveDetections(
  input: DetectionJobInput,
  rawDetections: Detection[],
): Promise<ResolvedDetection[]> {
  const tuning = await getTuning();
  const det = tuning.detection;

  // Rule validation runs per detection. Batched so a dense page does not issue
  // one serial call per symbol.
  const FEATURE_BATCH_SIZE = det.featureBatchSize;

  // Per-symbol async work: crop → hash → feature extract → embed → validate
  async function processOneDetection(d: Detection): Promise<ResolvedDetection> {
    const tagPrefix = extractTagPrefix(d.assetTag);

    // ── Feature extraction + embedding (best-effort, non-blocking) ─────────
    let imageHash: string | null = null;
    let canonicalFeatures: string | null = null;
    let symbolEmbedding: number[] | null = null;
    let symbolFeatures: SymbolFeatures | null = null;

    // Per-detection Gemini calls (structured feature extraction + embedding) are
    // OFF by default. Each one costs an extra generateContent call per detection,
    // so a 19-symbol page issued 38 extra requests: that exhausts the Gemini
    // free tier (15 RPM → 429) and pushed a single page to ~106s, violating
    // FR-JOB-008 (rate limit) and NFR-001 (≤120s/page).
    //
    // Detection quality does not depend on them: the PRD takes confidence from
    // Gemini's own symbol/tag/matching scores and validates via Legend symbol
    // codes, tag regex, bbox and duplicate checks. Enable
    // `detection.symbolFeatures.extract` only with quota headroom and when
    // `canonical_features` / embeddings are actually consumed downstream.
    const wantSymbolFeatures = det.symbolFeatures.extract;
    const wantEmbedding = det.symbolFeatures.embed;
    const skipFeatures = !wantSymbolFeatures || d.confidence >= det.skipFeaturesConfidence;

    if (
      !skipFeatures &&
      input.pageImageBase64 &&
      input.pngWidth &&
      input.pngHeight
    ) {
      try {
        // M2: Use adaptive expansion — small symbols get smaller pad (less noise),
        // large symbols get proportionally larger pad. Min 20, max 80 units.
        const expandedBbox = adaptiveExpandBBox(d.bbox);
        const cropBase64 = await cropPageRegion(
          input.pageImageBase64,
          expandedBbox,
          input.pngWidth,
          input.pngHeight,
          0.0, // padFraction=0 here since adaptiveExpandBBox already expanded
        );

        if (cropBase64) {
          imageHash = hashImage(cropBase64);

          const extracted = await imageToCanonical(cropBase64);
          if (extracted) {
            canonicalFeatures = extracted.canonical;
            symbolFeatures = extracted.features;
            // Embedding is a separate opt-in: the current gemini-embedding-001
            // emits 3072 dims while the DB column is vector(768), so it fails
            // dimension validation on every call.
            if (wantEmbedding) {
              const embResult = await embedCanonical(extracted.canonical);
              if (embResult) {
                symbolEmbedding = embResult.embedding;
              }
            }
          }
        } else {
          console.warn(
            `[features] crop returned null for ${d.assetTag ?? d.assetType} bbox=${JSON.stringify(d.bbox)}`,
          );
        }
      } catch (featureErr) {
        console.warn(
          `[features] extraction failed for ${d.assetTag ?? d.assetType}:`,
          featureErr instanceof Error ? featureErr.message : featureErr,
        );
      }
    } else if (input.pageImageBase64) {
      // Feature path disabled (default) or png dims missing.
      // imageHash stays LOCAL (sha256 of the crop) — no API call, still feeds
      // dedup and the confirm-time symbol cache.
      imageHash = input.pngWidth && input.pngHeight
        ? await hashCropBBox(input, d.bbox)
        : hashImage(input.pageImageBase64);
    }

    let validation: RuleValidationResult;
    try {
      validation = await validateDetection({
        tagPrefix,
        detectedAssetType: d.assetType,
        detectedAssetTag: d.assetTag ?? null,
        aiConfidence: d.confidence,
        legendId: input.legendId,
        legendSymbols: input.legendSymbols,
        projectId: input.projectId ?? null,
        // No OCR in this pipeline — rule validator's OCR branch stays inactive.
        imageHash,
        cropHash: imageHash,
        symbolEmbedding,
        canonicalFeatures,
        symbolFeatures: symbolFeatures as Record<string, unknown> | null,
        drawingType: input.drawingType ?? null,
      });
    } catch (err) {
      console.warn(
        `[rule-validator] failed for ${d.assetTag ?? d.assetType}:`,
        err,
      );
      validation = {
        source: "VISION",
        resolvedAssetType: d.assetType,
        resolvedAssetName: d.assetType,
        tagPrefix,
        confidence: d.confidence,
        confidenceBreakdown: {
          legend: 0,
          company: 0,
          embedding: 0,
          ocr: 0,
          rules: 0,
          vision: d.confidence,
        },
        ruleApplied: "Rule validation error — fallback to Vision result",
        audit: null as never,
      };
    }

    // Step 3: Resolve final asset type.
    // When source=LEGEND, prefer resolvedAssetName (exact symbol_name from the
    // legend row) over resolvedAssetType (which may be the generic category).
    // This ensures the displayed component name always matches the legend exactly,
    // e.g. "Pressure Differential Transmitter" instead of "Instrument".
    // For all other sources keep resolvedAssetType as before.
    const finalAssetType =
      validation.source === "UNKNOWN"
        ? "UNKNOWN"
        : validation.source === "LEGEND" && validation.resolvedAssetName
          ? validation.resolvedAssetName
          : validation.resolvedAssetType;
    const finalConfidence = validation.confidence;

    // Fix #7: Legend quality feedback.
    // When detection resolves to UNKNOWN and a legend is selected, log a miss
    // to legend_symbols.quality_reasons so users can see which legend crops
    // are failing to match. Fire-and-forget — never blocks detection.
    if (validation.source === "UNKNOWN" && imageHash && input.legendId && input.legendSymbols.length > 0) {
      const firstWord = (d.assetType ?? '').split(' ')[0];
      const missEntry = JSON.stringify([{
        reason: 'detection_miss',
        assetType: d.assetType,
        tag: d.assetTag ?? null,
        confidence: d.confidence,
        ts: new Date().toISOString(),
      }]);
      setImmediate(async () => {
        try {
          const { default: dbPool } = await import('@/lib/db');
          await dbPool.query(
            `UPDATE legend_symbols
                SET quality_reasons = COALESCE(quality_reasons, '[]'::jsonb) || $1::jsonb
              WHERE legend_id = $2
                AND asset_type ILIKE $3
                AND crop_file IS NOT NULL
                AND quality_status IS DISTINCT FROM 'rejected'
              LIMIT 1`,
            [missEntry, input.legendId, `%${firstWord}%`],
          );
        } catch {
          // silent — logging failure must never break detection
        }
      });
    }

    // F5: Compute validation_status
    const ruleText = validation.ruleApplied ?? "";
    const hasConflict =
      ruleText.includes("CONFLICT") || ruleText.includes("conflict");
    const isUnknown = validation.source === "UNKNOWN";
    const isVisionOnly = validation.source === "VISION";
    const serviceIsVisionOnly =
      isVisionOnly && !!(d as Record<string, unknown>).service;
    const mainEqIsVisionOnly =
      isVisionOnly && !!(d as Record<string, unknown>).mainEquipment;
    const hasLowEvidenceField = serviceIsVisionOnly || mainEqIsVisionOnly;

    let validationStatus: "VALID" | "NEEDS_REVIEW" | "CONFLICT";
    if (hasConflict) {
      validationStatus = "CONFLICT";
    } else if (isUnknown || hasLowEvidenceField || finalConfidence < det.reviewThreshold) {
      validationStatus = "NEEDS_REVIEW";
    } else {
      validationStatus = "VALID";
    }

    // G2: Per-field confidence scores
    const tagVal = (d as Record<string, unknown>).assetTag as string | null;
    const serviceVal = (d as Record<string, unknown>).service as string | null;
    const mainEqVal = (d as Record<string, unknown>).mainEquipment as
      | string
      | null;
    const descVal = d.description as string | null;

    const fieldConfidence: ResolvedDetection["field_confidence"] = {
      tag: tagVal
        ? validation.source === "LEGEND" ||
          validation.source === "CACHE" ||
          validation.source === "COMPANY_KB"
          ? Math.min(finalConfidence + det.fieldConfidenceBonus, 1.0)
          : finalConfidence
        : null,
      type: finalConfidence,
      service: serviceVal
        ? validation.source === "COMPANY_KB" || validation.source === "LEGEND"
          ? det.fieldConfidenceMapped
          : isVisionOnly
            ? det.fieldConfidenceServiceVisionOnly
            : det.fieldConfidenceServiceInferred
        : null,
      mainEquipment: mainEqVal
        ? validation.source === "COMPANY_KB" || validation.source === "LEGEND"
          ? det.fieldConfidenceMapped
          : isVisionOnly
            ? det.fieldConfidenceMainEquipmentVisionOnly
            : det.fieldConfidenceMainEquipmentInferred
        : null,
      description: descVal
        ? isVisionOnly
          ? det.fieldConfidenceDescriptionVisionOnly
          : det.fieldConfidenceDescriptionInferred
        : null,
    };

    // G3: Per-field provenance
    const sourceLabel = validation.source as string;
    const fieldProvenance: ResolvedDetection["field_provenance"] = {
      tag: tagVal
        ? {
            source: sourceLabel,
            normalized: false,
            correctionReason: null,
          }
        : null,
      type: {
        source: sourceLabel,
        inferred:
          validation.source === "VISION" || validation.source === "UNKNOWN",
      },
      service: serviceVal
        ? {
            source: isVisionOnly ? "VISION" : sourceLabel,
            inferred: isVisionOnly,
          }
        : null,
      mainEquipment: mainEqVal
        ? {
            source: isVisionOnly ? "VISION" : sourceLabel,
            inferred: isVisionOnly,
          }
        : null,
      description: descVal
        ? {
            source: isVisionOnly ? "VISION" : sourceLabel,
            inferred: isVisionOnly,
          }
        : null,
    };

    return {
      ...d,
      assetType: finalAssetType,
      confidence: finalConfidence,
      evidence: [...d.evidence, validation.ruleApplied],
      detection_source: validation.source,
      rule_applied: validation.ruleApplied,
      resolved_asset_name: validation.resolvedAssetName,
      image_hash: imageHash,
      canonical_features: canonicalFeatures,
      symbol_embedding: symbolEmbedding,
      symbol_features: symbolFeatures,
      confidence_breakdown: validation.confidenceBreakdown ?? {},
      audit: validation.audit ?? null,
      validation_status: validationStatus,
      field_confidence: fieldConfidence,
      field_provenance: fieldProvenance,
    };
  }

  // Process detections in parallel batches of FEATURE_BATCH_SIZE.
  // Each batch runs concurrently; batches are sequential to respect Gemini rate limits.
  // Order preserved via index mapping — results array mirrors rawDetections order.
  const resolvedDetections: ResolvedDetection[] = new Array(
    rawDetections.length,
  );
  for (let i = 0; i < rawDetections.length; i += FEATURE_BATCH_SIZE) {
    const batch = rawDetections.slice(i, i + FEATURE_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((d) => processOneDetection(d)),
    );
    for (let j = 0; j < batchResults.length; j++) {
      resolvedDetections[i + j] = batchResults[j];
    }
  }

  // Step 3: Calibrate confidence
  const calibrated = calibrateConfidence(resolvedDetections, det);

  // Step 4 (opt-in): Gemini verifier for NEEDS_REVIEW band detections.
  // Only runs when det.enableVerifier === true (default: false).
  // Conservative budget: max 5 calls per page to protect free-tier quota.
  if (det.enableVerifier && input.pageImageBase64 && input.pngWidth && input.pngHeight) {
    const { createVerifierSession } = await import('@/lib/detection/ai/verifier');
    const session = createVerifierSession({ maxCallsPerPage: 5 });
    const legendLabels = input.legendSymbols.slice(0, 20).map((s) => ({
      symbolId: s.id,
      label: s.symbol_name ?? s.asset_type,
    }));

    for (const resolved of calibrated) {
      if (resolved.validation_status !== 'NEEDS_REVIEW') continue;
      if (resolved.confidence < det.reviewThreshold) continue; // LOW band — skip

      try {
        const cropBase64 = await cropPageRegion(
          input.pageImageBase64,
          adaptiveExpandBBox(resolved.bbox),
          input.pngWidth,
          input.pngHeight,
          0.0,
        );
        if (!cropBase64) continue;

        const cropHash = resolved.image_hash ?? hashImage(cropBase64);
        const result = await session.verify({
          candidateId: resolved.assetTag ?? resolved.assetType ?? 'unknown',
          pageId: String(input.page),
          deterministic: {
            confidence: resolved.confidence,
            decisionBand: 'REVIEW',
            topLabel: resolved.assetType,
            topSymbolId: null,
            margin: 0,
            reasons: resolved.evidence ?? [],
            configVersion: 'gemini-vision-only',
          },
          ocr: { rawText: null, normalizedText: null, isTag: null },
          selectedLegend: {
            legendId: input.legendId,
            version: '1',
            labels: legendLabels,
          },
          crops: {
            candidateCropB64: cropBase64,
            contextCropB64: cropBase64,
            cropHash,
          },
        });

        if (result.gemini.status === 'success' && result.gemini.verdict) {
          if (result.gemini.verdict === 'CORRECT' && result.gemini.suggestedLabel) {
            resolved.resolved_asset_name = result.gemini.suggestedLabel;
            resolved.evidence = [
              ...resolved.evidence,
              `Verifier: ${result.gemini.explanation ?? result.gemini.verdict}`,
            ];
          } else if (result.gemini.verdict === 'CONFIRM') {
            resolved.evidence = [
              ...resolved.evidence,
              `Verifier confirmed: ${result.gemini.explanation ?? 'CONFIRM'}`,
            ];
          } else if (result.gemini.verdict === 'NO_SYMBOL') {
            // Symbol visually not present — annotate for human review, no auto-reject.
            resolved.evidence = [
              ...resolved.evidence,
              `Verifier: symbol not visible — ${result.gemini.explanation ?? 'NO_SYMBOL'}`,
            ];
          }
        }
      } catch {
        // verifier failure must never break detection
      }
    }
  }

  return calibrated;
}

async function runWithVisionProvider(
  cfg: Awaited<ReturnType<typeof getAiConfig>>,
  input: DetectionJobInput,
  prompt: string,
  opts?: { pngBase64?: string; regionLabel?: string },
) {
  if (cfg.provider === 'gemini') {
    return runWithGemini(input, prompt, cfg.geminiModel, opts);
  }

  const { getVisionProvider } = await import('@/lib/ai-providers');
  const provider = await getVisionProvider(cfg);
  const model = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;

  const drawingTypeBlock = input.drawingType
    ? `\nDRAWING TYPE: ${input.drawingType} — interpret all symbols and tags in this context.`
    : "";
  const contextText = opts?.regionLabel
    ? `This image is a CROPPED REGION (${opts.regionLabel}) of page ${input.page} of a P&ID document.
${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding boxes in 0-1000 normalized space relative to THIS CROP, (0,0)=top-left of the crop, (1000,1000)=bottom-right of the crop. DO NOT return pixel coordinates.
Detect ALL equipment symbols visible in THIS REGION. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`
    : (() => {
        const dimInfo =
          input.pngWidth && input.pngHeight
            ? `Image dimensions: ${input.pngWidth} x ${input.pngHeight} pixels.`
            : "Image rendered at high resolution.";
        return `This is page ${input.page} of a P&ID document, rendered as a PNG image.
${dimInfo}${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding box coordinates in 0-1000 normalized space where (0,0)=top-left and (1000,1000)=bottom-right of the image. DO NOT return pixel coordinates. Scale: x_normalized = (x_pixel / image_width) * 1000.
Detect ALL equipment symbols on THIS PAGE. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
      })();

  const fullPrompt = `${prompt}\n\n${contextText}`;
  const imageBase64 = opts?.pngBase64 ?? input.pageImageBase64;

  const result = await provider.generateVisionCompletion({
    model,
    prompt: fullPrompt,
    imageBase64,
    mimeType: 'image/png',
    temperature: 0.1,
    maxTokens: 4096,
    responseFormat: 'json',
  });

  const raw = result.text;
  const json = extractJson(raw) as Record<string, unknown>;
  const sanitized = sanitizePageJson(
    json.page !== undefined ? json : { ...json, page: input.page },
    input.page,
    raw,
  );
  const parsed = PageDetectionSchema.safeParse(sanitized);
  if (!parsed.success) {
    throw new Error(
      `Schema validation failed: ${JSON.stringify(parsed.error.flatten())} — raw: ${raw.slice(0, 800)}`,
    );
  }
  parsed.data.page = input.page;
  return parsed.data;
}

async function runWithGemini(
  input: DetectionJobInput,
  prompt: string,
  preferredModel: string,
  opts?: { pngBase64?: string; regionLabel?: string },
) {
  const { getGeminiClient } = await import("@/lib/gemini");
  const client = await getGeminiClient();
  const tuning = await getTuning();
  const { modelAttemptDelayMs, jsonIncompatible } = tuning.model;

  // Auto-discover valid models from Gemini API. preferredModel stays first if valid.
  // Model-availability filtering is shared with Scan Legend (resolveGeminiModels).
  const resolvedCandidates = await resolveGeminiModels();
  const FALLBACK_MODELS = resolvedCandidates.includes(preferredModel)
    ? resolvedCandidates
    : [preferredModel, ...resolvedCandidates].filter(
        (m, i, a) => a.indexOf(m) === i,
      );

  const mediaPart: Part = {
    inlineData: {
      mimeType: "image/png",
      data: opts?.pngBase64 ?? input.pageImageBase64,
    },
  };

  // Build reference crop parts: one inlineData per validated legend symbol crop.
  // Only included when referenceCrops map is non-empty and this is a full-page call
  // (not a region sub-crop, where the coord frame is different and adding more images
  // risks confusing the model about which image to annotate).
  const refCropParts: Part[] = [];
  if (input.referenceCrops && input.referenceCrops.size > 0 && !opts?.regionLabel) {
    // Build a lookup: symbolId → symbol name for the intro text block
    const symbolNameById = new Map<string, string>(
      input.legendSymbols.map((s) => [
        (s as any).id as string,
        (s.symbol_name ?? s.asset_type),
      ])
    );
    let idx = 0;
    for (const [symbolId, cropBase64] of input.referenceCrops) {
      const name = symbolNameById.get(symbolId) ?? 'Legend Symbol';
      refCropParts.push({ text: `REFERENCE SYMBOL ${idx + 1}: ${name}` });
      refCropParts.push({ inlineData: { mimeType: 'image/png' as const, data: cropBase64 } });
      idx++;
    }
  }

  const drawingTypeBlock = input.drawingType
    ? `\nDRAWING TYPE: ${input.drawingType} — interpret all symbols and tags in this context.`
    : "";
  // For a region crop the coordinate frame is the crop, not the page — the
  // prompt's COORDINATE FRAME block says so, and the caller maps boxes back.
  const contextText = opts?.regionLabel
    ? `This image is a CROPPED REGION (${opts.regionLabel}) of page ${input.page} of a P&ID document.
${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding boxes in 0-1000 normalized space relative to THIS CROP, (0,0)=top-left of the crop, (1000,1000)=bottom-right of the crop. DO NOT return pixel coordinates.
Detect ALL equipment symbols visible in THIS REGION. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`
    : (() => {
        const dimInfo =
          input.pngWidth && input.pngHeight
            ? `Image dimensions: ${input.pngWidth} x ${input.pngHeight} pixels.`
            : "Image rendered at high resolution.";
        return `This is page ${input.page} of a P&ID document, rendered as a PNG image.
${dimInfo}${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding box coordinates in 0-1000 normalized space where (0,0)=top-left and (1000,1000)=bottom-right of the image. DO NOT return pixel coordinates. Scale: x_normalized = (x_pixel / image_width) * 1000.
Detect ALL equipment symbols on THIS PAGE. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
      })();

  let lastError: unknown;
  const generation = generationConfigFrom(tuning.generation, "gemini");
  const maxAttempts = tuning.model.maxModelAttempts;
  // One breaker and one request budget for the whole process: a model that is
  // 503-ing to the legend sweep is 503-ing here too.
  const breaker = getSharedModelBreaker({
    failureThreshold: tuning.model.circuitFailures,
    cooldownMs: tuning.model.circuitCooldownMs,
  });
  const gate = getSharedGeminiGate(tuning.model.requestsPerMinute);
  let attempts = 0;
  for (const modelName of FALLBACK_MODELS) {
    // Models that ignore responseMimeType produce prose, not JSON — skip them
    // exactly like Scan Legend does.
    if (isJsonModeIncompatible(jsonIncompatible, modelName)) continue;
    // A model whose breaker is open recently failed repeatedly at the provider
    // level; walking the rest of the chain first is strictly better than burning
    // another request on it.
    if (breaker.isOpen(modelName)) {
      console.warn(
        `[gemini] skipping model=${modelName} page=${input.page}: circuit open after ${tuning.model.circuitFailures} consecutive provider failures`,
      );
      continue;
    }
    // Cap attempts so an all-503 chain fails fast instead of retrying every
    // candidate. 0 = unlimited.
    if (maxAttempts > 0 && attempts >= maxAttempts) {
      lastError = lastError ?? new Error("All Gemini models exhausted");
      console.warn(
        `[gemini] page=${input.page} giving up after ${attempts} model attempt(s) (GEMINI_MAX_MODEL_ATTEMPTS)`,
      );
      break;
    }
    attempts += 1;
    try {
      console.log(`[gemini] trying model=${modelName} page=${input.page}`);
      // Hold the shared request budget before the call goes out.
      await gate.wait();
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: generation,
      });
      const result = await model.generateContent([
        { text: prompt },
        { text: contextText },
        ...refCropParts,
        mediaPart,
      ], { timeout: env.GEMINI_REQUEST_TIMEOUT_MS });
      const raw = result.response.text();
      const json = extractJson(raw) as Record<string, unknown>;
      // P2: sanitasi per-item dulu — deteksi rusak di-drop, sisanya tetap divalidasi
      const sanitized = sanitizePageJson(
        json.page !== undefined ? json : { ...json, page: input.page },
        input.page,
        raw,
      );
      const parsed = PageDetectionSchema.safeParse(sanitized);
      if (!parsed.success) {
        throw new Error(
          `Schema validation failed: ${JSON.stringify(parsed.error.flatten())} — raw: ${raw.slice(0, 800)}`,
        );
      }
      parsed.data.page = input.page;
      breaker.recordSuccess(modelName);
      console.log(
        `[gemini] success model=${modelName} detections=${parsed.data.detections.length}`,
      );
      return parsed.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only provider-availability failures open the breaker. Schema validation
      // and malformed output mean the model answered, so the next model in the
      // chain is still worth trying.
      const providerDown = isProviderUnavailable(msg);
      const shouldFallback = providerDown;
      console.warn(`[gemini] model=${modelName} failed: ${msg.slice(0, 200)}`);
      if (providerDown) {
        breaker.recordFailure(modelName);
        // A rate-limit rejection means the configured ceiling is optimistic.
        // Push the next attempt past the current window instead of spending
        // another request that is certain to be rejected too.
        if (/429|rate.limit|quota|resource.?exhausted/i.test(msg)) {
          await gate.backoff(modelAttemptDelayMs * 2);
          continue;
        }
      }
      if (shouldFallback) {
        lastError = e;
        await new Promise((r) => setTimeout(r, modelAttemptDelayMs));
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new Error("All Gemini models exhausted");
}

/**
 * Confidence calibration — objective penalty based on verifiable signals.
 *
 * `det` is the resolved `tuning.detection` slice. It is optional so this stays a
 * pure, synchronous function callable from tests and scripts; production passes
 * the resolved tuning so a Settings change applies immediately.
 */
export function calibrateConfidence(
  detections: ResolvedDetection[],
  det: DetectionTuning = envDetectionTuning(),
): ResolvedDetection[] {
  return detections.map((d) => {
    // UNKNOWN detections: force low confidence + NEEDS_REVIEW
    if (d.detection_source === "UNKNOWN") {
      return {
        ...d,
        confidence: Math.min(d.confidence, det.capUnknownConfidence),
        validation_status: "NEEDS_REVIEW" as const,
      };
    }

    let penalty = 0;
    if (!d.assetTag) penalty += det.penaltyNoTag;
    if (d.evidence.length <= 1) penalty += det.penaltyThinEvidence;

    // Bbox size guard — an oversized box likely swallowed pipe lines or the tag
    // text. Asset-type-aware: vessels/tanks/exchangers are legitimately bigger
    // than instruments and valves.
    const isLargeEquipment = /vessel|tank|column|reactor|separator|drum|exchanger|heater|cooler|boiler|tower/i.test(d.assetType ?? "");
    const maxBboxDim = isLargeEquipment
      ? det.bboxMaxLargeEquipmentUnits
      : det.bboxMaxSymbolUnits;
    const bboxOversize = d.bbox.width > maxBboxDim || d.bbox.height > maxBboxDim;
    if (bboxOversize) {
      penalty += det.penaltyBboxOversize;
    }
    // Extreme oversize (likely a whole region rather than a symbol) — hard cap.
    if (d.bbox.width > det.bboxOversizeUnits || d.bbox.height > det.bboxOversizeUnits) {
      return {
        ...d,
        confidence: Math.min(d.confidence, det.capOversizedBboxConfidence),
        validation_status: "NEEDS_REVIEW" as const,
        evidence: [...d.evidence, `Bbox extremely large (${Math.round(d.bbox.width)}×${Math.round(d.bbox.height)}) — likely includes pipe lines or surrounding text`],
      };
    }
    if (d.bbox.width <= det.bboxDegenerateUnits || d.bbox.height <= det.bboxDegenerateUnits) {
      return {
        ...d,
        confidence: Math.min(d.confidence, det.capDegenerateBboxConfidence),
        validation_status: "NEEDS_REVIEW" as const,
      };
    }

    const calibrated = Math.max(0, Math.min(1, d.confidence - penalty));
    // If calibration drops the score below the review threshold, or penalties
    // were severe, force NEEDS_REVIEW regardless of the incoming status.
    const calibratedStatus: "VALID" | "NEEDS_REVIEW" | "CONFLICT" =
      d.validation_status === "CONFLICT"
        ? "CONFLICT"
        : calibrated < det.reviewThreshold || penalty >= det.penaltyReviewThreshold
          ? "NEEDS_REVIEW"
          : d.validation_status;

    if (penalty > 0) {
      const penaltyNotes: string[] = [];
      if (bboxOversize) {
        penaltyNotes.push(`Bbox oversized (${Math.round(d.bbox.width)}×${Math.round(d.bbox.height)} units) — may include tag text or pipe lines, verify`);
      }

      return {
        ...d,
        confidence: calibrated,
        validation_status: calibratedStatus,
        evidence: penaltyNotes.length > 0 ? [...d.evidence, ...penaltyNotes] : d.evidence,
      };
    }
    return d;
  });
}

/**
 * P2: Sanitasi output Gemini sebelum validasi Zod.
 * Gemini kadang mengembalikan deteksi dengan field angka hilang (undefined) —
 * mis. bbox parsial atau confidence tidak ada. Sebelumnya SATU deteksi rusak
 * menggagalkan SELURUH halaman (page AI error, 0 deteksi tersimpan).
 * Sekarang: deteksi rusak di-drop per-item (dengan warn), deteksi valid tetap
 * diproses. Aturan:
 *   - assetType wajib string non-empty → tanpanya drop
 *   - bbox wajib 4 angka finite → tanpanya drop (tidak bisa ditampilkan)
 *   - confidence hilang/invalid → default 0.5 (turun ke NEEDS_REVIEW via kalibrasi)
 *   - evidence non-array → []
 */
export function sanitizePageJson(
  json: Record<string, unknown>,
  fallbackPage: number,
  rawText?: string,
): { page: number; detections: Record<string, unknown>[] } {
  const page =
    typeof json.page === "number" && Number.isFinite(json.page)
      ? json.page
      : fallbackPage;
  const rawList = Array.isArray(json.detections) ? json.detections : [];
  const clean: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const item of rawList) {
    if (typeof item !== "object" || item === null) {
      dropped++;
      continue;
    }
    const d = { ...(item as Record<string, unknown>) };
    if (typeof d.assetType !== "string" || !d.assetType.trim()) {
      dropped++;
      continue;
    }
    const b = d.bbox as Record<string, unknown> | null | undefined;
    const nums = b ? [b.x, b.y, b.width, b.height].map(Number) : [];
    if (!b || nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
      dropped++;
      continue;
    }
    d.bbox = { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
    const c = Number(d.confidence);
    d.confidence = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5;
    if (!Array.isArray(d.evidence)) d.evidence = [];
    clean.push(d);
  }
  if (dropped > 0) {
    console.warn(
      `[sanitize] page=${page} dropped ${dropped} malformed detection(s), kept ${clean.length}`,
    );
  }
  // Losing every detection of a response is almost never a data problem — it is
  // a truncated response (maxOutputTokens cut mid-array) or prose instead of
  // JSON. Without a sample of the payload there is nothing to tell those two
  // apart, and the page just silently yields zero detections.
  if (clean.length === 0 && rawList.length > 0 && env.DEBUG_ARTIFACTS === 1) {
    console.warn(
      `[sanitize] page=${page} kept 0 of ${rawList.length} — first item: ` +
        JSON.stringify(rawList[0]).slice(0, 600),
    );
    if (rawText) {
      console.warn(`[sanitize] page=${page} raw tail: ${rawText.slice(-600)}`);
    }
  }
  return { page, detections: clean };
}

/**
 * Robust JSON extraction with truncated JSON recovery.
 */
export function extractJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const s = (m ? m[1] : text).trim();

  try {
    return JSON.parse(s);
  } catch {
    /* continue */
  }

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }

  // Truncated JSON recovery
  if (start !== -1) {
    const partial = s.slice(start);
    const pageMatch = partial.match(/"page"\s*:\s*(\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1]) : 1;
    const detections: unknown[] = [];
    const detectionsStart = partial.indexOf('"detections"');
    if (detectionsStart !== -1) {
      const arrStart = partial.indexOf("[", detectionsStart);
      if (arrStart !== -1) {
        let depth = 0;
        let objStart = -1;
        for (let i = arrStart + 1; i < partial.length; i++) {
          const c = partial[i];
          if (c === "{") {
            if (depth === 0) objStart = i;
            depth++;
          } else if (c === "}") {
            depth--;
            if (depth === 0 && objStart !== -1) {
              try {
                detections.push(JSON.parse(partial.slice(objStart, i + 1)));
              } catch {
                /* skip */
              }
              objStart = -1;
            }
          }
        }
      }
    }
    if (detections.length > 0) {
      console.warn(
        `[extractJson] Recovered ${detections.length} detections from truncated JSON`,
      );
      return { page, detections };
    }
  }

  throw new Error(`No valid JSON found in response: ${s.slice(0, 300)}`);
}

/**
 * Rule Validator Vision call — used when rule chain returns VISION source
 * and we want an additional validation pass for low-confidence detections.
 */
export async function runRuleValidatorVision(
  input: DetectionJobInput,
  detection: Detection,
  candidates: Array<{
    assetType: string;
    assetName: string;
    source: string;
    tagPattern?: string | null;
  }>,
): Promise<{
  asset_type: string;
  confidence: number;
  source_used: string;
  reason: string;
  is_unknown: boolean;
} | null> {
  try {
    const cfg = await getAiConfig();
    if (cfg.provider === 'gemini' && !cfg.geminiKey) return null;
    if (cfg.provider === 'openai' && !cfg.openaiKey) return null;
    if (cfg.provider === 'anthropic' && !cfg.anthropicKey) return null;
    if (cfg.provider === 'deepseek') return null;

    const legendContext =
      input.legendSymbols.length > 0
        ? (() => {
            const tagPfx = detection.assetTag
              ?.match(/^([A-Z]{1,6})/i)?.[1]
              ?.toUpperCase();
            const detType = detection.assetType?.toLowerCase() ?? "";
            // Sort by relevance: prefix match > type match > rest
            const ranked = [...input.legendSymbols].sort((a, b) => {
              const aPatPfx =
                a.tag_pattern
                  ?.split("-")[0]
                  .replace(/#|\*/g, "")
                  .toUpperCase() ?? "";
              const bPatPfx =
                b.tag_pattern
                  ?.split("-")[0]
                  .replace(/#|\*/g, "")
                  .toUpperCase() ?? "";
              const aScore =
                (tagPfx && aPatPfx === tagPfx ? 2 : 0) +
                (a.asset_type.toLowerCase().includes(detType) ||
                detType.includes(a.asset_type.toLowerCase())
                  ? 1
                  : 0);
              const bScore =
                (tagPfx && bPatPfx === tagPfx ? 2 : 0) +
                (b.asset_type.toLowerCase().includes(detType) ||
                detType.includes(b.asset_type.toLowerCase())
                  ? 1
                  : 0);
              return bScore - aScore;
            });
            return ranked
              .slice(0, 20)
              .map(
                (s) =>
                  `• ${s.symbol_name ?? s.asset_type}${s.tag_pattern ? ` [${s.tag_pattern}]` : ""}`,
              )
              .join("\n");
          })()
        : null;

    const prompt = buildRuleValidatorPrompt({
      symbolDescription: `Symbol detected as "${detection.assetType}" with confidence ${detection.confidence}. ${detection.evidence.join(". ")}`,
      nearbyText: detection.assetTag,
      candidates,
      legendContext,
    });

    if (cfg.provider !== 'gemini') {
      const { getVisionProvider } = await import('@/lib/ai-providers');
      const provider = await getVisionProvider(cfg);
      const model = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;
      const res = await provider.generateVisionCompletion({
        model,
        prompt,
        imageBase64: input.pageImageBase64,
        mimeType: 'image/png',
        temperature: 0.1,
        maxTokens: 1024,
        responseFormat: 'json',
      });
      return JSON.parse(res.text) as {
        asset_type: string;
        confidence: number;
        source_used: string;
        reason: string;
        is_unknown: boolean;
      };
    }

    const { getGeminiClient } = await import("@/lib/gemini");
    const client = await getGeminiClient();

    const model = client.getGenerativeModel({
      model: cfg.geminiModel,
      generationConfig: await getGenerationConfig("ruleValidator"),
    });

    const result = await model.generateContent([{ text: prompt }], {
      timeout: env.GEMINI_REQUEST_TIMEOUT_MS,
    });
    const raw = result.response.text();
    return JSON.parse(raw) as {
      asset_type: string;
      confidence: number;
      source_used: string;
      reason: string;
      is_unknown: boolean;
    };
  } catch {
    return null;
  }
}
