import { pool } from '@/lib/db';
import { env } from '@/lib/env';

export type AIProvider = 'gemini' | 'deepseek';

export interface AiConfig {
  provider: AIProvider;
  geminiKey: string | undefined;
  deepseekKey: string | undefined;
  geminiModel: string;
  deepseekModel: string;
}

// Short TTL cache so we don't hit DB per page inside detection jobs,
// but Settings changes take effect within 30s without restart.
let cache: { cfg: AiConfig; at: number } | null = null;
const TTL_MS = 30_000;

export async function getAiConfig(opts?: { force?: boolean }): Promise<AiConfig> {
  if (!opts?.force && cache && Date.now() - cache.at < TTL_MS) return cache.cfg;

  // Try DB first — this is what Settings page writes to
  try {
    const r = await pool.query(
      'SELECT ai_provider, gemini_api_key, deepseek_api_key, gemini_model, deepseek_model FROM settings WHERE id=1'
    );
    const row = r.rows[0];
    if (row) {
      const cfg: AiConfig = {
        provider: row.ai_provider === 'deepseek' ? 'deepseek' : 'gemini',
        // DB wins, env is fallback (for first boot / local dev)
        geminiKey: (row.gemini_api_key as string | null) || env.GEMINI_API_KEY || undefined,
        deepseekKey: (row.deepseek_api_key as string | null) || env.DEEPSEEK_API_KEY || undefined,
        geminiModel: (row.gemini_model as string | null) || env.GEMINI_MODEL,
        deepseekModel: (row.deepseek_model as string | null) || 'deepseek-chat',
      };
      cache = { cfg, at: Date.now() };
      return cfg;
    }
  } catch {
    // DB unavailable (e.g. during migrate) — fall through to env
  }

  const cfg: AiConfig = {
    provider: env.AI_PROVIDER as AIProvider,
    geminiKey: env.GEMINI_API_KEY,
    deepseekKey: env.DEEPSEEK_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    deepseekModel: 'deepseek-chat',
  };
  cache = { cfg, at: Date.now() };
  return cfg;
}

export function clearAiConfigCache() {
  cache = null;
}
