/**
 * model-resolver.ts
 *
 * Auto-discovers valid models from the provider's API at runtime.
 * Caches result per API key (TTL: 10 min) so detection jobs don't
 * hammer the models endpoint on every page.
 *
 * Priority order for Gemini:
 *   1. User-configured geminiModel (from Settings/env) — if it appears in API list
 *   2. Best available flash model from API (ordered by preference)
 *   3. Any generateContent-capable model from API
 *
 * Never throws — always returns at least the configured model as fallback
 * so existing behavior is preserved even if API is unreachable.
 */

import { getAiConfig } from '@/lib/ai-config';

// In-memory cache: apiKey → { models, expiresAt }
const cache = new Map<string, { models: string[]; expiresAt: number }>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

// Preferred Gemini flash models in priority order
const GEMINI_PREFERRED = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-002',
];

/**
 * Fetch available Gemini models from REST API.
 * Returns model id list (without "models/" prefix).
 * Returns [] on error.
 */
async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    return (data.models ?? [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
  } catch {
    return [];
  }
}

/**
 * Fetch available DeepSeek models from REST API.
 * Returns model id list.
 * Returns [] on error.
 */
async function fetchDeepSeekModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<{ id: string; object?: string }> };
    return (data.data ?? [])
      .filter(m => m.object === 'model')
      .map(m => m.id);
  } catch {
    return [];
  }
}

async function getCachedModels(apiKey: string, fetcher: (k: string) => Promise<string[]>): Promise<string[]> {
  const now = Date.now();
  const cached = cache.get(apiKey);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await fetcher(apiKey);
  if (models.length > 0) {
    cache.set(apiKey, { models, expiresAt: now + TTL_MS });
  }
  return models;
}

/**
 * Resolve ordered list of Gemini model candidates to try.
 *
 * Returns: [configuredModel, ...validFallbacks] deduplicated.
 * Always includes configuredModel first so user setting is respected.
 * If API is unreachable, returns hardcoded safe fallbacks.
 */
export async function resolveGeminiModels(): Promise<string[]> {
  const cfg = await getAiConfig();
  const configuredModel = cfg.geminiModel;

  const hardcodedFallback = [
    configuredModel,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ].filter((m, i, a) => a.indexOf(m) === i);

  if (!cfg.geminiKey) return hardcodedFallback;

  const available = await getCachedModels(cfg.geminiKey, fetchGeminiModels);
  if (available.length === 0) {
    // API unreachable — use hardcoded fallback
    console.warn('[model-resolver] Gemini model list unavailable, using hardcoded fallback');
    return hardcodedFallback;
  }

  const availableSet = new Set(available);

  // Build ordered candidate list:
  // 1. User-configured model (if valid)
  // 2. Preferred flash models (if available)
  // 3. Any remaining available models
  const candidates: string[] = [];

  if (availableSet.has(configuredModel)) {
    candidates.push(configuredModel);
  } else {
    console.warn(`[model-resolver] Configured model "${configuredModel}" not in API model list — will skip`);
  }

  for (const m of GEMINI_PREFERRED) {
    if (availableSet.has(m) && !candidates.includes(m)) {
      candidates.push(m);
    }
  }

  // Add remaining available models not already in list (last resort)
  for (const m of available) {
    if (!candidates.includes(m)) candidates.push(m);
  }

  if (candidates.length === 0) return hardcodedFallback;

  console.log(`[model-resolver] Gemini candidates: ${candidates.slice(0, 5).join(', ')}`);
  return candidates;
}

/**
 * Resolve ordered list of DeepSeek model candidates.
 */
export async function resolveDeepSeekModels(): Promise<string[]> {
  const cfg = await getAiConfig();
  const configuredModel = cfg.deepseekModel ?? 'deepseek-chat';

  const hardcodedFallback = [configuredModel, 'deepseek-chat'];

  if (!cfg.deepseekKey) return hardcodedFallback;

  const available = await getCachedModels(cfg.deepseekKey, fetchDeepSeekModels);
  if (available.length === 0) return hardcodedFallback;

  const candidates = [configuredModel, ...available.filter(m => m !== configuredModel)];
  return candidates.filter((m, i, a) => a.indexOf(m) === i);
}

/** Invalidate cache for a given API key (call after user changes key in Settings) */
export function invalidateModelCache(apiKey: string) {
  cache.delete(apiKey);
}
