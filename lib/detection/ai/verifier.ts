/**
 * Detection V2 — Gemini verification/correction layer (Phase 7).
 *
 * LOCKED PRINCIPLES:
 *  1. Routing only: HIGH → no call (CONTINUE); REVIEW → verify; LOW → human
 *     review (Gemini only when verifyLowBand is explicitly enabled).
 *  2. Crops in, never full pages. Deterministic evidence travels as TEXT.
 *  3. Gemini NEVER overwrites deterministic evidence. Output keeps separate
 *     `deterministic` (echoed byte-identical) and `gemini` namespaces so
 *     Phase 8 can measure deterministic-only vs deterministic+Gemini.
 *  4. Suggested labels locked to the selected legend (+ UNKNOWN). Anything
 *     else is coerced to UNKNOWN and the verdict is downgraded to UNCERTAIN.
 *  5. No auto-accept: even CONFIRM 0.98 routes to HUMAN_REVIEW.
 *  6. Any AI failure (429/timeout/invalid JSON/schema) → status failed with
 *     reason; deterministic result retained; page never fails because of AI.
 */
import { createHash } from 'crypto';
import { getAiConfig } from '@/lib/ai-config';
import { getGeminiClient } from '@/lib/gemini';
import { getGenerationConfig } from '@/lib/ai-generation';
import { env } from '@/lib/env';
import {
  extractVerdictJson,
  GeminiVerdictSchema,
  type GeminiVerdictPayload,
} from '@/lib/detection/ai/verdict-schema';
import {
  buildVerifierPrompt,
  VERIFIER_PROMPT_VERSION,
} from '@/lib/detection/ai/verifier-prompt';

export interface DeterministicSnapshot {
  confidence: number;
  decisionBand: 'HIGH' | 'REVIEW' | 'LOW';
  topLabel: string | null;
  topSymbolId: string | null;
  margin: number;
  reasons: string[];
  configVersion: string;
}

export interface VerifierCrops {
  candidateCropB64: string;
  contextCropB64: string;
  tagCropB64?: string | null;
  legendRefB64?: string | null;
  /** Content hash of the candidate crop (dedup + cache key). */
  cropHash: string;
}

export interface VerifierRequest {
  candidateId: string;
  pageId: string;
  deterministic: DeterministicSnapshot;
  ocr: { rawText: string | null; normalizedText: string | null; isTag: boolean | null };
  selectedLegend: {
    legendId: string;
    version: string;
    labels: { symbolId: string; label: string }[];
  };
  crops: VerifierCrops;
}

export interface GeminiSection {
  called: boolean;
  status: 'success' | 'failed' | 'skipped';
  failureReason: string | null;
  verdict: GeminiVerdictPayload['verdict'] | null;
  suggestedSymbolId: string | null;
  suggestedLabel: string | null;
  confidence: number | null;
  reasonCodes: string[];
  explanation: string | null;
  uncertainties: string[];
  needsHumanReview: boolean;
  model: string | null;
  promptVersion: string;
  /** True when the model output was coerced (legend lock or downgrade). */
  coerced: boolean;
}

export interface VerificationOutput {
  candidateId: string;
  /** Byte-identical echo — the verifier MUST NOT modify this. */
  deterministic: DeterministicSnapshot;
  gemini: GeminiSection;
  finalRouting: 'CONTINUE' | 'HUMAN_REVIEW';
}

export interface VerifierConfig {
  verifyLowBand?: boolean;
  maxCallsPerPage?: number;
  timeoutMs?: number;
}

/** Injectable transport (tests inject fakes; default hits Gemini). */
export type GenerateFn = (
  prompt: string,
  images: { mimeType: string; data: string }[]
) => Promise<{ text: string; model: string }>;

