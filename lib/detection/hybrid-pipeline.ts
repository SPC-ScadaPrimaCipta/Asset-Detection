/**
 * Hybrid Detection Pipeline Orchestrator
 *
 * Connects YOLO GEO-2 → OCR → Rule Validator → Gemini Verifier → Gemini Fallback
 * → Confidence Fusion → Negative Learning penalty → final PersistableDetection[].
 *
 * Pipeline per page:
 *   1. YOLO GEO-2 (Node ONNX) — symbol bboxes, no tags
 *   2. OCR per bbox crop (tesseract.js) — read asset tags
 *   3. Rule Validator per detection — Legend > KB > ISA > ISO > Vision chain
 *   4. Gemini Verifier for UNKNOWN / low-confidence detections
 *   5. Gemini full-page fallback — catch symbols YOLO missed
 *   6. Merge YOLO + Gemini via IoU deduplication
 *   7. Confidence fusion: weight YOLO, OCR, Legend, Rule, Gemini scores
 *   8. Negative learning penalty from rejection history
 *
 * All stages are individually gated by env flags and degrade gracefully.
 */

import sharp from 'sharp';
import { createHash } from 'crypto';
import { env } from '@/lib/env';
import type { PersistableDetection } from '@/lib/detection/persistence/detection-repository';
import { runYoloGeo2Page } from '@/lib/detection/yolo/yolo-geo2-runner';
import { extractTextFromRegion } from '@/lib/ocr-engine';
import {
  cropBBoxFromBuffer,
  cropAdaptiveTagRegionFromBuffer,
  extractBestTagFromText,
  runTagOcr,
} from '@/lib/ocr-engine';
import {
  validateDetection,
  extractTagPrefix,
  type LegendSymbol,
} from '@/lib/rule-validator';
import { fuseConfidence, getFusionWeights } from '@/lib/confidence-fusion';
import { getNegativePenalty } from '@/lib/learning/negative-learning';
import { computeIoU } from '@/lib/detection/yolo/yolo-geo2-runner';
import { hashImage } from '@/lib/symbol-cache';
import {
  CV_SERVICE_AVAILABLE,
  cvBBoxRefine,
  cvOcr,
  cvTemplateMatch,
} from '@/lib/cv-client';
import { runDetectionAgent } from '@/lib/ai-agent';
import type { DetectionJobInput } from '@/lib/ai-agent';
import { applyNMS } from '@/lib/spatial';
import { humanizeYoloLabel, sanitizeAssetType } from '@/lib/validation';
import { isJunkAssetType } from '@/lib/detection/duplicate-detection';
import { qualityGate } from '@/lib/mdo-pid-rules';

