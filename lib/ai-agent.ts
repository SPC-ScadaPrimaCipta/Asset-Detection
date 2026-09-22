/**
 * AI Detection Agent — Multi-Step Pipeline
 *
 * Pipeline per page:
 *   Step 1: Gemini Vision detects symbols (symbol-detector prompt)
 *   Step 2: Rule Validator resolves each detection via priority chain
 *            Legend > Company KB > ISA > ISO > Vision > UNKNOWN
 *   Step 3: Calibrate confidence + apply UNKNOWN threshold
 *
 * Result: structured detections with detection_source, resolved names, calibrated confidence.
 */

import OpenAI from 'openai';
import type { Part } from '@google/generative-ai';
import { getAiConfig } from '@/lib/ai-config';
import { buildSymbolDetectorPrompt } from '@/lib/ai-prompts/symbol-detector';
import { buildRuleValidatorPrompt } from '@/lib/ai-prompts/rule-validator-prompt';
import { PageDetectionSchema } from '@/lib/ai-schemas';
import type { Detection } from '@/lib/ai-schemas';
import {
  validateDetection,
  extractTagPrefix,
  type LegendSymbol,
  type DetectionSource,
  type RuleValidationResult,
} from '@/lib/rule-validator';
import { DetectionAudit } from '@/lib/detection-audit';
import { imageToCanonical, type SymbolFeatures } from '@/lib/feature-extractor';
import { embedCanonical } from '@/lib/embedding-service';
import { hashImage } from '@/lib/symbol-cache';
import { cropPageRegion, adaptiveExpandBBox } from '@/lib/image-crop';

export interface DetectionJobInput {
  page: number;
  pageImageBase64?: string;
  fileUri?: string;
  pdfBase64?: string;
  legendId: string;
  legendSymbols: LegendSymbol[];
  ocrText?: string;
  pngWidth?: number;
  pngHeight?: number;
  projectId?: string | null;
  drawingType?: string | null;    // e.g. 'P&ID', 'PFD', 'ISOMETRIC' — inferred from filename
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
  validation_status: 'VALID' | 'NEEDS_REVIEW' | 'CONFLICT';
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
    tag: { source: string; normalized: boolean; correctionReason: string | null } | null;
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

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|rate|timeout|503|ECONN|fetch|network/i.test(msg);
      if (!retryable || i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw last;
}

// Only models confirmed to exist in Gemini API
const KNOWN_GOOD_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

export async function runDetectionAgent(input: DetectionJobInput): Promise<ResolvedPageDetection> {
  const cfg = await getAiConfig();
  const prompt = buildSymbolDetectorPrompt(input.legendSymbols);

  // Step 1: Vision detection
  let rawDetections: Detection[];
  if (cfg.provider === 'deepseek' && cfg.deepseekKey) {
    const raw = await withRetry(() => runWithDeepSeek(input, prompt, cfg.deepseekKey!));
    rawDetections = raw.detections;
  } else {
    if (!cfg.geminiKey) throw new Error('GEMINI_API_KEY not configured — set in Settings page or .env.local');
    const raw = await withRetry(() => runWithGemini(input, prompt, cfg.geminiModel));
    rawDetections = raw.detections;
  }

  // Step 2: Rule validation — run priority chain per detection.
  // Speed: parallel batch of FEATURE_BATCH_SIZE (default 5) to avoid serial Gemini calls
  // per symbol while staying within rate limits. Accuracy pipeline unchanged.
  const FEATURE_BATCH_SIZE = parseInt(process.env.FEATURE_BATCH_SIZE ?? '5', 10);

  // Per-symbol async work: crop → hash → feature extract → embed → validate
  async function processOneDetection(d: Detection): Promise<ResolvedDetection> {
    const tagPrefix = extractTagPrefix(d.assetTag);

    // ── Feature extraction + embedding (best-effort, non-blocking) ─────────
    let imageHash: string | null = null;
    let canonicalFeatures: string | null = null;
    let symbolEmbedding: number[] | null = null;
    let symbolFeatures: SymbolFeatures | null = null;

    // M15: Skip feature extraction for clearly high-confidence detections.
    // Rationale: if AI returned >= 0.92 confidence AND legend/cache will likely confirm,
    // spending a Gemini call per symbol adds latency without improving accuracy.
    // Feature extraction still runs for uncertain detections (< 0.92) where
    // embedding similarity search can differentiate between similar symbols.
    // SKIP_FEATURE_EXTRACTION env var (default false) disables entirely if needed.
    const skipFeatures = process.env.SKIP_FEATURE_EXTRACTION === 'true'
      || d.confidence >= 0.92;

    if (!skipFeatures && input.pageImageBase64 && input.pngWidth && input.pngHeight) {
      try {
        // M2: Use adaptive expansion — small symbols get smaller pad (less noise),
        // large symbols get proportionally larger pad. Min 20, max 80 units.
        const expandedBbox = adaptiveExpandBBox(d.bbox);
        const cropBase64 = await cropPageRegion(
          input.pageImageBase64,
          expandedBbox,
          input.pngWidth,
          input.pngHeight,
          0.0  // padFraction=0 here since adaptiveExpandBBox already expanded
        );

        if (cropBase64) {
          imageHash = hashImage(cropBase64);

          const extracted = await imageToCanonical(cropBase64);
          if (extracted) {
            canonicalFeatures = extracted.canonical;
            symbolFeatures = extracted.features;
            const embResult = await embedCanonical(extracted.canonical);
            if (embResult) {
              symbolEmbedding = embResult.embedding;
            }
          }
        } else {
          console.warn(`[features] crop returned null for ${d.assetTag ?? d.assetType} bbox=${JSON.stringify(d.bbox)}`);
        }
      } catch (featureErr) {
        console.warn(`[features] extraction failed for ${d.assetTag ?? d.assetType}:`, featureErr instanceof Error ? featureErr.message : featureErr);
      }
    } else if (input.pageImageBase64) {
      // pngWidth/pngHeight not available — fall back to full page hash only
      imageHash = hashImage(input.pageImageBase64);
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
        ocrText: input.ocrText,
        imageHash,
        cropHash: imageHash,
        symbolEmbedding,
        canonicalFeatures,
        symbolFeatures: symbolFeatures as Record<string, unknown> | null,
        drawingType: input.drawingType ?? null,
      });
    } catch (err) {
      console.warn(`[rule-validator] failed for ${d.assetTag ?? d.assetType}:`, err);
      validation = {
        source: 'VISION',
        resolvedAssetType: d.assetType,
        resolvedAssetName: d.assetType,
        tagPrefix,
        confidence: d.confidence,
        confidenceBreakdown: { legend: 0, company: 0, embedding: 0, ocr: 0, rules: 0, vision: d.confidence },
        ruleApplied: 'Rule validation error — fallback to Vision result',
        audit: null as never,
      };
    }

