/**
 * Multi-legend resolution for detection jobs.
 *
 * A job references 1-3 legends, ordered by priority: the first id is the
 * primary legend and wins every symbol conflict; `detections.legend_id` stores
 * the source legend of each match instead. `legend_id` (singular) is kept as
 * the primary on the job row for backward compatibility with jobs created
 * before multi-legend existed — readers must prefer `legend_ids` and only fall
 * back to `legend_id` when the array is absent.
 */
import db from '@/lib/db';

/** Hard ceiling: more legends add prompt tokens without adding signal. */
export const MAX_JOB_LEGENDS = 3;

export interface ResolvedJobLegends {
  /** Ordered, deduplicated legend ids. Empty = auto-detect (no legend). */
  legendIds: string[];
  /** First element, or null when no legend was selected. */
  primaryLegendId: string | null;
}

/**
 * Pure normalization: array-or-singular input → ordered, deduplicated ids.
 * Returns an error string for structurally invalid input (wrong types, >3).
 * Existence/ACTIVE checks need the DB and happen in resolveJobLegendIds.
 */
export function normalizeLegendIds(body: {
  legend_id?: unknown;
  legend_ids?: unknown;
}): string[] | { error: string } {
  let raw: unknown[] = [];
  if (Array.isArray(body.legend_ids)) {
    raw = body.legend_ids;
  } else if (typeof body.legend_id === 'string' && body.legend_id.trim() !== '') {
    raw = [body.legend_id];
  }

  // Order-preserving dedupe; drop blanks up front.
  const ids: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') return { error: 'legend_ids must be an array of legend id strings' };
    const id = v.trim();
    if (id === '') continue;
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length > MAX_JOB_LEGENDS) {
    return { error: `A detection job supports at most ${MAX_JOB_LEGENDS} legends (got ${ids.length})` };
  }
  return ids;
}

/**
 * Normalize and validate a legend selection from a job request body.
 *
 * Accepts either the legacy `{ legend_id }` or `{ legend_ids }`; when both are
 * present the array wins. Returns an error string instead of throwing so routes
 * can answer 400 with a human-readable message.
 */
