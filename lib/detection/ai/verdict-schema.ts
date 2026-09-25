/**
 * Detection V2 — Gemini verdict schema (Phase 7).
 *
 * Structured output ONLY. Free prose never touches the database.
 * Verdicts: CONFIRM | CORRECT | UNCERTAIN | NO_SYMBOL.
 * suggestedLabel is constrained to the SELECTED legend labels or "UNKNOWN" —
 * enforced in verifier.ts (never trust the model on this).
 */
import { z } from 'zod';

export const GeminiVerdict = z.enum(['CONFIRM', 'CORRECT', 'UNCERTAIN', 'NO_SYMBOL']);
export type GeminiVerdict = z.infer<typeof GeminiVerdict>;

export const VerdictReasonCode = z.enum([
  'VISUAL_MATCH',
  'VISUAL_MISMATCH',
  'LEGEND_CONSISTENT',
  'LEGEND_INCONSISTENT',
  'TAG_CONSISTENT',
  'TAG_AMBIGUOUS',
  'NOT_IN_SELECTED_LEGEND',
  'NO_SYMBOL_VISIBLE',
  'CROP_UNCLEAR',
  'SPATIAL_PLAUSIBLE',
  'SPATIAL_IMPLAUSIBLE',
]);
export type VerdictReasonCode = z.infer<typeof VerdictReasonCode>;

export const GeminiVerdictSchema = z.object({
  verdict: GeminiVerdict,
  suggestedSymbolId: z.string().nullable().default(null),
  suggestedLabel: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(VerdictReasonCode).min(1),
  explanation: z.string().min(1).max(2000),
  uncertainties: z.array(z.string()).default([]),
  needsHumanReview: z.boolean(),
});
export type GeminiVerdictPayload = z.infer<typeof GeminiVerdictSchema>;

/** Extract first {...} JSON object (fences tolerated), else null. */
export function extractVerdictJson(text: string): unknown | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = (fenced ? fenced[1] : text).trim();
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    return null;
  }
}