    // Step 3: If UNKNOWN from rule chain but AI had high confidence, still flag as VISION
    const finalAssetType = validation.source === 'UNKNOWN' ? 'UNKNOWN' : validation.resolvedAssetType;
    const finalConfidence = validation.confidence;

    // F5: Compute validation_status
    const ruleText = validation.ruleApplied ?? '';
    const hasConflict = ruleText.includes('CONFLICT') || ruleText.includes('conflict');
    const isUnknown = validation.source === 'UNKNOWN';
    const isVisionOnly = validation.source === 'VISION';
    const serviceIsVisionOnly = isVisionOnly && !!(d as Record<string, unknown>).service;
    const mainEqIsVisionOnly = isVisionOnly && !!(d as Record<string, unknown>).mainEquipment;
    const hasLowEvidenceField = serviceIsVisionOnly || mainEqIsVisionOnly;

    let validationStatus: 'VALID' | 'NEEDS_REVIEW' | 'CONFLICT';
    if (hasConflict) {
      validationStatus = 'CONFLICT';
    } else if (isUnknown || hasLowEvidenceField || finalConfidence < 0.65) {
      validationStatus = 'NEEDS_REVIEW';
    } else {
      validationStatus = 'VALID';
    }

    // G2: Per-field confidence scores
    const tagVal = (d as Record<string, unknown>).assetTag as string | null;
    const serviceVal = (d as Record<string, unknown>).service as string | null;
    const mainEqVal = (d as Record<string, unknown>).mainEquipment as string | null;
    const descVal = d.description as string | null;

    const fieldConfidence: ResolvedDetection['field_confidence'] = {
      tag: tagVal
        ? (validation.source === 'LEGEND' || validation.source === 'CACHE' || validation.source === 'COMPANY_KB')
          ? Math.min(finalConfidence + 0.02, 1.0)
          : finalConfidence
        : null,
      type: finalConfidence,
      service: serviceVal
        ? (validation.source === 'COMPANY_KB' || validation.source === 'LEGEND')
          ? 0.80
          : isVisionOnly ? 0.45 : 0.65
        : null,
      mainEquipment: mainEqVal
        ? (validation.source === 'COMPANY_KB' || validation.source === 'LEGEND')
          ? 0.80
          : isVisionOnly ? 0.40 : 0.60
        : null,
      description: descVal
        ? isVisionOnly ? 0.50 : 0.70
        : null,
    };

