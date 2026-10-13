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
import { runYoloGeo2Page } from '@/lib/detection/yolo/yolo-geo2-runner';
import type { PersistableDetection } from '@/lib/detection/persistence/detection-repository';
import { cropBBoxFromBuffer, runTagOcr } from '@/lib/ocr-engine';
import {
  validateDetection,
  extractTagPrefix,
  type LegendSymbol,
} from '@/lib/rule-validator';
import { fuseConfidence, getFusionWeights } from '@/lib/confidence-fusion';
import { getNegativePenalty } from '@/lib/learning/negative-learning';
import { computeIoU } from '@/lib/detection/yolo/yolo-geo2-runner';
import { hashImage } from '@/lib/symbol-cache';
import { CV_SERVICE_AVAILABLE, cvBBoxRefine, cvOcr } from '@/lib/cv-client';
import { runDetectionAgent } from '@/lib/ai-agent';
import type { DetectionJobInput } from '@/lib/ai-agent';
import { applyNMS } from '@/lib/spatial';

// ── Verifier (lazy import — only used when GEMINI_VERIFIER_ENABLED) ────────
async function getVerifier() {
  return import('@/lib/detection/ai/verifier');
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert legacy 0-1000 bbox to pixel space */
function normToPx(norm: { x: number; y: number; width: number; height: number }, pageW: number, pageH: number) {
  return {
    x: (norm.x / 1000) * pageW,
    y: (norm.y / 1000) * pageH,
    width: (norm.width / 1000) * pageW,
    height: (norm.height / 1000) * pageH,
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
  cropB64: string | null;
  imageHash: string | null;
}

async function runYoloWithOcr(
  pngBuffer: Buffer,
  pageWidth: number,
  pageHeight: number,
  log: (msg: string) => void,
): Promise<YoloOcrDetection[]> {
  // ── 1. YOLO ──
  const yoloResult = await runYoloGeo2Page(pngBuffer, pageWidth, pageHeight);
  log(`YOLO: ${yoloResult.detections.length} detections (${yoloResult.totalTiles} tiles, ${yoloResult.durationMs}ms)`);

  const results: YoloOcrDetection[] = [];
  const ocrEnabled = env.OCR_ENGINE !== 'none';
  const batchSize = env.OCR_BATCH_SIZE ?? 5;
  const dets = yoloResult.detections;

  // ── 2. OCR per bbox (batched) ──
  for (let i = 0; i < dets.length; i += batchSize) {
    const batch = dets.slice(i, i + batchSize);

    await Promise.all(batch.map(async (det) => {
      const symbolBboxPx = det.symbolBboxPx ?? normToPx(det.bbox, pageWidth, pageHeight);

      // Crop for OCR + hash
      let cropBuffer: Buffer | null = null;
      let cropB64: string | null = null;
      let imageHash: string | null = null;
      let ocrText: string | null = null;
      let ocrConf = 0;
      let isTag = false;

      try {
        cropBuffer = await cropBBoxFromBuffer(pngBuffer, symbolBboxPx, 15);
        cropB64 = cropBuffer.toString('base64');
        imageHash = hashImage(cropB64); // hashImage expects base64 string
      } catch (e) {
        log(`crop failed for ${det.assetType}: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (ocrEnabled && cropBuffer) {
        try {
          if (env.OCR_ENGINE === 'cv-service' && CV_SERVICE_AVAILABLE()) {
            const r = await cvOcr(cropB64!, 'auto', 'eng');
            ocrText = r.text;
            ocrConf = r.confidence;
          } else {
            // Node tesseract.js
            const r = await runTagOcr(cropBuffer);
            ocrText = r.normalizedText || null;
            ocrConf = r.confidence;
            isTag = r.isTag;
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
  source: string;
  ruleConfidence: number;
  negativePenalty: number;
}> {
  const tagPrefix = det.ocrText ? extractTagPrefix(det.ocrText) : extractTagPrefix(det.rawLabel.split('.').pop() ?? '');

  const ruleResult = await validateDetection({
    tagPrefix,
    detectedAssetType: det.rawLabel.split('.').pop() ?? det.rawLabel,
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
    source: ruleResult.source,
    ruleConfidence: ruleResult.confidence,
    negativePenalty,
  };
}

// ── Stage 4: Gemini Verifier ───────────────────────────────────────────────

async function runGeminiVerifier(
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

    const session = createVerifierSession({ maxCallsPerPage: 1 });

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

// ── Stage 5: Gemini Full-page Fallback ─────────────────────────────────────

async function runGeminiFallback(
  pageImageB64: string,
  pageWidth: number,
  pageHeight: number,
  existingBboxes: Array<{ x: number; y: number; width: number; height: number }>, // normalized 0-1000
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
    const geminiResult = await runDetectionAgent({
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

    for (const gd of geminiResult.detections) {
      const gdBbox = { x: gd.bbox.x, y: gd.bbox.y, width: gd.bbox.width, height: gd.bbox.height };
      const overlaps = existingBboxes.some(ex => {
        const iou = computeIoU(
          { x1: ex.x, y1: ex.y, x2: ex.x + ex.width, y2: ex.y + ex.height },
          { x1: gdBbox.x, y1: gdBbox.y, x2: gdBbox.x + gdBbox.width, y2: gdBbox.y + gdBbox.height },
        ) >= mergeIou;
        return iou;
      });

      if (!overlaps) {
        // New detection from Gemini — apply negative learning penalty for consistency
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
          detection_source: 'GEMINI_FALLBACK' as const,
          validation_status: adjustedConf < reviewThreshold ? 'NEEDS_REVIEW' : 'VALID',
          evidence: [...(Array.isArray(gd.evidence) ? gd.evidence : []), 'Source: Gemini fallback (YOLO missed)'],
        } as PersistableDetection);
      } else {
        merged++;
      }
    }

    log(`Gemini fallback: ${geminiResult.detections.length} detections, ${newDetections.length} new (${merged} already covered by YOLO)`);
    return newDetections;
  } catch (e) {
    log(`Gemini fallback failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
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
}

export interface HybridPipelineStats {
  yoloDetections: number;
  yoloWithTags: number;
  geminiVerifierCalls: number;
  geminiFallbackDetections: number;
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
  const yoloOcrDets = await runYoloWithOcr(input.pngBuffer, input.pageWidth, input.pageHeight, pageLog);
  const yoloWithTags = yoloOcrDets.filter(d => d.isTag || d.ocrText).length;

  // ── Stage 3+4+5+7+8: Rule Validator + optional Gemini Verifier per detection ──
  const verifierEnabled = env.GEMINI_VERIFIER_ENABLED === 'true';
  const verifierThreshold = env.GEMINI_VERIFIER_THRESHOLD ?? 0.65;
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

    // Stage 4: Gemini Verifier (only for ambiguous / UNKNOWN / low confidence)
    let verifiedConf = rule.ruleConfidence;
    let verifiedType: string | null = null;
    // Derive needsHumanReview from confidence + source (no validationStatus on RuleValidationResult)
    let needsHumanReview = rule.ruleConfidence < (env.DETECTION_REVIEW_THRESHOLD ?? 0.65) || rule.source === 'UNKNOWN';

    const shouldVerify =
      verifierEnabled &&
      (rule.source === 'UNKNOWN' || rule.source === 'VISION' || rule.ruleConfidence < verifierThreshold);

    if (shouldVerify && det.cropB64 && verifierCalls < (env.VERIFIER_MAX_CALLS_PER_PAGE ?? 10)) {
      verifierCalls++;
      const v = await runGeminiVerifier(det, rule.ruleConfidence, input.legendId, input.legendSymbols, input.pageImageBase64);
      verifiedConf = v.verifiedConf;
      verifiedType = v.verifiedType;
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

    const finalAssetType = verifiedType ?? rule.resolvedAssetType;
    const finalTag = det.ocrText && det.isTag ? det.ocrText : null;

    // Build evidence array
    const evidence: string[] = [
      `YOLO GEO-2: ${det.rawLabel} (score=${det.yoloScore.toFixed(2)})`,
      `Rule: ${rule.source} → ${rule.resolvedAssetName}`,
    ];
    if (det.ocrText) evidence.push(`OCR: "${det.ocrText}" (conf=${det.ocrConfidence.toFixed(2)})`);
    if (verifiedType) evidence.push(`Gemini verifier: ${verifiedType}`);
    if (rule.negativePenalty < 0) evidence.push(`Negative learning penalty: ${rule.negativePenalty.toFixed(2)}`);

    const validationStatus: 'VALID' | 'NEEDS_REVIEW' | 'CONFLICT' =
      (needsHumanReview || finalConf < (env.DETECTION_REVIEW_THRESHOLD ?? 0.65)) ? 'NEEDS_REVIEW'
      : 'VALID';

    processedBboxesNorm.push(finalBboxNorm);

    persistable.push({
      assetTag: finalTag,
      assetType: finalAssetType,
      equipmentClass: det.rawLabel.split('.')[0] || null,
      description: null,
      confidence: finalConf,
      bbox: finalBboxNorm,
      symbolBboxPx: refinedBboxPx,
      pageDims: { pageWidth: input.pageWidth, pageHeight: input.pageHeight },
      legendSymbol: det.rawLabel,
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

  // ── Stage 5: Gemini Full-page Fallback ──
  let geminiFallbackDets: PersistableDetection[] = [];
  if (env.GEMINI_FALLBACK_ENABLED === 'true' && input.legendSymbols.length > 0) {
    geminiFallbackDets = await runGeminiFallback(
      input.pageImageBase64,
      input.pageWidth,
      input.pageHeight,
      processedBboxesNorm,
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
  const allDets = [...persistable, ...geminiFallbackDets];
  const finalDets = applyNMS(allDets, env.HYBRID_MERGE_IOU ?? 0.4) as PersistableDetection[];

  return {
    detections: finalDets,
    stats: {
      yoloDetections: yoloOcrDets.length,
      yoloWithTags,
      geminiVerifierCalls: verifierCalls,
      geminiFallbackDetections: geminiFallbackDets.length,
      totalFinal: finalDets.length,
      durationMs: Date.now() - t0,
    },
  };
}
