import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { env } from '@/lib/env';
import { clearAiConfigCache } from '@/lib/ai-config';
import { clearTuningCache, getTuning, type TuningOverrides } from '@/lib/tuning';

/** Editable in the UI. Everything else in `tuning` is env-only by design. */
const EDITABLE_GROUPS = [
  'generation',
  'model',
  'regions',
  'detection',
  'validator',
  'fusion',
  'performance',
] as const;

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT ai_provider, 
              gemini_model, deepseek_model, openai_model, openai_base_url, anthropic_model,
              gemini_api_key, deepseek_api_key, openai_api_key, anthropic_api_key,
              tuning 
       FROM settings WHERE id = 1`,
    );
    const row = result.rows[0];
    const tuning = await getTuning();
    return NextResponse.json({
      ai_provider: row?.ai_provider || env.AI_PROVIDER,
      // Model defaults live in env only; no literal model id in this route.
      gemini_model: row?.gemini_model || env.GEMINI_MODEL,
      deepseek_model: row?.deepseek_model || env.DEEPSEEK_MODEL,
      openai_model: row?.openai_model || env.OPENAI_MODEL,
      openai_base_url: row?.openai_base_url || env.OPENAI_BASE_URL || '',
      anthropic_model: row?.anthropic_model || env.ANTHROPIC_MODEL,
      // Masked or indicator for keys
      has_gemini_key: Boolean(row?.gemini_api_key || env.GEMINI_API_KEY),
      has_openai_key: Boolean(row?.openai_api_key || env.OPENAI_API_KEY),
      has_anthropic_key: Boolean(row?.anthropic_api_key || env.ANTHROPIC_API_KEY),
      has_deepseek_key: Boolean(row?.deepseek_api_key || env.DEEPSEEK_API_KEY),
      // Effective values: DB override > env > code fallback. The UI edits these,
      // so what is displayed is exactly what a job will use.
      tuning: serializableTuning(tuning),
      editable_groups: EDITABLE_GROUPS,
      tuning_overrides: serializableTuning(
        (row?.tuning ?? {}) as Record<string, never>,
      ) as never,
    });
  } catch (err) {
    // A deployment that has not run migration 009 has no settings.tuning column,
    // which made this route fail with a 500 and took the whole Settings page
    // with it. Every knob still resolves from env, so degrade to an env-only
    // read plus an explicit notice instead of an error.
    if (isMissingTuningColumn(err)) {
      console.warn(
        '[settings] settings.tuning column is missing — run `npm run migrate` to apply migration 009. Serving env-only values.',
      );
      return NextResponse.json(envOnlySettings(), {
        headers: { 'x-tuning-migration-missing': '009' },
      });
    }
    console.error('Settings fetch failed:', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

/** Postgres undefined_column (42703) on the tuning column specifically. */
function isMissingTuningColumn(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code !== '42703') return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /tuning/i.test(msg);
}

/** Env-only view of settings, used when the tuning column is not present yet. */
async function envOnlySettings(): Promise<Record<string, unknown>> {
  return {
    ai_provider: env.AI_PROVIDER,
    gemini_model: env.GEMINI_MODEL,
    deepseek_model: env.DEEPSEEK_MODEL,
    openai_model: env.OPENAI_MODEL,
    anthropic_model: env.ANTHROPIC_MODEL,
    has_gemini_key: Boolean(env.GEMINI_API_KEY),
    has_openai_key: Boolean(env.OPENAI_API_KEY),
    has_anthropic_key: Boolean(env.ANTHROPIC_API_KEY),
    has_deepseek_key: Boolean(env.DEEPSEEK_API_KEY),
    tuning: serializableTuning(await getTuning()),
    editable_groups: EDITABLE_GROUPS,
    tuning_overrides: {},
    tuning_column_missing: true,
  };
}

/**
 * Sets have no JSON representation — `JSON.stringify(new Set())` is `{}`, which
 * would silently blank list fields like the JSON-incompatible model list. Send
 * them as arrays so the UI can read and round-trip them.
 */
function serializableTuning(value: unknown): unknown {
  if (value instanceof Set) return Array.from(value);
  if (Array.isArray(value)) return value.map(serializableTuning);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializableTuning(v);
    }
    return out;
  }
  return value;
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const {
      ai_provider,
      gemini_api_key,
      deepseek_api_key,
      openai_api_key,
      anthropic_api_key,
      gemini_model,
      deepseek_model,
      openai_model,
      openai_base_url,
      anthropic_model,
      tuning,
    } = body;

    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIdx = 1;

    if (ai_provider !== undefined) {
      if (!['gemini', 'openai', 'anthropic', 'deepseek'].includes(ai_provider as string)) {
        return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
      }
      updates.push(`ai_provider = $${paramIdx++}`);
      values.push(ai_provider as string);
    }
    if (gemini_api_key !== undefined) { updates.push(`gemini_api_key = $${paramIdx++}`); values.push((gemini_api_key as string) || null); }
    if (deepseek_api_key !== undefined) { updates.push(`deepseek_api_key = $${paramIdx++}`); values.push((deepseek_api_key as string) || null); }
    if (openai_api_key !== undefined) { updates.push(`openai_api_key = $${paramIdx++}`); values.push((openai_api_key as string) || null); }
    if (anthropic_api_key !== undefined) { updates.push(`anthropic_api_key = $${paramIdx++}`); values.push((anthropic_api_key as string) || null); }
    if (gemini_model) { updates.push(`gemini_model = $${paramIdx++}`); values.push(gemini_model as string); }
    if (deepseek_model) { updates.push(`deepseek_model = $${paramIdx++}`); values.push(deepseek_model as string); }
    if (openai_model) { updates.push(`openai_model = $${paramIdx++}`); values.push(openai_model as string); }
    if (openai_base_url !== undefined) {
      updates.push(`openai_base_url = $${paramIdx++}`);
      values.push((openai_base_url as string)?.trim() || null);
    }
    if (anthropic_model) { updates.push(`anthropic_model = $${paramIdx++}`); values.push(anthropic_model as string); }

    if (tuning !== undefined) {
      if (tuning !== null && (typeof tuning !== 'object' || Array.isArray(tuning))) {
        return NextResponse.json({ error: 'tuning must be an object' }, { status: 400 });
      }
      // Merge so a partial save from one section never wipes another section's
      // saved overrides.
      const current = await readStoredTuning();
      const incoming = (tuning ?? {}) as TuningOverrides;
      const merged: TuningOverrides = { ...current };
      for (const key of Object.keys(incoming) as (keyof TuningOverrides)[]) {
        if (!EDITABLE_GROUPS.includes(key)) continue;
        const prev = (current[key] ?? {}) as Record<string, unknown>;
        const next = (incoming[key] ?? {}) as Record<string, unknown>;
        merged[key] = { ...prev, ...next } as never;
      }
      updates.push(`tuning = $${paramIdx++}`);
      values.push(JSON.stringify(merged));
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(null);

    if (updates.length <= 1) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    const query = `UPDATE settings SET ${updates.join(', ')} WHERE id = 1 RETURNING 
      ai_provider, gemini_model, deepseek_model, openai_model, openai_base_url, anthropic_model,
      gemini_api_key, deepseek_api_key, openai_api_key, anthropic_api_key, tuning`;
    const result = await pool.query(query, values.slice(0, -1));

    clearAiConfigCache();
    clearTuningCache();
    const row = result.rows[0];
    const tuningRes = await getTuning({ force: true });
    return NextResponse.json({
      ai_provider: row?.ai_provider || env.AI_PROVIDER,
      gemini_model: row?.gemini_model || env.GEMINI_MODEL,
      deepseek_model: row?.deepseek_model || env.DEEPSEEK_MODEL,
      openai_model: row?.openai_model || env.OPENAI_MODEL,
      openai_base_url: row?.openai_base_url || env.OPENAI_BASE_URL || '',
      anthropic_model: row?.anthropic_model || env.ANTHROPIC_MODEL,
      has_gemini_key: Boolean(row?.gemini_api_key || env.GEMINI_API_KEY),
      has_openai_key: Boolean(row?.openai_api_key || env.OPENAI_API_KEY),
      has_anthropic_key: Boolean(row?.anthropic_api_key || env.ANTHROPIC_API_KEY),
      has_deepseek_key: Boolean(row?.deepseek_api_key || env.DEEPSEEK_API_KEY),
      tuning: serializableTuning(tuningRes),
      editable_groups: EDITABLE_GROUPS,
      tuning_overrides: serializableTuning((row?.tuning ?? {}) as Record<string, never>) as never,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Update failed';
    console.error('Settings update failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Stored overrides only (not the merged result), for merge-on-save. */
async function readStoredTuning(): Promise<TuningOverrides> {
  try {
    const r = await pool.query('SELECT tuning FROM settings WHERE id = 1');
    const raw = r.rows[0]?.tuning;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as TuningOverrides)
      : {};
  } catch {
    return {};
  }
}