    // G3: Per-field provenance
    const sourceLabel = validation.source as string;
    const fieldProvenance: ResolvedDetection['field_provenance'] = {
      tag: tagVal ? {
        source: sourceLabel,
        normalized: false,
        correctionReason: null,
      } : null,
      type: {
        source: sourceLabel,
        inferred: validation.source === 'VISION' || validation.source === 'UNKNOWN',
      },
      service: serviceVal ? {
        source: isVisionOnly ? 'VISION' : sourceLabel,
        inferred: isVisionOnly,
      } : null,
      mainEquipment: mainEqVal ? {
        source: isVisionOnly ? 'VISION' : sourceLabel,
        inferred: isVisionOnly,
      } : null,
      description: descVal ? {
        source: isVisionOnly ? 'VISION' : sourceLabel,
        inferred: isVisionOnly,
      } : null,
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
  const resolvedDetections: ResolvedDetection[] = new Array(rawDetections.length);
  for (let i = 0; i < rawDetections.length; i += FEATURE_BATCH_SIZE) {
    const batch = rawDetections.slice(i, i + FEATURE_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(d => processOneDetection(d)));
    for (let j = 0; j < batchResults.length; j++) {
      resolvedDetections[i + j] = batchResults[j];
    }
  }

  // Step 4: Calibrate confidence
  const calibrated = calibrateConfidence(resolvedDetections, input.ocrText);

  return { page: input.page, detections: calibrated };
}

async function runWithGemini(input: DetectionJobInput, prompt: string, preferredModel: string) {
  const { getGeminiClient } = await import('@/lib/gemini');
  const client = await getGeminiClient();

  const FALLBACK_MODELS = [
    preferredModel,
    ...KNOWN_GOOD_FALLBACK_MODELS,
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  let mediaPart: Part;
  let contextText: string;

  // M3: Build OCR supporting evidence block — sent to Gemini as additional context.
  // OCR is supporting evidence, NOT authoritative. Gemini must compare OCR vs visual.
  // Truncate to 8000 chars (well within Gemini context; OCR per page usually <4000 chars).
  const ocrBlock = input.ocrText?.trim()
    ? `\nOCR TEXT (supporting evidence — compare against visual, do NOT blindly trust):
${input.ocrText.slice(0, 8000)}
IMPORTANT: If OCR tag differs from what you visually read, keep the visually-confirmed tag and note the discrepancy in evidence. OCR may have OCR errors (O↔0, I↔1, etc.).`
    : '';

  // M5: Drawing type context block
  const drawingTypeBlock = input.drawingType
    ? `\nDRAWING TYPE: ${input.drawingType} — interpret all symbols and tags in this context.`
    : '';

  if (input.pageImageBase64) {
    mediaPart = { inlineData: { mimeType: 'image/png', data: input.pageImageBase64 } };
    const dimInfo = (input.pngWidth && input.pngHeight)
      ? `Image dimensions: ${input.pngWidth} x ${input.pngHeight} pixels.`
      : 'Image rendered at high resolution.';
    contextText = `This is page ${input.page} of a P&ID document, rendered as a PNG image.
${dimInfo}${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding box coordinates in 0-1000 normalized space where (0,0)=top-left and (1000,1000)=bottom-right of the image. DO NOT return pixel coordinates. Scale: x_normalized = (x_pixel / image_width) * 1000.
Detect ALL equipment symbols on THIS PAGE. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }${ocrBlock}`;
  } else if (input.fileUri) {
    mediaPart = { fileData: { mimeType: 'application/pdf', fileUri: input.fileUri } };
    contextText = `This is a multi-page P&ID PDF. Analyze ONLY page ${input.page}. Ignore all other pages.${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding box in 0-1000 normalized space, (0,0)=top-left of page ${input.page}.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }${ocrBlock}`;
  } else if (input.pdfBase64) {
    mediaPart = { inlineData: { mimeType: 'application/pdf', data: input.pdfBase64 } };
    contextText = `Analyze ONLY page ${input.page} of this P&ID PDF. Ignore all other pages.${drawingTypeBlock}
BBOX INSTRUCTIONS: Return bounding box in 0-1000 normalized space.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }${ocrBlock}`;
  } else {
    throw new Error('At least one of pageImageBase64, fileUri, or pdfBase64 must be provided');
  }

  let lastError: unknown;
  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`[gemini] trying model=${modelName} page=${input.page}`);
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      });
      const result = await model.generateContent([{ text: prompt }, { text: contextText }, mediaPart]);
      const raw = result.response.text();
      const json = extractJson(raw) as Record<string, unknown>;
      const parsed = PageDetectionSchema.safeParse(json.page !== undefined ? json : { ...json, page: input.page });
      if (!parsed.success) {
        throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.flatten())} — raw: ${raw.slice(0, 800)}`);
      }
      parsed.data.page = input.page;
      console.log(`[gemini] success model=${modelName} detections=${parsed.data.detections.length}`);
      return parsed.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const shouldFallback = /429|quota|rate.limit|not.found|no.longer.available|404|503|unavailable/i.test(msg);
      console.warn(`[gemini] model=${modelName} failed: ${msg.slice(0, 200)}`);
      if (shouldFallback) {
        lastError = e;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new Error('All Gemini models exhausted');
}

async function runWithDeepSeek(input: DetectionJobInput, prompt: string, apiKey: string) {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
  const { deepseekModel } = await getAiConfig();
  const isVisionModel = /vl/i.test(deepseekModel);

  let userContent: OpenAI.Chat.ChatCompletionMessageParam['content'];

  if (isVisionModel && input.pageImageBase64) {
    userContent = [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${input.pageImageBase64}` } },
      {
        type: 'text',
        text: `Analyze page ${input.page} of this P&ID document.
BBOX INSTRUCTIONS: Return bounding box in 0-1000 normalized space, (0,0)=top-left.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`,
      },
    ];
  } else {
    const ocr = input.ocrText
      ? `\n\nOCR text extracted from page ${input.page}:\n${input.ocrText.slice(0, 12000)}`
      : '\n\nNo OCR text available.';
    const layoutHint = input.pngWidth && input.pngHeight
      ? `\nPage dimensions: ${input.pngWidth}x${input.pngHeight}px.`
      : '';
    userContent = `Analyze page ${input.page} of this P&ID. Use OCR text to identify asset tags and equipment labels.${layoutHint}${ocr}
BBOX: Estimate bounding boxes in 0-1000 normalized space.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  }

  const completion = await client.chat.completions.create({
    model: deepseekModel,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0].message.content || '{}';
  const json = extractJson(text) as Record<string, unknown>;
  const parsed = PageDetectionSchema.safeParse(json.page !== undefined ? json : { ...json, page: input.page });
  if (!parsed.success) throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.flatten())}`);
  parsed.data.page = input.page;
  return parsed.data;
}

