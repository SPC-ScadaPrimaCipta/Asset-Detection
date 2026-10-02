/**
 * Detection V2 — Gemini verification prompt v1 (Phase 7).
 *
 * The model is an INDEPENDENT verifier of deterministic evidence, not a
 * detector. Hard rules baked into the prompt:
 *   1. Tag is evidence, NOT ground truth — a tag prefix NEVER decides type.
 *   2. Suggested labels come ONLY from the selected legend (or UNKNOWN).
 *      Never invent Compressor/Heat Exchanger/etc.
 *   3. Crops only — the model never re-scans the full page.
 */
export const VERIFIER_PROMPT_VERSION = 'verification-v1';

export interface VerifierPromptInput {
  candidateId: string;
  deterministic: {
    confidence: number;
    decisionBand: string;
    topLabel: string | null;
    topSymbolId: string | null;
    margin: number;
    reasons: string[];
  };
  ocr: { rawText: string | null; normalizedText: string | null; isTag: boolean | null };
  selectedLegendLabels: { symbolId: string; label: string }[];
}

export function buildVerifierPrompt(input: VerifierPromptInput): string {
  const legendList = input.selectedLegendLabels
    .map((l) => `- ${l.label} (symbolId: ${l.symbolId})`)
    .join('\n');
  const det = input.deterministic;
  return `You are an independent verifier for industrial P&ID symbol detection.
You did NOT detect this candidate. A deterministic pipeline did. Your job is ONLY to verify or correct its single-candidate assessment from the provided CROPS.

CANDIDATE: ${input.candidateId}
DETERMINISTIC ASSESSMENT (for reference only, do not blindly agree):
- top label: ${det.topLabel ?? 'none'} (symbolId: ${det.topSymbolId ?? 'none'})
- deterministic confidence: ${det.confidence} (band ${det.decisionBand}, margin ${det.margin})
- deterministic reasons: ${(det.reasons ?? []).join(' | ') || 'none'}

OCR/TAG EVIDENCE (evidence only, NOT ground truth):
- raw: ${input.ocr.rawText ?? 'none'} / normalized: ${input.ocr.normalizedText ?? 'none'} / isTag: ${input.ocr.isTag ?? 'unknown'}
RULE: A tag prefix (e.g. P-101) NEVER decides the symbol type by itself. Tags can be misread, misplaced, or belong to a nearby asset.

SELECTED LEGEND (closed world — the ONLY allowed labels):
${legendList || '(none provided)'}
RULE: suggestedLabel MUST be one of the labels above, or "UNKNOWN".
If the symbol is real but matches none of the labels, use verdict UNCERTAIN with reasonCode NOT_IN_SELECTED_LEGEND and suggestedLabel "UNKNOWN".
NEVER invent labels like Compressor or Heat Exchanger.

IMAGES PROVIDED: candidate crop, wider context crop, and (when available) the associated tag crop and the top Legend reference crop.

Respond with JSON ONLY, exactly this shape:
{
  "verdict": "CONFIRM" | "CORRECT" | "UNCERTAIN" | "NO_SYMBOL",
  "suggestedSymbolId": "<symbolId from the legend list, or null>",
  "suggestedLabel": "<label from the legend list, or UNKNOWN, or null>",
  "confidence": <0..1, YOUR OWN confidence in this verdict>,
  "reasonCodes": ["<one or more of: VISUAL_MATCH, VISUAL_MISMATCH, LEGEND_CONSISTENT, LEGEND_INCONSISTENT, TAG_CONSISTENT, TAG_AMBIGUOUS, NOT_IN_SELECTED_LEGEND, NO_SYMBOL_VISIBLE, CROP_UNCLEAR, SPATIAL_PLAUSIBLE, SPATIAL_IMPLAUSIBLE>"],
  "explanation": "<1-3 sentences, grounded in the crops>",
  "uncertainties": ["<anything unclear>"],
  "needsHumanReview": <true|false>
}

Verdict guide:
- CONFIRM: crops clearly support the deterministic top label.
- CORRECT: crops clearly support a DIFFERENT label from the legend list (fill suggestedLabel/SymbolId).
- UNCERTAIN: ambiguous crop, conflicting evidence, or symbol not in the selected legend.
- NO_SYMBOL: no equipment symbol visible in the candidate crop.`;
}