export async function resolveJobLegendIds(body: {
  legend_id?: unknown;
  legend_ids?: unknown;
}): Promise<ResolvedJobLegends | { error: string }> {
  const normalized = normalizeLegendIds(body);
  if (!Array.isArray(normalized)) return normalized;
  const ids = normalized;

  if (ids.length > 0) {
    // Every id must reference a usable legend — a typo or a DRAFT legend must
    // fail here with a 400, not halfway through a paid Gemini sweep.
    const found = await db.query(
      `SELECT id FROM legends WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
      [`{${ids.join(',')}}`],
    );
    const usable = new Set(found.rows.map((r) => String(r.id)));
    const bad = ids.filter((id) => !usable.has(id));
    if (bad.length > 0) {
      return { error: `Unknown or inactive legend(s): ${bad.join(', ')}` };
    }
  }

  return { legendIds: ids, primaryLegendId: ids[0] ?? null };
}

/**
 * Effective legend list for a job row, newest column first.
 *
 * `legend_ids` is authoritative when present; `legend_id` covers jobs created
 * before multi-legend existed (and rows whose array was never backfilled).
 */
export function effectiveJobLegendIds(row: {
  legend_ids?: unknown;
  legend_id?: unknown;
}): string[] {
  if (Array.isArray(row.legend_ids)) {
    const ids = (row.legend_ids as unknown[]).filter(
      (v): v is string => typeof v === 'string' && v !== '',
    );
    if (ids.length > 0) return ids.slice(0, MAX_JOB_LEGENDS);
  }
  if (typeof row.legend_id === 'string' && row.legend_id !== '') return [row.legend_id];
  return [];
}

/** One ACTIVE legend symbol row, as read from legend_symbols. */
export interface JobLegendSymbolRow {
  id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  description: string | null;
  aliases: string[];
  standard_code: string | null;
  isa_function_code: string | null;
  iso_category: string | null;
  /** Storage filename for the reference crop image (e.g. legend-{id}-p1-{hash}.png). */
  reference_image_url: string | null;
  quality_status?: string | null;
}

/** A legend with its symbols, in job priority order (index 0 = primary). */
export interface JobLegendWithSymbols {
  id: string;
  name: string;
  symbols: JobLegendSymbolRow[];
}

/**
 * Coerce raw `legend_symbols` rows into typed symbol rows.
 *
 * DB rows arrive as untyped records; coercing here (instead of casting at the
 * call site) keeps one place responsible for the column contract. `aliases`
 * tolerates both Postgres arrays and JSON strings.
 */
export function toJobLegendSymbolRows(rows: Record<string, unknown>[]): JobLegendSymbolRow[] {
  return rows.map((r) => {
    const aliases = Array.isArray(r.aliases)
      ? (r.aliases as unknown[]).map((a) => String(a))
      : typeof r.aliases === 'string'
        ? (r.aliases as string).split(',').map((a) => a.trim()).filter(Boolean)
        : [];
    return {
      id: String(r.id ?? ''),
      asset_type: String(r.asset_type ?? 'Unknown'),
      symbol_name: typeof r.symbol_name === 'string' ? r.symbol_name : null,
      tag_pattern: typeof r.tag_pattern === 'string' ? r.tag_pattern : null,
      description: typeof r.description === 'string' ? r.description : null,
      aliases,
      standard_code: typeof r.standard_code === 'string' ? r.standard_code : null,
      isa_function_code: typeof r.isa_function_code === 'string' ? r.isa_function_code : null,
      iso_category: typeof r.iso_category === 'string' ? r.iso_category : null,
      reference_image_url: typeof r.reference_image_url === 'string' ? r.reference_image_url : null,
      quality_status: typeof r.quality_status === 'string' ? r.quality_status : null,
    };
  });
}

/**
 * A symbol merged from up to MAX_JOB_LEGENDS legends, carrying its source.
 *
 * `detections.legend_id` is written from `sourceLegendId`, so every detection
 * row records which legend actually produced the match — not the job primary.
 */
export interface MergedLegendSymbol extends JobLegendSymbolRow {
  /** Duplicate of sourceLegendId, so the merged list satisfies LegendSymbol. */
  legend_id: string;
  sourceLegendId: string;
  sourceLegendName: string;
  /** 0-based priority: 0 = primary legend. */
  sourcePriority: number;
}

/**
 * Merge several legends into one ordered symbol list.
 *
 * Conflict rule (user decision): strict priority. The dedup key is
 * `asset_type + symbol_name` (case-insensitive); the first legend in priority
 * order wins and later duplicates are dropped from the prompt entirely, so the
 * model never sees two competing definitions of the same symbol.
 */
export function mergeLegendSymbols(legends: JobLegendWithSymbols[]): MergedLegendSymbol[] {
  const seen = new Set<string>();
  const merged: MergedLegendSymbol[] = [];
  legends.forEach((legend, priority) => {
    for (const s of legend.symbols) {
      const key = `${String(s.asset_type ?? '').toLowerCase()}\0${String(s.symbol_name ?? '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...s, legend_id: legend.id, sourceLegendId: legend.id, sourceLegendName: legend.name, sourcePriority: priority });
    }
  });
  return merged;
}

/** A tag-pattern regex that remembers which legend it came from. */
export interface SourcedTagPattern {
  regex: RegExp;
  legendName: string;
  legendId: string;
}

/** `tag_pattern` (P-### style) → RegExp. Shared with the worker's builder. */
export function tagPatternToRegExp(raw: string): RegExp {
  const esc = raw
    .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
    .replace(/#/g, '\\d')
    .replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

/** Union of every legend's tag patterns, in priority order. */
export function buildSourcedTagPatterns(symbols: MergedLegendSymbol[]): SourcedTagPattern[] {  const out: SourcedTagPattern[] = [];
  for (const s of symbols) {
    if (!s.tag_pattern) continue;
    out.push({
      regex: tagPatternToRegExp(String(s.tag_pattern)),
      legendName: s.sourceLegendName,
      legendId: s.sourceLegendId,
    });
  }
  return out;
}