/**
 * Confidence calibration — objective penalty based on verifiable signals.
 */
export function calibrateConfidence(detections: ResolvedDetection[], ocrText?: string): ResolvedDetection[] {
  const ocrUpper = (ocrText ?? '').toUpperCase();

  return detections.map((d) => {
    // UNKNOWN detections: force low confidence + NEEDS_REVIEW
    if (d.detection_source === 'UNKNOWN') {
      return {
        ...d,
        confidence: Math.min(d.confidence, 0.50),
        validation_status: 'NEEDS_REVIEW' as const,
      };
    }

    let penalty = 0;
    if (!d.assetTag) penalty += 0.05;
    if (d.assetTag && ocrText && ocrUpper.indexOf(d.assetTag.toUpperCase()) === -1) penalty += 0.10;
    if (d.evidence.length <= 1) penalty += 0.03;
    if (d.bbox.width > 250 || d.bbox.height > 250) penalty += 0.05;
    if (d.bbox.width <= 1 || d.bbox.height <= 1) {
      return {
        ...d,
        confidence: Math.min(d.confidence, 0.30),
        validation_status: 'NEEDS_REVIEW' as const,
      };
    }

    const calibrated = Math.max(0, Math.min(1, d.confidence - penalty));
    // F5: if calibrated confidence drops below NEEDS_REVIEW threshold, upgrade status
    const calibratedStatus: 'VALID' | 'NEEDS_REVIEW' | 'CONFLICT' =
      d.validation_status === 'CONFLICT'
        ? 'CONFLICT'
        : (calibrated < 0.65 || penalty >= 0.10)
          ? 'NEEDS_REVIEW'
          : d.validation_status;

    if (penalty > 0) {
      // G2: Also reduce tag field_confidence when OCR penalty applies
      const updatedFieldConf = penalty >= 0.10 && d.field_confidence?.tag != null
        ? { ...d.field_confidence, tag: Math.max(0, d.field_confidence.tag - 0.15) }
        : d.field_confidence;

      return {
        ...d,
        confidence: calibrated,
        validation_status: calibratedStatus,
        field_confidence: updatedFieldConf,
        evidence: penalty >= 0.10
          ? [...d.evidence, `Confidence adjusted: tag not confirmed in OCR text`]
          : d.evidence,
      };
    }
    return d;
  });
}