// ── Verifier (lazy import — only used when AI_VERIFIER_ENABLED) ────────
async function getVerifier() {
  return import('@/lib/detection/ai/verifier');
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert legacy 0-1000 bbox to pixel space */
function normToPx(norm: { x: number; y: number; width: number; height: number }, pageW: number, pageH: number) {
  return {
    x: Math.round((norm.x / 1000) * pageW),
    y: Math.round((norm.y / 1000) * pageH),
    width: Math.round((norm.width / 1000) * pageW),
    height: Math.round((norm.height / 1000) * pageH),
  };
}

/** Convert pixel bbox to 0-1000 normalized */
function pxToNorm(px: { x: number; y: number; width: number; height: number }, pageW: number, pageH: number) {
  return {
    x: Math.round((px.x / pageW) * 1000),
    y: Math.round((px.y / pageH) * 1000),
    width: Math.round((px.width / pageW) * 1000),
    height: Math.round((px.height / pageH) * 1000),
  };
}

/** IoU in pixel space */
function bboxIouPx(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  return computeIoU(
    { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y + a.height },
    { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height },
  );
}

// ── Stage 1+2: YOLO + OCR ──────────────────────────────────────────────────

export interface YoloOcrDetection {
  classId: number;
  rawLabel: string;
  yoloScore: number;
  bboxPx: { x: number; y: number; width: number; height: number };
  bboxNorm: { x: number; y: number; width: number; height: number };
  ocrText: string | null;
  ocrConfidence: number;
  isTag: boolean;
  ocrDescription: string | null;
  cropB64: string | null;
  imageHash: string | null;
}

async function runYoloWithOcr(
  pngBuffer: Buffer,
  pageWidth: number,
  pageHeight: number,
  log: (msg: string) => void,
  skipOcr = false,
): Promise<YoloOcrDetection[]> {
  // ── 1. YOLO ──
  const yoloResult = await runYoloGeo2Page(pngBuffer, pageWidth, pageHeight);
  log(`YOLO: ${yoloResult.detections.length} detections (${yoloResult.totalTiles} tiles, ${yoloResult.durationMs}ms)`);

  const results: YoloOcrDetection[] = [];
  const ocrEnabled = !skipOcr && env.OCR_ENGINE !== 'none';
  const batchSize = env.OCR_BATCH_SIZE ?? 5;
  const dets = yoloResult.detections;

  // ── 2. OCR per bbox (batched) ──
  for (let i = 0; i < dets.length; i += batchSize) {
    const batch = dets.slice(i, i + batchSize);

    await Promise.all(batch.map(async (det) => {
      const symbolBboxPx = det.symbolBboxPx ?? normToPx(det.bbox, pageWidth, pageHeight);

      // 1. Tight crop for hash and visual identity
      let cropBuffer: Buffer | null = null;
      let cropB64: string | null = null;
      let imageHash: string | null = null;
      let ocrText: string | null = null;
      let ocrConf = 0;
      let isTag = false;
      let descText: string | undefined;

      try {
        cropBuffer = await cropBBoxFromBuffer(pngBuffer, symbolBboxPx, 8);
        cropB64 = cropBuffer.toString('base64');
        imageHash = hashImage(cropB64); // hashImage expects base64 string
      } catch (e) {
        log(`tight crop failed for ${det.assetType}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // 2. Adaptive expanded crop for OCR reading of tags in surrounding context
      if (ocrEnabled) {
        try {
          // New: Deep OCR for component name/description
          descText = await extractTextFromRegion(pngBuffer, {
            left: Math.max(0, symbolBboxPx.x - 50),
            top: Math.max(0, symbolBboxPx.y + symbolBboxPx.height),
            width: symbolBboxPx.width + 100,
            height: 100,
          });

          const { buffer: tagCropBuffer } = await cropAdaptiveTagRegionFromBuffer(
            pngBuffer,
            symbolBboxPx,
            {
              expandX: Math.round(env.CROP_EXPAND_MAX_UNITS * 0.7),  // ~70% of max → horizontal
              expandY: env.CROP_EXPAND_MAX_UNITS,                    // full max → vertical (tag usually above/below)
            },
          );

          if (env.OCR_ENGINE === 'cv-service' && CV_SERVICE_AVAILABLE()) {
            const r = await cvOcr(tagCropBuffer.toString('base64'), 'auto', 'eng');
            const extracted = extractBestTagFromText(r.text);
            if (extracted) {
              ocrText = extracted;
              ocrConf = r.confidence;
              isTag = true;
            } else {
              ocrText = r.text ? r.text.trim() : null;
              ocrConf = r.confidence;
              isTag = false;
            }
          } else {
            // Node tesseract.js
            const r = await runTagOcr(tagCropBuffer);
            const extracted = extractBestTagFromText(r.rawText || r.normalizedText || '');
            if (extracted) {
              ocrText = extracted;
              ocrConf = r.confidence;
              isTag = true;
            } else {
              ocrText = r.normalizedText || null;
              ocrConf = r.confidence;
              isTag = r.isTag;
            }
          }
        } catch (e) {
          log(`OCR failed for ${det.assetType}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      results.push({
        classId: 0,
        rawLabel: det.legendSymbol ?? det.assetType ?? '',
        yoloScore: det.confidence,
        bboxPx: symbolBboxPx,
        bboxNorm: det.bbox,
        ocrText: ocrText,
        ocrConfidence: ocrConf,
        isTag,
        ocrDescription: (ocrEnabled && typeof descText !== 'undefined') ? descText : null,
        cropB64,
        imageHash,
      });

}));
  }

  return results;
}

// ── Stage 3: Rule Validator ────────────────────────────────────────────────

async function runRuleValidation(
  det: YoloOcrDetection,
  legendSymbols: LegendSymbol[],
  legendId: string | null,
  projectId: string | null,
  drawingType: string | null,
): Promise<{
  resolvedAssetType: string;
  resolvedAssetName: string;
  legendSymbolId: string | null;
  source: string;
  ruleConfidence: number;
  negativePenalty: number;
}> {
  // YOLO labels are hierarchical (<category>.<type>.<standard>).
  // NEVER use the last segment ("iso"/"pip"/"niso") as a type — humanize
  // first (valve.ball.iso → "Ball Valve"), unresolvable → UNKNOWN.
  // (Forensics: bare suffixes persisted as asset_type in DXF vision jobs.)
  const yoloType = humanizeYoloLabel(det.rawLabel);
  const tagPrefix = det.ocrText ? extractTagPrefix(det.ocrText) : null;

  const ruleResult = await validateDetection({
    tagPrefix,
    detectedAssetType: yoloType,
    detectedAssetTag: det.ocrText,
    aiConfidence: det.yoloScore,
    legendId,
    legendSymbols,
    projectId,
    ocrText: det.ocrText ?? '',
    imageHash: det.imageHash,
    cropHash: det.imageHash,
    drawingType,
  });

  // Negative learning penalty
  let negativePenalty = 0;
  if (env.NEGATIVE_LEARNING_ENABLED === 'true') {
    try {
      negativePenalty = await getNegativePenalty({
        predictedAssetType: ruleResult.resolvedAssetType,
        projectId,
        cropHash: det.imageHash,
      });
    } catch {
      // non-fatal
    }
  }

  return {
    resolvedAssetType: ruleResult.resolvedAssetType,
    resolvedAssetName: ruleResult.resolvedAssetName,
    legendSymbolId: ruleResult.legendSymbol?.id ?? null,
    source: ruleResult.source,
    ruleConfidence: ruleResult.confidence,
    negativePenalty,
  };
}

// ── Stage 4: Gemini Verifier ───────────────────────────────────────────────

/**
 * The verifier returns a LEGEND LABEL (symbol_name), not an asset type. Using
 * it verbatim persisted things like "GATE VALVE (GATE VALVE) 1) OPEN…" or
 * "UNKNOWN" and discarded an already-resolved rule type. Map it back through
 * the legend, then fall back to humanizing a dotted YOLO label.
 */
function resolveVerifierType(
  label: string | null,
  legendSymbols: LegendSymbol[],
): string | null {
  if (!label) return null;
  const raw = label.trim();
  if (!raw || raw.toUpperCase() === 'UNKNOWN') return null;

  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const match = legendSymbols.find(
    (s) => norm(s.symbol_name) === norm(raw) || norm(s.asset_type) === norm(raw),
  );
  if (match?.asset_type && !isJunkAssetType(match.asset_type)) return match.asset_type;

  const humanized = humanizeYoloLabel(raw);
  if (humanized) return humanized;
  return isJunkAssetType(raw) ? null : raw;
}

async function runAiVerifier(
  det: YoloOcrDetection,
  ruleConf: number,
  legendId: string,
  legendSymbols: LegendSymbol[],
  pageImageB64: string,
): Promise<{ verifiedConf: number; verifiedType: string | null; needsHumanReview: boolean }> {
  if (!det.cropB64) {
    return { verifiedConf: ruleConf, verifiedType: null, needsHumanReview: true };
  }

  try {
    const { createVerifierSession } = await getVerifier();
    const labels = legendSymbols.map(s => ({ symbolId: s.id, label: s.symbol_name ?? s.asset_type }));

    const session = createVerifierSession({ maxCallsPerPage: env.VERIFIER_MAX_CALLS_PER_PAGE });

    const verifierReq = {
      candidateId: det.imageHash ?? 'unknown',
      pageId: 'page',
      deterministic: {
        confidence: ruleConf,
        decisionBand: (ruleConf >= 0.85 ? 'HIGH' : ruleConf >= 0.65 ? 'REVIEW' : 'LOW') as 'HIGH' | 'REVIEW' | 'LOW',
        topLabel: det.rawLabel,
        topSymbolId: null,
        margin: 0,
        reasons: [],
        configVersion: 'v1',
      },
      ocr: {
        rawText: det.ocrText,
        normalizedText: det.ocrText,
        isTag: det.isTag,
      },
      selectedLegend: {
        legendId,
        version: '1',
        labels,
      },
      crops: {
        candidateCropB64: det.cropB64,
        contextCropB64: det.cropB64,
        tagCropB64: null,
        legendRefB64: null,
        cropHash: det.imageHash ?? createHash('sha256').update(det.cropB64).digest('hex'),
      },
    };

    const output = await session.verify(verifierReq);
    const gemini = output.gemini;

    if (gemini.status === 'success' && gemini.confidence !== null) {
      return {
        verifiedConf: gemini.confidence,
        verifiedType: gemini.suggestedLabel,
        needsHumanReview: gemini.needsHumanReview,
      };
    }
  } catch (e) {
    // Verifier failure is non-fatal — keep rule confidence
  }

  return { verifiedConf: ruleConf, verifiedType: null, needsHumanReview: false };
}

// ── Stage 5: AI Full-page Fallback ─────────────────────────────────────

async function runAiFallback(
  pageImageB64: string,
  pageWidth: number,
  pageHeight: number,
  existingDetections: PersistableDetection[],
  params: {
    page: number;
    legendId: string;
    legendSymbols: LegendSymbol[];
    projectId: string | null;
    drawingType: string | null;
  },
  log: (msg: string) => void,
): Promise<PersistableDetection[]> {
  try {
    const aiResult = await runDetectionAgent({
      page: params.page,
      pageImageBase64: pageImageB64,
      legendId: params.legendId,
      legendSymbols: params.legendSymbols,
      pngWidth: pageWidth,
      pngHeight: pageHeight,
      projectId: params.projectId,
      drawingType: params.drawingType,
    });

    const mergeIou = env.HYBRID_MERGE_IOU ?? 0.4;
    const newDetections: PersistableDetection[] = [];
    let merged = 0;

    for (const gd of aiResult.detections) {
      const gdBbox = { x: gd.bbox.x, y: gd.bbox.y, width: gd.bbox.width, height: gd.bbox.height };
      const matchedIdx = existingDetections.findIndex(ex => {
        const iou = computeIoU(
          { x1: ex.bbox.x, y1: ex.bbox.y, x2: ex.bbox.x + ex.bbox.width, y2: ex.bbox.y + ex.bbox.height },
          { x1: gdBbox.x, y1: gdBbox.y, x2: gdBbox.x + gdBbox.width, y2: gdBbox.y + gdBbox.height },
        );
        if (iou >= mergeIou) return true;

        // Small engineering symbols (valves, instruments) have small pixel areas
        // where standard IoU collapses even on a tiny shift. Check proximity + containment.
        // Require true coincidence so closely-spaced inline equipment
        // (e.g. block valve + bleeder/drain valve on drop leg) are not suppressed.
        const dist = Math.hypot(
          ex.bbox.x + ex.bbox.width / 2 - (gdBbox.x + gdBbox.width / 2),
          ex.bbox.y + ex.bbox.height / 2 - (gdBbox.y + gdBbox.height / 2),
        );
        const ix0 = Math.max(ex.bbox.x, gdBbox.x);
        const iy0 = Math.max(ex.bbox.y, gdBbox.y);
        const ix1 = Math.min(ex.bbox.x + ex.bbox.width, gdBbox.x + gdBbox.width);
        const iy1 = Math.min(ex.bbox.y + ex.bbox.height, gdBbox.y + gdBbox.height);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        const minArea = Math.min(ex.bbox.width * ex.bbox.height, gdBbox.width * gdBbox.height);
        const containment = minArea > 0 ? inter / minArea : 0;

        return (containment >= 0.80 && dist <= 8) || (dist <= 5 && (containment >= 0.50 || iou >= 0.25));
      });

      if (matchedIdx === -1) {
        // New detection from AI — apply negative learning penalty for consistency
        let negativePenalty = 0;
        if (env.NEGATIVE_LEARNING_ENABLED === 'true') {
          try {
            negativePenalty = await getNegativePenalty({
              predictedAssetType: gd.assetType ?? '',
              projectId: params.projectId,
              cropHash: null,
            });
          } catch { /* non-fatal */ }
        }
        const adjustedConf = Math.min(1, Math.max(0, (gd.confidence ?? 0.5) + negativePenalty));
        const reviewThreshold = env.DETECTION_REVIEW_THRESHOLD ?? 0.65;

        newDetections.push({
          ...gd,
          confidence: adjustedConf,
          detection_source: 'AI_FALLBACK' as const,
          validation_status: adjustedConf < reviewThreshold ? 'NEEDS_REVIEW' : 'VALID',
          evidence: [...(Array.isArray(gd.evidence) ? gd.evidence : []), 'Source: AI fallback (YOLO missed)'],
        } as PersistableDetection);
      } else {
        merged++;
        // If YOLO found the symbol but had no tag, enrich with AI tag if available
        const matched = existingDetections[matchedIdx];
        if (!matched.assetTag && gd.assetTag) {
          matched.assetTag = gd.assetTag;
          if (Array.isArray(matched.evidence)) {
            matched.evidence.push(`Tag enriched from AI fallback: ${gd.assetTag}`);
          }
        }
      }
    }

    log(`AI fallback: ${aiResult.detections.length} detections, ${newDetections.length} new (${merged} already covered by YOLO)`);
    return newDetections;
  } catch (e) {
    log(`AI fallback failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

// ── Stage 7: Confidence Fusion ─────────────────────────────────────────────

function fuseDetectionConfidence(
  yoloScore: number,
  ruleConfidence: number,
  ocrConfidence: number,
  verifiedConf: number,
  hasOcrTag: boolean,
  negativePenalty: number,
): number {
  const weights = getFusionWeights();

  // Map sources to EvidenceScores
  const evidence = {
    legendScore: ruleConfidence * weights.legend,
    companyScore: 0, // not available at this stage
    embeddingScore: 0,
    ocrScore: hasOcrTag ? ocrConfidence * weights.ocr : 0,
    ruleScore: yoloScore * weights.rules,
    visionScore: verifiedConf * weights.vision,
  };

  // Weighted average of non-zero components
  const totalWeight =
    weights.legend +
    (hasOcrTag ? weights.ocr : 0) +
    weights.rules +
    weights.vision;

  const weighted =
    (evidence.legendScore + evidence.ocrScore + evidence.ruleScore + evidence.visionScore) /
    Math.max(totalWeight, 0.01);

  // Apply negative learning penalty (negative value)
  const penalized = weighted + negativePenalty;
  return Math.min(1, Math.max(0, penalized));
}

// ── Stage 8: BBox Refinement ───────────────────────────────────────────────

async function maybeRefineBBox(
  pageB64: string,
  bboxPx: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
): Promise<{ refined: { x: number; y: number; width: number; height: number }; confidence: number; method: string }> {
  if (env.BBOX_REFINE_ENABLED !== 'true' || !CV_SERVICE_AVAILABLE()) {
    return { refined: bboxPx, confidence: 0.5, method: 'original' };
  }

  try {
    const result = await cvBBoxRefine(pageB64, bboxPx, pageWidth, pageHeight);
    return {
      refined: result.refined_bbox,
      confidence: result.confidence,
      method: result.method,
    };
  } catch {
    return { refined: bboxPx, confidence: 0.5, method: 'original' };
  }
}

// ── Main Orchestrator ──────────────────────────────────────────────────────

export interface HybridPipelineInput {
  pngBuffer: Buffer;
  pageImageBase64: string;
  pageWidth: number;
  pageHeight: number;
  page: number;
  legendId: string;
  legendSymbols: LegendSymbol[];
  projectId: string | null;
  drawingType: string | null;
  /**
   * Skip per-bbox OCR (Blok 9). For DXF vision: tags come from exact vector
   * TEXT, so OCR only burns tesseract time for untagged symbols. When true,
   * ocrText stays null and YOLO/legend/Gemini decide.
   */
  skipOcr?: boolean;
}

export interface HybridPipelineStats {
  yoloDetections: number;
  yoloWithTags: number;
  aiVerifierCalls: number;
  aiFallbackDetections: number;
  geminiVerifierCalls: number;      // backward-compat alias
  geminiFallbackDetections: number; // backward-compat alias
  totalFinal: number;
  durationMs: number;
}

export async function runHybridPipeline(
  input: HybridPipelineInput,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<{ detections: PersistableDetection[]; stats: HybridPipelineStats }> {
  const t0 = Date.now();
  const pageLog = (msg: string) => log(`page ${input.page} [hybrid] ${msg}`);

  // ── Stage 1+2: YOLO + OCR ──
  if (input.skipOcr) pageLog('OCR skipped (caller-provided tags)');
  const yoloOcrDets = await runYoloWithOcr(input.pngBuffer, input.pageWidth, input.pageHeight, pageLog, input.skipOcr);

  // ── Stage 1.5: Template Matching Fallback (if YOLO found 0 candidates and enabled) ──
  if (
    yoloOcrDets.length === 0 &&
    env.TEMPLATE_MATCH_ENABLED === 'true' &&
    CV_SERVICE_AVAILABLE() &&
    input.legendSymbols &&
    input.legendSymbols.length > 0
  ) {
    try {
      const templateThreshold = env.TEMPLATE_MATCH_THRESHOLD ?? 0.70;
      pageLog(`running Template Matching fallback (YOLO found 0 candidates)...`);

      const withCrop = input.legendSymbols.filter(
        (s) => s.reference_image_url && typeof s.reference_image_url === 'string'
      );

      for (const sym of withCrop.slice(0, 10)) {
        try {
          const { getFile } = await import('@/lib/storage');
          const cropBuf = (await getFile(sym.reference_image_url!)) as unknown as Buffer;
          if (!cropBuf) continue;

          const tmRes = await cvTemplateMatch(
            input.pageImageBase64,
            cropBuf.toString('base64'),
            templateThreshold,
            10,
          );

          for (const m of tmRes.matches) {
            const bboxNorm = pxToNorm(m.bbox, input.pageWidth, input.pageHeight);
            let cropB64: string | null = null;
            let imageHash: string | null = null;
            try {
              const tight = await cropBBoxFromBuffer(input.pngBuffer, m.bbox, 8);
              cropB64 = tight.toString('base64');
              imageHash = hashImage(cropB64);
            } catch { /* non-fatal */ }

            yoloOcrDets.push({
              classId: 0,
              rawLabel: sym.symbol_name ?? sym.asset_type,
              yoloScore: m.score,
              bboxPx: m.bbox,
              bboxNorm,
              ocrText: null,
              ocrConfidence: 0,
              isTag: false,
              ocrDescription: null,
              cropB64,
              imageHash,
            });
          }
        } catch (tmErr) {
          pageLog(`template match for ${sym.asset_type} skipped: ${tmErr instanceof Error ? tmErr.message : String(tmErr)}`);
        }
      }
      if (yoloOcrDets.length > 0) {
        pageLog(`Template Matching fallback generated ${yoloOcrDets.length} candidate(s)`);
      }
    } catch (e) {
      pageLog(`Template Matching fallback failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const yoloWithTags = yoloOcrDets.filter(d => d.isTag || d.ocrText).length;

  // ── Stage 3+4+5+7+8: Rule Validator + optional AI Verifier per detection ──
  const verifierEnabled = (env.AI_VERIFIER_ENABLED ?? env.GEMINI_VERIFIER_ENABLED) === 'true';
  const verifierThreshold = env.AI_VERIFIER_THRESHOLD ?? env.GEMINI_VERIFIER_THRESHOLD ?? 0.65;
  let verifierCalls = 0;

  const persistable: PersistableDetection[] = [];
  const processedBboxesNorm: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const det of yoloOcrDets) {
    // Stage 3: Rule Validator
    const rule = await runRuleValidation(
      det,
      input.legendSymbols,
      input.legendId,
      input.projectId,
      input.drawingType,
    );

    // Stage 8: BBox Refinement (optional, requires Python CV service)
    const { refined: refinedBboxPx } = await maybeRefineBBox(
      input.pageImageBase64,
      det.bboxPx,
      input.pageWidth,
      input.pageHeight,
    );

    const finalBboxNorm = pxToNorm(refinedBboxPx, input.pageWidth, input.pageHeight);

    // Stage 4: AI Verifier (only for ambiguous / UNKNOWN / low confidence)
    let verifiedConf = rule.ruleConfidence;
    let verifiedType: string | null = null;
    // Derive needsHumanReview from confidence + source (no validationStatus on RuleValidationResult)
    let needsHumanReview = rule.ruleConfidence < (env.DETECTION_REVIEW_THRESHOLD ?? 0.65) || rule.source === 'UNKNOWN';

    const shouldVerify =
      verifierEnabled &&
      (rule.source === 'UNKNOWN' || rule.source === 'VISION' || rule.ruleConfidence < verifierThreshold);

    if (shouldVerify && det.cropB64 && verifierCalls < (env.VERIFIER_MAX_CALLS_PER_PAGE ?? 10)) {
      verifierCalls++;
      const v = await runAiVerifier(det, rule.ruleConfidence, input.legendId, input.legendSymbols, input.pageImageBase64);
      verifiedConf = v.verifiedConf;
      verifiedType = resolveVerifierType(v.verifiedType, input.legendSymbols);
      needsHumanReview = v.needsHumanReview;
    }

    // Stage 7: Confidence Fusion
    const finalConf = fuseDetectionConfidence(
      det.yoloScore,
      rule.ruleConfidence,
      det.ocrConfidence,
      verifiedConf,
      det.isTag,
      rule.negativePenalty,
    );

    // Never let a junk verifier label ("UNKNOWN", "iso") erase a resolved
    // rule type, and never persist a dotted/fragment type.
    const ruleType = sanitizeAssetType(rule.resolvedAssetType);
    const verifiedSanitized = verifiedType ? sanitizeAssetType(verifiedType) : null;
    let finalAssetType =
      verifiedSanitized && verifiedSanitized !== 'UNKNOWN'
        ? verifiedSanitized
        : ruleType;

    const finalTag = det.ocrText && det.isTag ? det.ocrText : null;

    // Build evidence array
    const evidence: string[] = [
      `YOLO GEO-2: ${det.rawLabel} (score=${det.yoloScore.toFixed(2)})`,
      `Rule: ${rule.source} → ${rule.resolvedAssetName}`,
    ];
    if (det.ocrText) evidence.push(`OCR: "${det.ocrText}" (conf=${det.ocrConfidence.toFixed(2)})`);
    if (verifiedType) evidence.push(`AI verifier: ${verifiedType}`);
    if (rule.negativePenalty < 0) evidence.push(`Negative learning penalty: ${rule.negativePenalty.toFixed(2)}`);

    if (finalAssetType === 'UNKNOWN') {
      const { inferAssetTypeFromEvidence, GENERIC_ASSET_TYPE } = await import('./type-inference');
      const inferred = inferAssetTypeFromEvidence({ evidence, assetTag: det.ocrText && det.isTag ? det.ocrText : null, legendSymbols: input.legendSymbols });
      if (inferred) {
        finalAssetType = inferred.assetType;
        evidence.push(`Type inferred: ${inferred.reason}`);
      } else if (finalTag) {
        finalAssetType = GENERIC_ASSET_TYPE;
        evidence.push(`No evidence-based type; assigned fallback: ${GENERIC_ASSET_TYPE}`);
      }
    }

    // UNKNOWN is never auto-valid — it always needs a human.
    if (finalAssetType === 'UNKNOWN') needsHumanReview = true;
    if (finalAssetType === 'UNKNOWN' && !finalTag) {
      // Untagged unresolved vision geometry is noise, not an asset record.
      continue;
    }

    const validationStatus: 'VALID' | 'NEEDS_REVIEW' | 'CONFLICT' =
      (needsHumanReview || finalConf < (env.DETECTION_REVIEW_THRESHOLD ?? 0.65)) ? 'NEEDS_REVIEW'
      : 'VALID';

    const quality = qualityGate({
      source: rule.source === 'VISION' ? 'VISION' : 'YOLO_GEO2',
      assetTag: finalTag,
      assetType: finalAssetType,
      confidence: finalConf,
      evidence,
    });
    if (quality === 'DROP') continue;

    processedBboxesNorm.push(finalBboxNorm);

    const matchedLegendSymbolName =
      (rule.source === 'LEGEND' || rule.source === 'ISA' || rule.source === 'ISO')
        ? (rule.resolvedAssetName ?? rule.resolvedAssetType)
        : (rule.resolvedAssetName ?? det.rawLabel);

    persistable.push({
      assetTag: finalTag,
      assetType: finalAssetType,
      equipmentClass: det.rawLabel.split('.')[0] || null,
      description: null,
      confidence: finalConf,
      bbox: finalBboxNorm,
      symbolBboxPx: refinedBboxPx,
      pageDims: { pageWidth: input.pageWidth, pageHeight: input.pageHeight },
      legendSymbol: matchedLegendSymbolName,
      legendSymbolId: rule.legendSymbolId,
      detection_source: 'YOLO_GEO2',
      evidence,
      image_hash: det.imageHash,
      validation_status: validationStatus,
      confidence_breakdown: {
        yolo: det.yoloScore,
        rule: rule.ruleConfidence,
        ocr: det.ocrConfidence,
        verified: verifiedConf,
        final: finalConf,
        negativePenalty: rule.negativePenalty,
      },
    } as PersistableDetection);
  }

  // ── Stage 5: AI Full-page Fallback ──
  let aiFallbackDets: PersistableDetection[] = [];
  const fallbackEnabled = (env.AI_FALLBACK_ENABLED ?? env.GEMINI_FALLBACK_ENABLED) === 'true';
  if (fallbackEnabled && input.legendSymbols.length > 0) {
    aiFallbackDets = await runAiFallback(
      input.pageImageBase64,
      input.pageWidth,
      input.pageHeight,
      persistable,
      {
        page: input.page,
        legendId: input.legendId,
        legendSymbols: input.legendSymbols,
        projectId: input.projectId,
        drawingType: input.drawingType,
      },
      pageLog,
    );
  }

  // ── Stage 6: Merge + NMS ──
  const allDets = [...persistable, ...aiFallbackDets];
  const finalDets = applyNMS(allDets, env.HYBRID_MERGE_IOU ?? 0.4) as PersistableDetection[];

  return {
    detections: finalDets,
    stats: {
      yoloDetections: yoloOcrDets.length,
      yoloWithTags,
      aiVerifierCalls: verifierCalls,
      aiFallbackDetections: aiFallbackDets.length,
      geminiVerifierCalls: verifierCalls,
      geminiFallbackDetections: aiFallbackDets.length,
      totalFinal: finalDets.length,
      durationMs: Date.now() - t0,
    },
  };
}
