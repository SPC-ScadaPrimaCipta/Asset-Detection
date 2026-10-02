/**
 * model-resolver.ts
 *
 * Auto-discovers valid models from the provider's API at runtime, so no model id
 * is baked into the app: Settings (DB) → .env → discovery. Caches the result
 * per API key to avoid hammering the models endpoint on every page.
 *
 * Priority order for Gemini:
 *   1. User-configured geminiModel (from Settings/env) — if it appears in API list
 *   2. Preferred models in configured order (GEMINI_PREFERRED_MODELS)
 *   3. Any generateContent-capable model from the API
 *
 * Never throws — always returns at least the configured model so a discovery
 * outage degrades to the current setting instead of failing the job.
 */
import { getAiConfig } from '@/lib/ai-config';
import { getTuning } from '@/lib/tuning';

interface ModelCacheEntry {
  models: string[];
  expiresAt: number;
}

// In-memory cache: apiKey → entry
const cache = new Map<string, ModelCacheEntry>();

/**
 * Fetch available Gemini models from REST API.
 * Returns model id list (without "models/" prefix), or [] on error.
 */
async function fetchGeminiModels(
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/v1beta/models?key=${apiKey}&pageSize=100`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace('models/', ''));
  } catch {
    return [];
  }
}

/** Fetch available DeepSeek models from REST API. Returns [] on error. */
async function fetchDeepSeekModels(
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string; object?: string }> };
    return (data.data ?? [])
      .filter((m) => m.object === 'model')
      .map((m) => m.id);
  } catch {
    return [];
  }
}

async function getCachedModels(
  apiKey: string,
  ttlMs: number,
  fetcher: () => Promise<string[]>,
): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(apiKey);
  if (hit && hit.expiresAt > now) return hit.models;

  const models = await fetcher();
  // Only cache a non-empty result: a transient outage must not pin an empty list
  // for the whole TTL and disable discovery.
  if (models.length > 0) {
    cache.set(apiKey, { models, expiresAt: now + ttlMs });
  }
  return models;
}

/**
 * Resolve ordered list of Gemini model candidates to try.
 *
 * Returns: [configuredModel, ...validFallbacks], deduplicated.
 * The configured model is always tried first so the user's choice is respected;
 * the preferred list and then the full discovered list act as fallbacks.
 */
export async function resolveGeminiModels(): Promise<string[]> {
  const cfg = await getAiConfig();
  const tuning = await getTuning();
  const configuredModel = cfg.geminiModel;
  const { preferred, cacheTtlMs, listTimeoutMs, geminiBaseUrl } = tuning.model;

  // Discovery unavailable → configured model, then the configured preference
  // order. These ARE fallbacks by design, so a literal here is acceptable.
  const fallbackList = [configuredModel, ...preferred].filter(
    (m, i, a) => a.indexOf(m) === i,
  );

  if (!cfg.geminiKey) return fallbackList;

  const available = await getCachedModels(cfg.geminiKey, cacheTtlMs, () =>
    fetchGeminiModels(cfg.geminiKey!, geminiBaseUrl, listTimeoutMs),
  );
  if (available.length === 0) {
    console.warn(
      '[model-resolver] Gemini model list unavailable, using configured fallback order',
    );
    return fallbackList;
  }

  const availableSet = new Set(available);
  const candidates: string[] = [];

  if (availableSet.has(configuredModel)) {
    candidates.push(configuredModel);
  } else {
    console.warn(
      `[model-resolver] Configured model "${configuredModel}" not in API model list — will skip`,
    );
  }

  for (const m of preferred) {
    if (availableSet.has(m) && !candidates.includes(m)) candidates.push(m);
  }
  // Anything the API offers is still better than failing the page.
  for (const m of available) {
    if (!candidates.includes(m)) candidates.push(m);
  }

  if (candidates.length === 0) return fallbackList;
  console.log(`[model-resolver] Gemini candidates: ${candidates.slice(0, 5).join(', ')}`);
  return candidates;
}

/** Resolve ordered list of DeepSeek model candidates. */
export async function resolveDeepSeekModels(): Promise<string[]> {
  const cfg = await getAiConfig();
  const tuning = await getTuning();
  const configuredModel = cfg.deepseekModel;
  const { cacheTtlMs, listTimeoutMs, deepseekBaseUrl } = tuning.model;

  // Fallback order, same reasoning as Gemini.
  const fallbackList = [configuredModel].filter(Boolean);
  if (fallbackList.length === 0) return [];

  if (!cfg.deepseekKey) return fallbackList;

  const available = await getCachedModels(cfg.deepseekKey, cacheTtlMs, () =>
    fetchDeepSeekModels(cfg.deepseekKey!, deepseekBaseUrl, listTimeoutMs),
  );
  if (available.length === 0) return fallbackList;

  return [configuredModel, ...available.filter((m) => m !== configuredModel)].filter(
    (m, i, a) => a.indexOf(m) === i,
  );
}

/** Invalidate cache for a given API key (call after the user changes the key). */
export function invalidateModelCache(apiKey: string): void {
  cache.delete(apiKey);
}
