/**
 * Rule Validator Vision Prompt
 * Used when rule chain returns VISION source — Gemini acts as expert validator.
 * Input: symbol crop context + top candidates from rule chain.
 */

export interface RuleValidatorContext {
  symbolDescription: string;
  nearbyText: string | null;
  ocrContext: string | null;
  candidates: Array<{
    assetType: string;
    assetName: string;
    source: string;
    tagPattern?: string | null;
  }>;
  legendContext: string | null;
}

export function buildRuleValidatorPrompt(ctx: RuleValidatorContext): string {
  const candidateList = ctx.candidates.length > 0
    ? ctx.candidates.map((c, i) =>
        `  ${i + 1}. ${c.assetName} (${c.assetType}) [source: ${c.source}]${c.tagPattern ? ` [tag pattern: ${c.tagPattern}]` : ''}`
      ).join('\n')
    : '  No candidates found from standard databases.';

  return `You are an Engineering Vision Expert Validator.

You receive a detected symbol with context. Your task: determine the correct asset type.

SYMBOL DESCRIPTION:
${ctx.symbolDescription}

NEARBY TEXT / OCR:
${ctx.nearbyText ?? ctx.ocrContext ?? 'No nearby text detected'}

TOP CANDIDATES FROM STANDARD DATABASES:
${candidateList}

${ctx.legendContext ? `SELECTED LEGEND CONTEXT:\n${ctx.legendContext}` : ''}

VALIDATION RULES:
1. Legend has highest priority — if symbol matches a legend entry, use it
2. If multiple candidates match, pick the one with highest source priority (LEGEND > ISA > ISO > VISION)
3. If symbol clearly matches a candidate — confirm it
4. If symbol is ambiguous but a candidate is plausible — accept with reduced confidence
5. If NOTHING matches and symbol is unclear — return UNKNOWN (never hallucinate)
6. Confidence < 0.80 MUST return UNKNOWN

NEVER:
- Invent asset names not supported by visual evidence
- Accept a candidate just because it exists — verify against symbol description
- Return confidence > 0.90 without clear visual evidence

Return ONLY this JSON:
{
  "asset_type": "Pressure Transmitter",
  "asset_name": "Pressure Transmitter",
  "tag_prefix": "PT",
  "confidence": 0.88,
  "source_used": "ISA",
  "reason": "Circle symbol with P text matches ISA 5.1 Pressure Transmitter. Tag PT-101 visible nearby.",
  "is_unknown": false
}

If cannot determine:
{
  "asset_type": "UNKNOWN",
  "asset_name": "UNKNOWN",
  "tag_prefix": null,
  "confidence": 0.0,
  "source_used": "UNKNOWN",
  "reason": "Symbol shape unclear, no tag visible, no candidate matches.",
  "is_unknown": true
}`;
}
