/**
 * Gemini generation config, from tuning.
 *
 * One place that builds `generationConfig`, so `temperature` and
 * `maxOutputTokens` are tunable per flow (Settings → .env → fallback) instead of
 * being repeated as literals in five different call sites.
 *
 * `responseMimeType` is NOT tunable: every flow in this app parses the reply as
 * JSON, so switching to text would break the schema contract everywhere.
 */

import { getTuning, type GenerationTuning } from '@/lib/tuning';

/** Named flows, mapped to their tuning entry. */
export type FlowName =
  | 'gemini'
  | 'legend'
  | 'legendCatchup'
  | 'ruleValidator'
  | 'verifier'
  | 'symbolFeatures';

export interface GeminiGenerationConfig {
  temperature: number;
  maxOutputTokens: number;
  responseMimeType: 'application/json';
}

/** Resolve one flow's parameters. Async because tuning may read the DB. */
export async function getGenerationConfig(
  flow: FlowName,
): Promise<GeminiGenerationConfig> {
  const tuning = await getTuning();
  const g: GenerationTuning = tuning.generation[flow];
  return {
    temperature: g.temperature,
    maxOutputTokens: g.maxOutputTokens,
    responseMimeType: 'application/json',
  };
}

/**
 * Synchronous variant for callers that already hold a resolved tuning object.
 * Use this rather than awaiting a second time in a loop.
 */
export function generationConfigFrom(
  generation: Record<FlowName, GenerationTuning>,
  flow: FlowName,
): GeminiGenerationConfig {
  const g = generation[flow];
  return {
    temperature: g.temperature,
    maxOutputTokens: g.maxOutputTokens,
    responseMimeType: 'application/json',
  };
}