/**
 * Robust JSON extraction with truncated JSON recovery.
 */
export function extractJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const s = (m ? m[1] : text).trim();

  try { return JSON.parse(s); } catch { /* continue */ }

  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* continue */ }
  }

  // Truncated JSON recovery
  if (start !== -1) {
    const partial = s.slice(start);
    const pageMatch = partial.match(/"page"\s*:\s*(\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1]) : 1;
    const detections: unknown[] = [];
    const detectionsStart = partial.indexOf('"detections"');
    if (detectionsStart !== -1) {
      const arrStart = partial.indexOf('[', detectionsStart);
      if (arrStart !== -1) {
        let depth = 0;
        let objStart = -1;
        for (let i = arrStart + 1; i < partial.length; i++) {
          const c = partial[i];
          if (c === '{') { if (depth === 0) objStart = i; depth++; }
          else if (c === '}') {
            depth--;
            if (depth === 0 && objStart !== -1) {
              try { detections.push(JSON.parse(partial.slice(objStart, i + 1))); } catch { /* skip */ }
              objStart = -1;
            }
          }
        }
      }
    }
    if (detections.length > 0) {
      console.warn(`[extractJson] Recovered ${detections.length} detections from truncated JSON`);
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
  candidates: Array<{ assetType: string; assetName: string; source: string; tagPattern?: string | null }>
): Promise<{ asset_type: string; confidence: number; source_used: string; reason: string; is_unknown: boolean } | null> {
  try {
    const cfg = await getAiConfig();
    if (!cfg.geminiKey) return null;

    const { getGeminiClient } = await import('@/lib/gemini');
    const client = await getGeminiClient();

    const legendContext = input.legendSymbols.length > 0
      ? (() => {
          const tagPfx = detection.assetTag?.match(/^([A-Z]{1,6})/i)?.[1]?.toUpperCase();
          const detType = detection.assetType?.toLowerCase() ?? '';
          // Sort by relevance: prefix match > type match > rest
          const ranked = [...input.legendSymbols].sort((a, b) => {
            const aPatPfx = a.tag_pattern?.split('-')[0].replace(/#|\*/g,'').toUpperCase() ?? '';
            const bPatPfx = b.tag_pattern?.split('-')[0].replace(/#|\*/g,'').toUpperCase() ?? '';
            const aScore = (tagPfx && aPatPfx === tagPfx ? 2 : 0)
              + (a.asset_type.toLowerCase().includes(detType) || detType.includes(a.asset_type.toLowerCase()) ? 1 : 0);
            const bScore = (tagPfx && bPatPfx === tagPfx ? 2 : 0)
              + (b.asset_type.toLowerCase().includes(detType) || detType.includes(b.asset_type.toLowerCase()) ? 1 : 0);
            return bScore - aScore;
          });
          return ranked.slice(0, 20).map(s => `• ${s.symbol_name ?? s.asset_type}${s.tag_pattern ? ` [${s.tag_pattern}]` : ''}`).join('\n');
        })()
      : null;

    const prompt = buildRuleValidatorPrompt({
      symbolDescription: `Symbol detected as "${detection.assetType}" with confidence ${detection.confidence}. ${detection.evidence.join('. ')}`,
      nearbyText: detection.assetTag,
      ocrContext: input.ocrText?.slice(0, 500) ?? null,
      candidates,
      legendContext,
    });

    const model = client.getGenerativeModel({
      model: cfg.geminiModel,
      generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' },
    });

    const result = await model.generateContent([{ text: prompt }]);
    const raw = result.response.text();
    return JSON.parse(raw) as { asset_type: string; confidence: number; source_used: string; reason: string; is_unknown: boolean };
  } catch {
    return null;
  }
}
