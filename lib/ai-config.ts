import { pool } from '@/lib/db';
import { env } from '@/lib/env';

export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'deepseek';

export interface AiConfig {
  provider: AIProvider;
  geminiKey: string | undefined;
  openaiKey: string | undefined;
  anthropicKey: string | undefined;
  deepseekKey: string | undefined;
  geminiModel: string;
  openaiModel: string;
  openaiBaseUrl?: string;
  anthropicModel: string;
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
      `SELECT ai_provider, 
              gemini_api_key, deepseek_api_key, openai_api_key, anthropic_api_key,
              gemini_model, deepseek_model, openai_model, openai_base_url, anthropic_model 
       FROM settings WHERE id=1`
    );
    const row = r.rows[0];
    if (row) {
      const validProviders: AIProvider[] = ['gemini', 'openai', 'anthropic', 'deepseek'];
      const rawProvider = String(row.ai_provider || '').toLowerCase() as AIProvider;
      const provider: AIProvider = validProviders.includes(rawProvider) ? rawProvider : 'gemini';

      const cfg: AiConfig = {
        provider,
        geminiKey: (row.gemini_api_key as string | null) || env.GEMINI_API_KEY || undefined,
        openaiKey: (row.openai_api_key as string | null) || env.OPENAI_API_KEY || undefined,
        anthropicKey: (row.anthropic_api_key as string | null) || env.ANTHROPIC_API_KEY || undefined,
        deepseekKey: (row.deepseek_api_key as string | null) || env.DEEPSEEK_API_KEY || undefined,
        geminiModel: (row.gemini_model as string | null) || env.GEMINI_MODEL,
        openaiModel: (row.openai_model as string | null) || env.OPENAI_MODEL,
        openaiBaseUrl: (row.openai_base_url as string | null) || env.OPENAI_BASE_URL || undefined,
        anthropicModel: (row.anthropic_model as string | null) || env.ANTHROPIC_MODEL,
        deepseekModel: (row.deepseek_model as string | null) || env.DEEPSEEK_MODEL,
      };
      cache = { cfg, at: Date.now() };
      return cfg;
    }
  } catch {
    // DB unavailable (e.g. during migrate) — fall through to env
  }

  const validProviders: AIProvider[] = ['gemini', 'openai', 'anthropic', 'deepseek'];
  const rawEnvProvider = String(env.AI_PROVIDER || '').toLowerCase() as AIProvider;
  const envProvider: AIProvider = validProviders.includes(rawEnvProvider) ? rawEnvProvider : 'gemini';

  const cfg: AiConfig = {
    provider: envProvider,
    geminiKey: env.GEMINI_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    anthropicKey: env.ANTHROPIC_API_KEY,
    deepseekKey: env.DEEPSEEK_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    openaiModel: env.OPENAI_MODEL,
    openaiBaseUrl: env.OPENAI_BASE_URL || undefined,
    anthropicModel: env.ANTHROPIC_MODEL,
    deepseekModel: env.DEEPSEEK_MODEL,
  };
  cache = { cfg, at: Date.now() };
  return cfg;
}

export function clearAiConfigCache() {
  cache = null;
}