async function defaultTransport(
  prompt: string,
  images: { mimeType: string; data: string }[],
  timeoutMs: number
): Promise<{ text: string; model: string }> {
  const cfg = await getAiConfig();
  if (cfg.provider !== 'gemini') {
    const { getVisionProvider } = await import('@/lib/ai-providers');
    const provider = await getVisionProvider(cfg);
    const model = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;
    const inlineCrops = new Map<string, string>();
    for (let i = 1; i < images.length; i++) {
      inlineCrops.set(`context_${i}`, images[i].data);
    }
    const res = await Promise.race([
      provider.generateVisionCompletion({
        model,
        prompt,
        imageBase64: images[0]?.data ?? '',
        mimeType: (images[0]?.mimeType as any) || 'image/png',
        inlineCropCrops: inlineCrops.size > 0 ? inlineCrops : undefined,
        maxTokens: 2048,
        temperature: 0.1,
        responseFormat: 'json',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI verifier timeout')), timeoutMs)
      ),
    ]);
    return { text: res.text, model };
  }

  const client = await getGeminiClient();
  const model = client.getGenerativeModel({
    model: cfg.geminiModel,
    generationConfig: await getGenerationConfig('verifier'),
  });
  const parts: unknown[] = [{ text: prompt }];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  const res = await Promise.race([
    model.generateContent({
      contents: [{ role: 'user', parts: parts as never[] }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('gemini timeout')), timeoutMs)
    ),
  ]);
  return { text: res.response.text(), model: cfg.geminiModel };
}

// Module-level verdict cache: same crop + legend + prompt + pipeline ⇒ same ask.
const verdictCache = new Map<string, GeminiSection>();

/**
 * Static scope marker for the verdict cache key. Bump only when the verifier
 * prompt or verdict schema changes in a way that invalidates old verdicts —
 * VERIFIER_PROMPT_VERSION already covers the prompt.
 */
const CACHE_KEY_SCOPE = 'verifier-v1';

export function cacheKeyFor(req: VerifierRequest): string {
  return createHash('sha256')
    .update(
      [
        req.crops.cropHash,
        req.selectedLegend.legendId,
        req.selectedLegend.version,
        VERIFIER_PROMPT_VERSION,
        // The verdict depends on the prompt, the crop and the legend. It does
        // NOT depend on the detection pipeline, so a pipeline rename must not
        // silently invalidate every cached verdict.
        CACHE_KEY_SCOPE,
      ].join('|')
    )
    .digest('hex');
}

export function clearVerifierCache(): void {
  verdictCache.clear();
}

function skippedSection(reason: string): GeminiSection {
  return {
    called: false, status: 'skipped', failureReason: reason,
    verdict: null, suggestedSymbolId: null, suggestedLabel: null,
    confidence: null, reasonCodes: [], explanation: null,
    uncertainties: [], needsHumanReview: true,
    model: null, promptVersion: VERIFIER_PROMPT_VERSION, coerced: false,
  };
}

function failedSection(reason: string, model: string | null): GeminiSection {
  return {
    called: true, status: 'failed', failureReason: reason,
    verdict: null, suggestedSymbolId: null, suggestedLabel: null,
    confidence: null, reasonCodes: [], explanation: null,
    uncertainties: [], needsHumanReview: true,
    model, promptVersion: VERIFIER_PROMPT_VERSION, coerced: false,
  };
}

/**
 * Enforce the legend lock: suggested labels must come from the selected
 * legend or be UNKNOWN. Off-list suggestions are coerced; a CORRECT verdict
 * without a valid in-legend suggestion is downgraded to UNCERTAIN.
 */
export function enforceLegendLock(
  payload: GeminiVerdictPayload,
  allowedLabels: { symbolId: string; label: string }[]
): { payload: GeminiVerdictPayload; coerced: boolean } {
  const labels = new Set(allowedLabels.map((l) => l.label));
  const ids = new Set(allowedLabels.map((l) => l.symbolId));
  let coerced = false;
  const out = { ...payload, reasonCodes: [...payload.reasonCodes], uncertainties: [...payload.uncertainties] };

  const labelOk =
    out.suggestedLabel === null || out.suggestedLabel === 'UNKNOWN' || labels.has(out.suggestedLabel);
  const idOk =
    out.suggestedSymbolId === null || ids.has(out.suggestedSymbolId);

  if (!labelOk || !idOk) {
    coerced = true;
    out.suggestedLabel = 'UNKNOWN';
    out.suggestedSymbolId = null;
    if (!out.reasonCodes.includes('NOT_IN_SELECTED_LEGEND')) {
      out.reasonCodes.push('NOT_IN_SELECTED_LEGEND');
    }
    out.uncertainties.push(
      'Model suggested a label outside the selected legend — coerced to UNKNOWN.'
    );
  }
  if (out.verdict === 'CORRECT' && (out.suggestedLabel === null || out.suggestedLabel === 'UNKNOWN')) {
    coerced = true;
    out.verdict = 'UNCERTAIN';
    out.uncertainties.push('CORRECT requires an in-legend suggestion — downgraded to UNCERTAIN.');
  }
  if (out.verdict === 'CONFIRM' && out.suggestedLabel === 'UNKNOWN') {
    coerced = true;
    out.verdict = 'UNCERTAIN';
    out.uncertainties.push('CONFIRM with UNKNOWN label is contradictory — downgraded to UNCERTAIN.');
  }
  out.needsHumanReview = true;
  return { payload: out, coerced };
}

export interface VerifierSession {
  verify: (req: VerifierRequest) => Promise<VerificationOutput>;
  stats: () => { calls: number; cacheHits: number; failures: number; skipped: number };
}

export function createVerifierSession(
  config: VerifierConfig = {},
  transport?: GenerateFn
): VerifierSession {
  // This factory is synchronous, so it reads the env layer rather than awaiting
  // tuning (which may hit the DB). An explicit VerifierConfig argument still
  // wins, so callers and tests can override anything.
  const maxCalls = config.maxCallsPerPage ?? env.VERIFIER_MAX_CALLS_PER_PAGE;
  const timeoutMs = config.timeoutMs ?? env.VERIFIER_TIMEOUT_MS;
  const cacheMax = env.VERIFIER_CACHE_MAX_ENTRIES;
  const verifyLow = config.verifyLowBand ?? false;
  let calls = 0;
  let cacheHits = 0;
  let failures = 0;
  let skipped = 0;

  const generate: GenerateFn =
    transport ??
    ((prompt, images) => defaultTransport(prompt, images, timeoutMs));

  async function verify(req: VerifierRequest): Promise<VerificationOutput> {
    const det = req.deterministic;
    // Routing rule 1: HIGH never calls Gemini.
    if (det.decisionBand === 'HIGH') {
      skipped++;
      return {
        candidateId: req.candidateId,
        deterministic: { ...det },
        gemini: skippedSection('HIGH band — no verification needed'),
        finalRouting: 'CONTINUE',
      };
    }
    // Routing rule 2: LOW calls only when explicitly configured.
    if (det.decisionBand === 'LOW' && !verifyLow) {
      skipped++;
      return {
        candidateId: req.candidateId,
        deterministic: { ...det },
        gemini: skippedSection('LOW band — direct human review (verifyLowBand off)'),
        finalRouting: 'HUMAN_REVIEW',
      };
    }
    // Budget: never exceed per-page cap.
    if (calls >= maxCalls) {
      skipped++;
      return {
        candidateId: req.candidateId,
        deterministic: { ...det },
        gemini: skippedSection(`budget exhausted (${maxCalls} calls/page)`),
        finalRouting: 'HUMAN_REVIEW',
      };
    }
    // Cache/dedup: same crop never re-verified.
    const key = cacheKeyFor(req);
    const hit = verdictCache.get(key);
    if (hit) {
      cacheHits++;
      return {
        candidateId: req.candidateId,
        deterministic: { ...det },
        gemini: { ...hit },
        finalRouting: 'HUMAN_REVIEW',
      };
    }

    calls++;
    const prompt = buildVerifierPrompt({
      candidateId: req.candidateId,
      deterministic: {
        confidence: det.confidence, decisionBand: det.decisionBand,
        topLabel: det.topLabel, topSymbolId: det.topSymbolId,
        margin: det.margin, reasons: det.reasons,
      },
      ocr: req.ocr,
      selectedLegendLabels: req.selectedLegend.labels,
    });
    const images = [
      { mimeType: 'image/png', data: req.crops.candidateCropB64 },
      { mimeType: 'image/png', data: req.crops.contextCropB64 },
      ...(req.crops.tagCropB64 ? [{ mimeType: 'image/png', data: req.crops.tagCropB64 }] : []),
      ...(req.crops.legendRefB64 ? [{ mimeType: 'image/png', data: req.crops.legendRefB64 }] : []),
    ];

    let model: string | null = null;
    try {
      const { text, model: usedModel } = await generate(prompt, images);
      model = usedModel;
      const raw = extractVerdictJson(text);
      if (!raw) {
        failures++;
        return {
          candidateId: req.candidateId,
          deterministic: { ...det },
          gemini: failedSection('invalid_json: no JSON object in response', model),
          finalRouting: 'HUMAN_REVIEW',
        };
      }
      const parsed = GeminiVerdictSchema.safeParse(raw);
      if (!parsed.success) {
        failures++;
        return {
          candidateId: req.candidateId,
          deterministic: { ...det },
          gemini: failedSection(
            `schema_mismatch: ${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(',')}`,
            model
          ),
          finalRouting: 'HUMAN_REVIEW',
        };
      }
      const { payload, coerced } = enforceLegendLock(parsed.data, req.selectedLegend.labels);
      const section: GeminiSection = {
        called: true, status: 'success', failureReason: null,
        verdict: payload.verdict,
        suggestedSymbolId: payload.suggestedSymbolId,
        suggestedLabel: payload.suggestedLabel,
        confidence: payload.confidence,
        reasonCodes: [...payload.reasonCodes],
        explanation: payload.explanation,
        uncertainties: [...payload.uncertainties],
        needsHumanReview: true, // No auto-accept — every verified candidate is reviewed.
        model, promptVersion: VERIFIER_PROMPT_VERSION, coerced,
      };
      verdictCache.set(key, { ...section });
      if (verdictCache.size > cacheMax) {
        const oldest = verdictCache.keys().next();
        if (!oldest.done) verdictCache.delete(oldest.value);
      }
      // No auto-accept: CONFIRM 0.98 still routes to HUMAN_REVIEW.
      return {
        candidateId: req.candidateId,
        deterministic: { ...det },
        gemini: section,
        finalRouting: 'HUMAN_REVIEW',
      };
    } catch (err: unknown) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      const reason = /429|quota|rate/i.test(msg)
        ? `rate_limit: ${msg.slice(0, 160)}`
        : /timeout/i.test(msg) ? `timeout: ${msg.slice(0, 160)}` : `transport: ${msg.slice(0, 160)}`;
      return {
        candidateId: req.candidateId,
        deterministic: { ...det },
        gemini: failedSection(reason, model),
        finalRouting: 'HUMAN_REVIEW',
      };
    }
  }

  return { verify, stats: () => ({ calls, cacheHits, failures, skipped }) };
}
