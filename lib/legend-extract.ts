import { getAiConfig } from '@/lib/ai-config';
import { getGeminiClient } from '@/lib/gemini';
import { getTuning } from '@/lib/tuning';
import { env } from '@/lib/env';
import { generationConfigFrom } from '@/lib/ai-generation';
import { resolveGeminiModels } from '@/lib/model-resolver';
import {
  ModelCircuitBreaker,
  isProviderUnavailable,
  getSharedModelBreaker,
} from '@/lib/ai-circuit-breaker';
import { getSharedGeminiGate, type RequestGate } from '@/lib/gemini-request-gate';

export interface ParsedSymbol {
  asset_type: string; symbol_name: string | null; tag_pattern: string | null;
  description: string | null; aliases: string[];
  bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
}

/**
 * Models that ignore responseMimeType: application/json return prose instead of
 * a schema-valid document. Membership is tuning, not code:
 * `model.jsonIncompatible` (Settings → .env → fallback). Kept as a helper so no
 * call site can accidentally read a stale module-level snapshot.
 */
export function isJsonModeIncompatible(
  jsonIncompatible: ReadonlySet<string>,
  modelName: string,
): boolean {
  return jsonIncompatible.has(modelName.toLowerCase());
}


async function getModelWithFallback() {
  const cfg = await getAiConfig();
  if (cfg.provider === 'deepseek') {
    throw new Error('DeepSeek cannot analyse images — switch provider to Gemini, OpenAI, or Anthropic in Settings');
  }
  let client = null;
  let candidates: string[] = [];
  if (cfg.provider === 'gemini') {
    client = await getGeminiClient();
    candidates = await resolveGeminiModels();
  }
  const tuning = await getTuning();
  return { client, candidates, cfg, tuning };
}

export function parseJsonResponse(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^\uFEFF/, '');
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch {}
  const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) { try { return JSON.parse(m[1]) as Record<string, unknown>; } catch {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e !== -1) {
    try {
      return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    } catch {
      // Fall through to salvage below (truncated array from maxOutputTokens).
    }
  }
  const salvaged = salvageSymbols(text);
  if (salvaged.length > 0) {
    console.warn(`[legend-extract] salvaged ${salvaged.length} symbols from truncated JSON`);
    return { symbols: salvaged };
  }
  throw new Error(`No JSON in response: ${text.slice(0, 500)}`);
}

/**
 * Salvage complete symbol objects from a truncated JSON array.
 * Dense legend pages routinely exceed maxOutputTokens mid-array; instead of
 * discarding the whole page, recover every balanced {...} object inside the
 * "symbols" array region. The incomplete tail object is skipped, never guessed.
 */
export function salvageSymbols(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const keyIdx = text.indexOf('"symbols"');
  const arrStart = text.indexOf('[', keyIdx === -1 ? 0 : keyIdx);
  if (arrStart === -1) return out;
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;
  for (let i = arrStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          const obj = JSON.parse(text.slice(objStart, i + 1)) as Record<string, unknown>;
          if (obj && typeof obj === 'object') out.push(obj);
        } catch { /* skip corrupt object, keep scanning */ }
        objStart = -1;
      } else if (depth < 0) {
        break; // array closed without completion — stop
      }
    } else if (ch === ']' && depth === 0) {
      break; // clean array end
    }
  }
  return out;
}

/** Parse RetryInfo retryDelay ("32s") from Google error text, if present. */
export function parseRetryDelayMs(msg: string, fallbackMs: number): number {
  const m = msg.match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i);
  if (m) {
    const ms = Math.round(parseFloat(m[1]) * 1000);
    if (Number.isFinite(ms) && ms > 0 && ms <= 300_000) return ms;
  }
  return fallbackMs;
}

export type Sleeper = (ms: number) => Promise<void>;
const defaultSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call fn with exponential-backoff retries on retryable Gemini errors
 * (429/quota/503/overloaded/fetch). Non-retryable errors throw immediately.
 *
 * `maxAttempts` includes the first try. When the provider sends a RetryInfo
 * hint (e.g. "retryDelay: 23s") that value wins over our own backoff, because
 * guessing shorter just burns another quota slot.
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; sleep?: Sleeper; label?: string } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? env.GEMINI_RETRY_MAX_ATTEMPTS;
  const base = opts.baseDelayMs ?? env.GEMINI_RETRY_BASE_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isRetryable = (e: unknown) => /429|quota|rate|overloaded|high demand|503|not\.found|404|fetch|ETIMEDOUT|ECONNRESET/i.test(e instanceof Error ? e.message : String(e));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === maxAttempts) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      const wait = parseRetryDelayMs(msg, base * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 1000));
      console.warn(`[ai-retry] ${opts.label ?? 'call'} attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(wait)}ms: ${msg.slice(0, 160)}`);
      await sleep(Math.min(wait, env.GEMINI_RETRY_MAX_DELAY_MS));
    }
  }
  throw lastErr;
}

export function extractBbox(sym: Record<string, unknown>): { x: number | null; y: number | null; w: number | null; h: number | null } {
  const rawBox = (sym.graphic_bbox ?? sym.symbol_bbox ?? sym.drawing_bbox ?? sym.bbox) as unknown;
  if (Array.isArray(rawBox) && rawBox.length >= 4) {
    const a = (rawBox as unknown[]).map(Number);
    const ymin = a[0], xmin = a[1], ymax = a[2], xmax = a[3];
    if (xmax < xmin || ymax < ymin) return { x: Math.round(a[0]), y: Math.round(a[1]), w: Math.max(1, Math.round(a[2])), h: Math.max(1, Math.round(a[3])) };
    return { x: Math.round(xmin), y: Math.round(ymin), w: Math.max(1, Math.round(xmax - xmin)), h: Math.max(1, Math.round(ymax - ymin)) };
  }
  const bx = (sym as any).bboxX ?? (sym as any).bbox_x ?? (sym as any).x;
  const by = (sym as any).bboxY ?? (sym as any).bbox_y ?? (sym as any).y;
  const bw = (sym as any).bboxW ?? (sym as any).bbox_w ?? (sym as any).width ?? (sym as any).w;
  const bh = (sym as any).bboxH ?? (sym as any).bbox_h ?? (sym as any).height ?? (sym as any).h;
  const x2 = (sym as any).xmax ?? (sym as any).x2;
  const y2 = (sym as any).ymax ?? (sym as any).y2;
  if (bx != null && by != null && x2 != null && y2 != null) return { x: Number(bx), y: Number(by), w: Math.max(1, Number(x2) - Number(bx)), h: Math.max(1, Number(y2) - Number(by)) };
  if (bx != null && by != null && bw != null && bh != null) return { x: Number(bx), y: Number(by), w: Math.max(1, Number(bw)), h: Math.max(1, Number(bh)) };
  return { x: null, y: null, w: null, h: null };
}

/** Clamp a parsed bbox into 0-1000 space. Returns null only if non-finite. */
export function sanitizeBbox(
  b: { x: number | null; y: number | null; w: number | null; h: number | null }
): { x: number; y: number; w: number; h: number } | null {
  if (b.x == null || b.y == null || b.w == null || b.h == null) return null;
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return null;
  const x = Math.min(999, Math.max(0, Math.round(b.x)));
  const y = Math.min(999, Math.max(0, Math.round(b.y)));
  const w = Math.min(1000 - x, Math.max(1, Math.round(b.w)));
  const h = Math.min(1000 - y, Math.max(1, Math.round(b.h)));
  return { x, y, w, h };
}

function normName(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function iou01(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Deduplicate symbols from overlapping chunk regions (or repeated rows).
 *
 * `iouThreshold` defaults to the env value; async callers that already resolved
 * tuning pass `tuning.performance.legendDedupeIou` so a Settings change applies
 * immediately. Pure and deterministic either way.
 */
export function dedupeSymbols(
  symbols: ParsedSymbol[],
  iouThreshold: number = env.LEGEND_DEDUPE_IOU,
): ParsedSymbol[] {
  const boxOf = (s: ParsedSymbol) =>
    s.bbox_x == null || s.bbox_y == null || s.bbox_w == null || s.bbox_h == null
      ? null
      : { x: s.bbox_x, y: s.bbox_y, w: s.bbox_w, h: s.bbox_h };
  const out: ParsedSymbol[] = [];
  for (const s of symbols) {
    const sb = boxOf(s);
    if (!sb) { out.push(s); continue; }
    const dup = out.some((o) => {
      const ob = boxOf(o);
      return (
        ob !== null &&
        normName(o.symbol_name) === normName(s.symbol_name) &&
        normName(s.symbol_name) !== '' &&
        iou01(ob, sb) > iouThreshold
      );
    });
    if (!dup) out.push(s);
  }
  return out;
}

/** Map a chunk-local 0-1000 bbox back to full-page 0-1000 coordinates. */
export function offsetChunkBbox(
  b: { x: number; y: number; w: number; h: number },
  chunk: { x: number; y: number; width: number; height: number }
): { x: number; y: number; w: number; h: number } {
  const x = Math.round(chunk.x + (b.x / 1000) * chunk.width);
  const y = Math.round(chunk.y + (b.y / 1000) * chunk.height);
  const w = Math.max(1, Math.round((b.w / 1000) * chunk.width));
  const h = Math.max(1, Math.round((b.h / 1000) * chunk.height));
  return sanitizeBbox({ x, y, w, h }) ?? { x, y, w, h };
}

const DENSE_PROMPT = `You are a P&ID legend digitizer. This image is one page of a P&ID legend sheet — a dense reference table showing symbol graphics, names, and sometimes tag patterns.
`

function makeRegionPrompt(regionLabel: string): string {
  return `You are a P&ID legend digitizer analyzing a CROPPED REGION of a legend sheet.
This crop shows region: "${regionLabel}"

YOUR MISSION: Find EVERY SINGLE physical equipment symbol in this crop. Missing even one is a failure.

IMPORTANT STRUCTURE OF THE LEGEND SHEET:
In this P&ID legend sheet, each equipment item consists of TWO separate visual parts:
1. The DRAWING / GRAPHIC / ICON: The physical drawing of the equipment (impeller, casing, nozzle, circle, lines, valve body).
2. The TEXT LABEL: The printed alphanumeric text (e.g. "CENTRIFUGAL PUMP").

For EACH distinct symbol:
- "name": The exact text label (e.g. "CENTRIFUGAL PUMP")
- "assetType": Equipment category from list: Pump|Valve|Vessel|Tank|Compressor|Heat Exchanger|Filter|Instrument|PSV|Control Valve|Motor|Fan|Column|Reactor|Separator|Agitator|Ejector|Strainer|Driver|Fitting|Nozzle|Flange|Reducer|Tee|Elbow|other
- "tagPattern": Tag pattern if shown (e.g. P-###), or null
- "aliases": List of short codes/abbreviations if shown (e.g. ["P"]), or []
- "label_bbox": [ymin, xmin, ymax, xmax] coordinates of the TEXT WORDS ONLY (0-1000 space)
- "graphic_bbox": [ymin, xmin, ymax, xmax] coordinates of the PHYSICAL DRAWING / ICON ONLY (0-1000 space). TIGHT around the drawing lines only. Look beside/left/above the label to locate the drawing.

Return JSON ONLY (no markdown, no explanation):
{
  "symbols": [
    {
      "name": "exact label text",
      "assetType": "type from list above",
      "tagPattern": "P-### or null",
      "description": "one short phrase or null",
      "aliases": ["abbrev1", "abbrev2"],
      "label_bbox": [ymin, xmin, ymax, xmax],
      "graphic_bbox": [ymin, xmin, ymax, xmax]
    }
  ]
}

RULES:
- Scan systematically top-to-bottom, left-to-right — do not skip any row or column
- Small/simple symbols (single line, circle, rectangle, triangle) MUST be included
- Each symbol graphic = one entry.
- Do NOT include: title headers, text-only rows, grid lines, page numbers, notes sections
- Aliases: short codes printed near the label, e.g. "XV" for "Solenoid Valve", "P" for "Pump"
- If truly no symbols visible: return {"symbols":[]}`;
}

/** Untrusted model field → nullable string column. */
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

// ─── Call Gemini for one region ───────────────────────────────────────────────

async function analyzeRegion(
  cropBase64: string,
  regionLabel: string,
  client: any,
  candidates: string[],
  page: number,
  regionIdx: number,
  generation: ReturnType<typeof generationConfigFrom>,
  jsonIncompatible: ReadonlySet<string>,
  guard: ModelChainGuard,
  cfg?: Awaited<ReturnType<typeof getAiConfig>>,
): Promise<Array<{ name: string; assetType: string; tagPattern: string | null; description: string | null; aliases: string[]; bbox?: number[]; graphic_bbox?: number[]; label_bbox?: number[] }>> {
  if (cfg && cfg.provider !== 'gemini') {
    const { getVisionProvider } = await import('@/lib/ai-providers');
    const provider = await getVisionProvider(cfg);
    const model = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;
    const prompt = makeRegionPrompt(regionLabel);

    const result = await provider.generateVisionCompletion({
      model,
      prompt,
      imageBase64: cropBase64,
      mimeType: 'image/png',
      temperature: generation.temperature ?? 0.1,
      maxTokens: generation.maxOutputTokens ?? 4096,
      responseFormat: 'json',
    });

    const j = parseJsonResponse(result.text) as { symbols?: unknown[] };
    const raw = Array.isArray(j.symbols) ? j.symbols : [];
    console.log(`[legend-extract] page ${page} region ${regionIdx} "${regionLabel}": ${raw.length} symbols via ${cfg.provider} (${model})`);
    return raw as any[];
  }

  const imgPart = { inlineData: { mimeType: 'image/png' as const, data: cropBase64 } };
  let lastErr: unknown;

  for (const modelName of candidates) {
    if (isJsonModeIncompatible(jsonIncompatible, modelName)) continue;
    // Same protections as detection: skip a model whose breaker is open, cap the
    // number of attempts, and hold the shared request budget before each call.
    if (guard.breaker.isOpen(modelName)) {
      console.warn(
        `[legend-extract] page ${page} region ${regionIdx} skipping ${modelName}: circuit open`,
      );
      continue;
    }
    if (!guard.shouldAttempt(page, regionIdx)) throw lastErr ?? new Error('All models failed for region');

    try {
      await guard.gate.wait();
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: generation,
      });
      const r = await model.generateContent(
        [{ text: makeRegionPrompt(regionLabel) }, imgPart],
        { timeout: env.GEMINI_REQUEST_TIMEOUT_MS },
      );
      guard.breaker.recordSuccess(modelName);
      const text = r.response.text();
      const j = parseJsonResponse(text) as { symbols?: unknown[] };
      const raw = Array.isArray(j.symbols) ? j.symbols : [];
      console.log(`[legend-extract] page ${page} region ${regionIdx} "${regionLabel}": ${raw.length} symbols via ${modelName}`);
      return raw as any[];
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isProviderUnavailable(msg);
      console.warn(`[legend-extract] page ${page} region ${regionIdx} model ${modelName}: ${msg.slice(0, 150)}`);
      lastErr = e;
      if (!retryable) throw e;
      if (retryable) guard.breaker.recordFailure(modelName);
      guard.attempts += 1;
      // A provider rejection (429 or 503/overloaded) means the quota or the
      // model is hot right now — pause before trying the next model so we do
      // not burn through the whole chain instantly. An explicit RetryInfo hint
      // from Google wins over our own delay.
      if (/429|rate.limit|quota|resource.?exhausted|503|overloaded|high.demand|unavailable/i.test(msg)) {
        await guard.gate.backoff(
          parseRetryDelayMs(msg, guard.attemptDelayMs * 2),
        );
      } else if (guard.attemptDelayMs > 0) {
        await new Promise((r) => setTimeout(r, guard.attemptDelayMs));
      }
      continue;
    }
  }
  throw lastErr ?? new Error('All models failed for region');
}

/**
 * Per-extraction state for walking the model chain.
 *
 * The breaker and the request gate are shared across the whole page (one quota,
 * one provider), but the attempt cap (`maxAttempts`) applies PER REGION: each
 * region may try up to N models before it is marked failed and the sweep moves
 * on. Sharing the counter across regions is wrong — with 16 regions and a cap
 * of 3, three 503s on early regions would abort every later region without a
 * single API call ("attempt cap reached"). Page-level protection against a full
 * provider outage is already handled by the shared circuit breaker.
 */
interface ModelChainGuard {
  breaker: ModelCircuitBreaker;
  gate: RequestGate;
  attemptDelayMs: number;
  maxAttempts: number;
  /** Attempts spent on the CURRENT region. Reset before each region. */
  attempts: number;
  /** False once the per-region attempt cap is reached. */
  shouldAttempt(page: number, regionIdx: number): boolean;
  /** Start a fresh per-region budget (call before each region). */
  resetRegion(): void;
}

/**
 * True when no candidate can currently be used — every model is either
 * JSON-incompatible or has an open breaker.
 *
 * Used to abort the page sweep instead of walking the remaining regions and
 * logging "circuit open" for each one, which is a long log of guaranteed
 * failures ending in an empty page.
 */
export function isChainUnavailable(
  candidates: string[],
  jsonIncompatible: ReadonlySet<string>,
  breaker: ModelCircuitBreaker,
): boolean {
  if (candidates.length === 0) return false;
  return candidates.every(
    (m) => isJsonModeIncompatible(jsonIncompatible, m) || breaker.isOpen(m),
  );
}

function makeModelChainGuard(tuning: Awaited<ReturnType<typeof getTuning>>): ModelChainGuard {
  const maxAttempts = tuning.model.maxModelAttempts;
  const guard: ModelChainGuard = {
    breaker: getSharedModelBreaker({
      failureThreshold: tuning.model.circuitFailures,
      cooldownMs: tuning.model.circuitCooldownMs,
    }),
    gate: getSharedGeminiGate(tuning.model.requestsPerMinute),
    attemptDelayMs: tuning.model.modelAttemptDelayMs,
    maxAttempts,
    attempts: 0,
    shouldAttempt(page, regionIdx) {
      if (maxAttempts <= 0 || guard.attempts < maxAttempts) return true;
      console.warn(
        `[legend-extract] page ${page} region ${regionIdx} per-region attempt cap reached (${maxAttempts} models tried), moving to next region`,
      );
      return false;
    },
    resetRegion() {
      guard.attempts = 0;
    },
  };
  return guard;
}

// ─── Split page into regions ──────────────────────────────────────────────────

interface Region {
  label: string;
  // 0-1 fractions of full image
  x: number; y: number; w: number; h: number;
}

/**
 * Split a legend page into overlapping regions.
 * For a typical P&ID legend with ~6-8 columns across and many rows,
 * we split into a grid of columns × row-bands.
 * Overlap of 5% prevents symbols on edges from being cut off.
 */
function buildRegions(cols: number, rows: number, overlap = 0.05): Region[] {
  const regions: Region[] = [];
  const colW = 1 / cols;
  const rowH = 1 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * colW - overlap);
      const y = Math.max(0, r * rowH - overlap);
      const x2 = Math.min(1, (c + 1) * colW + overlap);
      const y2 = Math.min(1, (r + 1) * rowH + overlap);
      regions.push({
        label: `column ${c + 1}/${cols}, row ${r + 1}/${rows}`,
        x, y, w: x2 - x, h: y2 - y,
      });
    }
  }
  return regions;
}

// ─── Deduplicate symbols (overlap regions can produce duplicates) ─────────────

/**
 * Deduplicate symbols produced by overlapping regions.
 *
 * Stricter of the two rules: same normalized name AND IoU above the threshold,
 * or a looser IoU when only the name matches. Tuned separately from
 * `dedupeSymbols` because this runs mid-sweep on region-local output, where
 * boxes are already page-space but noisier.
 *
 * Name normalization: lowercase + strip punctuation/spaces so
 * "Gate Valve", "gate-valve", "gate valve" all match.
 */
function deduplicateSymbols(
  symbols: ParsedSymbol[],
  iouThreshold: number = env.LEGEND_DEDUPE_NAME_IOU,
): ParsedSymbol[] {
  // Normalize: lowercase, strip non-alphanumeric, collapse spaces
  const fuzzyName = (s: string | null | undefined) =>
    String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

  const out: ParsedSymbol[] = [];
  for (const s of symbols) {
    const isDupe = out.some(existing => {
      if (!existing.bbox_x || !s.bbox_x) return false;
      const ax1 = existing.bbox_x, ay1 = existing.bbox_y!;
      const ax2 = ax1 + existing.bbox_w!, ay2 = ay1 + existing.bbox_h!;
      const bx1 = s.bbox_x, by1 = s.bbox_y!;
      const bx2 = bx1 + s.bbox_w!, by2 = by1 + s.bbox_h!;
      const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
      const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
      const intersection = ix * iy;
      const areaA = existing.bbox_w! * existing.bbox_h!;
      const areaB = s.bbox_w! * s.bbox_h!;
      const union = areaA + areaB - intersection;
      const iou = union > 0 ? intersection / union : 0;
      // Fuzzy name match: strip punctuation/case → "Gate Valve" == "gate-valve"
      const fa = fuzzyName(existing.symbol_name);
      const fb = fuzzyName(s.symbol_name);
      const nameMatch = fa !== '' && fa === fb;
      return iou > iouThreshold || nameMatch;
    });
    if (!isDupe) out.push(s);
  }
  return out;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Region-based legend symbol extraction.
 * 
 * Instead of sending the full page (where tiny symbols are hard to bbox precisely),
 * we split the page into a grid of regions, send each crop to Gemini separately
 * (giving Gemini a much larger view of each symbol), then convert region-relative
 * coordinates back to full-page coordinates.
 *
 * Result: much tighter, more accurate bboxes.
 */
export type LegendProgressCallback = (info: {
  stage: string;
  current: number;
  total: number;
  message: string;
  pct?: number;
}) => void;

export async function extractLegendSymbolsFromPng(
  pngBase64: string,
  page: number,
  pngBuffer?: Buffer,
  onProgress?: LegendProgressCallback,
): Promise<ParsedSymbol[]> {
  const { client, candidates, cfg, tuning } = await getModelWithFallback();
  if (cfg.provider === 'deepseek') throw new Error('DeepSeek cannot analyse images — switch provider to Gemini, OpenAI, or Anthropic in Settings');

  const jsonIncompatible = tuning.model.jsonIncompatible;
  const perf = tuning.performance;
  const regionGeneration = generationConfigFrom(tuning.generation, 'legend');

  // If no buffer provided, fall back to single-pass (legacy)
  if (!pngBuffer) {
    return extractSinglePass(pngBase64, page, client, candidates, tuning, cfg);
  }

  const sharp = (await import('sharp')).default;
  const meta = await sharp(pngBuffer).metadata();
  const imgW = meta.width ?? 1000;
  const imgH = meta.height ?? 1000;

  // Grid derived from aspect ratio. Standard P&ID legend sheets are landscape
  // with many columns, so they get more columns than rows: more, smaller regions
  // mean fewer symbols per crop and a lower chance of missing one.
  const aspectRatio = imgW / imgH;
  const cols = aspectRatio > 1.5
    ? perf.legendRegionColsLandscape
    : aspectRatio > 1
      ? perf.legendRegionColsSquarish
      : perf.legendRegionColsPortrait;
  const rows = perf.legendRegionRows;
  const regions = buildRegions(cols, rows, perf.legendRegionOverlap);

  // One guard for the whole page: the breaker and the request gate are shared
  // across every region and the catch-up pass (one provider, one quota), while
  // the attempt cap is reset per region (see resetRegion below).
  const guard = makeModelChainGuard(tuning);

  console.log(
    `[legend-extract] page ${page}: ${imgW}x${imgH}, splitting into ${cols}x${rows}=${regions.length} regions (${Math.round(perf.legendRegionOverlap * 100)}% overlap)`,
  );

  const allSymbols: ParsedSymbol[] = [];

  // Process regions sequentially to avoid rate limiting
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    onProgress?.({
      stage: 'regions',
      current: i + 1,
      total: regions.length,
      message: `Menganalisis region ${i + 1} dari ${regions.length}...`,
      pct: Math.round(20 + ((i + 1) / regions.length) * 55),
    });

    // Whole provider outage: every model has tripped its breaker. Stop the page
    // here instead of walking the remaining regions into guaranteed failures.
    if (cfg.provider === 'gemini' && isChainUnavailable(candidates, jsonIncompatible, guard.breaker)) {
      console.error(
        `[legend-extract] page ${page} aborted after ${allSymbols.length} symbol(s) from ${i}/${regions.length} regions: no usable model left (open circuits: ${guard.breaker.openModels().join(', ') || 'none'})`,
      );
      break;
    }

    // Crop region from full image
    const cropX = Math.round(region.x * imgW);
    const cropY = Math.round(region.y * imgH);
    const cropW = Math.max(10, Math.round(region.w * imgW));
    const cropH = Math.max(10, Math.round(region.h * imgH));

    // Upscale crop so small symbols stay legible after Gemini downscaling.
    const targetW = Math.min(perf.legendCropMaxWidth, Math.max(perf.legendCropMinWidth, cropW));

    let cropBase64: string;
    try {
      const cropBuf = await sharp(pngBuffer)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .resize(targetW, null, { kernel: 'lanczos3' })
        .sharpen({ sigma: 0.5 })
        .png()
        .toBuffer();
      cropBase64 = cropBuf.toString('base64');
    } catch (e) {
      console.warn(`[legend-extract] page ${page} region ${i} crop failed:`, e);
      continue;
    }

    // Fresh attempt budget per region: a 503 storm on region N must not
    // starve regions N+1..end (each region tries up to maxAttempts models).
    guard.resetRegion();
    // Analyze region
    let rawSymbols: any[] = [];
    try {
      rawSymbols = await analyzeRegion(
        cropBase64,
        region.label,
        client,
        candidates,
        page,
        i,
        regionGeneration,
        jsonIncompatible,
        guard,
        cfg,
      );
    } catch (e) {
      console.warn(`[legend-extract] page ${page} region ${i} analyze failed:`, e);
      // Brief pause so a failing region does not immediately hit the rate limit.
      await new Promise(r => setTimeout(r, perf.legendErrorDelayMs));
      continue;
    }

    // Convert region-relative 0-1000 coords to full-page 0-1000 coords
    for (const s of rawSymbols) {
      const { x: rx, y: ry, w: rw, h: rh } = extractBbox(s);
      if (rx === null || ry === null || rw === null || rh === null) {
        // No bbox — still save symbol without bbox
        allSymbols.push({
          asset_type: String(s.assetType ?? s.asset_type ?? 'Unknown').slice(0, 120),
          symbol_name: (s.name ?? s.symbolName ?? null) as string | null,
          tag_pattern: (s.tagPattern ?? s.tag_pattern ?? null) as string | null,
          description: (s.description ?? null) as string | null,
          aliases: Array.isArray(s.aliases) ? s.aliases : [],
          bbox_x: null, bbox_y: null, bbox_w: null, bbox_h: null,
        });
        continue;
      }

      // rx/ry/rw/rh are 0-1000 within the crop
      // Convert to full-image coordinates:
      // 1. Normalize to 0-1 within crop
      // 2. Map to pixel coords within crop
      // 3. Add crop offset to get full-image pixel coords
      // 4. Normalize to 0-1000 of full image

      const normX = (rx / 1000) * cropW + cropX;
      const normY = (ry / 1000) * cropH + cropY;
      const normX2 = ((rx + rw) / 1000) * cropW + cropX;
      const normY2 = ((ry + rh) / 1000) * cropH + cropY;

      const fullX = Math.round((normX / imgW) * 1000);
      const fullY = Math.round((normY / imgH) * 1000);
      const fullW = Math.max(1, Math.round(((normX2 - normX) / imgW) * 1000));
      const fullH = Math.max(1, Math.round(((normY2 - normY) / imgH) * 1000));

      allSymbols.push({
        asset_type: String(s.assetType ?? s.asset_type ?? 'Unknown').slice(0, 120),
        symbol_name: (s.name ?? s.symbolName ?? null) as string | null,
        tag_pattern: (s.tagPattern ?? s.tag_pattern ?? null) as string | null,
        description: (s.description ?? null) as string | null,
        aliases: Array.isArray(s.aliases) ? s.aliases : [],
        bbox_x: fullX, bbox_y: fullY, bbox_w: fullW, bbox_h: fullH,
      });
    }

    // Small delay between regions to stay under the per-minute request limit
    if (i < regions.length - 1 && perf.legendRegionDelayMs > 0) {
      await new Promise(r => setTimeout(r, perf.legendRegionDelayMs));
    }
  }

  // Remove duplicates from overlapping region borders
  const deduplicated = deduplicateSymbols(allSymbols, perf.legendDedupeNameIou);
  console.log(`[legend-extract] page ${page}: ${allSymbols.length} raw → ${deduplicated.length} after dedup`);

  // ── Catch-up pass: full page scan to find anything missed ───────────────────
  // Send full page with list of already-detected names so model only returns NEW ones
  onProgress?.({
    stage: 'catchup',
    current: 1,
    total: 1,
    message: 'Memindai simbol kecil / terlewat (catch-up pass)...',
    pct: 80,
  });
  try {
    if (cfg.provider === 'gemini' && isChainUnavailable(candidates, jsonIncompatible, guard.breaker)) {
      throw new Error('skipping catch-up: no usable model left (all circuits open)');
    }

    const detectedNames = deduplicated
      .filter(s => s.symbol_name)
      .map(s => s.symbol_name!)
      .slice(0, 120); // cap raised from 60 — dense legends have 80-100+ symbols

    const catchupPrompt = `You are a P&ID legend digitizer. This is a FULL legend page.

Already detected symbols (do NOT repeat these):
${detectedNames.map(n => `- ${n}`).join('\n')}

YOUR TASK: Find ONLY symbols NOT in the above list that exist in this image.
Focus on: small symbols, symbols near page borders, symbols in dense/crowded areas, symbols whose label is partially obscured.

Asset types: Pump|Valve|Vessel|Tank|Compressor|Heat Exchanger|Filter|Instrument|PSV|Control Valve|Motor|Fan|Column|Reactor|Separator|Agitator|Ejector|Strainer|Driver|Fitting|Nozzle|other

IMPORTANT: Each item consists of TWO separate parts:
1. The TEXT LABEL (the words)
2. The DRAWING / ICON (the physical equipment line art)

Return JSON ONLY:
{
  "symbols": [
    {
      "name": "exact label",
      "assetType": "type from list",
      "tagPattern": "P-### or null",
      "description": "short or null",
      "aliases": ["abbrev"],
      "label_bbox": [ymin, xmin, ymax, xmax],
      "graphic_bbox": [ymin, xmin, ymax, xmax]
    }
  ]
}

- label_bbox: coordinates of the text words only (0-1000 coords relative to full image)
- graphic_bbox: coordinates TIGHT around the physical equipment icon/drawing only (0-1000 coords)
- If all symbols already detected: return {"symbols":[]}`;

    let missed: Array<Record<string, unknown>> = [];
    let catchupModel: string | null = null;
    let catchupErr: unknown;
    if (cfg.provider !== 'gemini') {
      const { getVisionProvider } = await import('@/lib/ai-providers');
      const provider = await getVisionProvider(cfg);
      const model = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;

      const res = await provider.generateVisionCompletion({
        model,
        prompt: catchupPrompt,
        imageBase64: pngBase64,
        mimeType: 'image/png',
        temperature: 0.1,
        maxTokens: 4096,
        responseFormat: 'json',
      });
      catchupModel = model;
      const j = parseJsonResponse(res.text) as { symbols?: unknown[] };
      missed = Array.isArray(j.symbols) ? j.symbols as any[] : [];
    } else {
      for (const m of candidates) {
        if (isJsonModeIncompatible(jsonIncompatible, m)) continue;
        if (guard.breaker.isOpen(m)) {
          console.warn(`[legend-extract] page ${page} catchup skipping ${m}: circuit open`);
          continue;
        }
        try {
          await guard.gate.wait();
          const model = (client as any).getGenerativeModel({
            model: m,
            generationConfig: generationConfigFrom(tuning.generation, 'legendCatchup'),
          });
          const res = await model.generateContent([
            { text: catchupPrompt },
            { inlineData: { mimeType: 'image/png', data: pngBase64 } },
          ], { timeout: env.GEMINI_REQUEST_TIMEOUT_MS });
          guard.breaker.recordSuccess(m);
          const j = parseJsonResponse(res.response.text()) as { symbols?: unknown[] };
          missed = Array.isArray(j.symbols) ? j.symbols as any[] : [];
          catchupModel = m;
          break;
        } catch (e: unknown) {
          catchupErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[legend-extract] page ${page} catchup model ${m}: ${msg.slice(0, 150)}`);
          if (!isProviderUnavailable(msg)) break;
          guard.breaker.recordFailure(m);
          if (/429|rate.limit|quota|resource.?exhausted|503|overloaded|high.demand|unavailable/i.test(msg)) {
            await guard.gate.backoff(parseRetryDelayMs(msg, guard.attemptDelayMs * 2));
          } else if (guard.attemptDelayMs > 0) {
            await new Promise((r) => setTimeout(r, guard.attemptDelayMs));
          }
        }
      }
    }

    if (catchupModel === null && catchupErr) {
      console.warn(
        `[legend-extract] page ${page} catchup pass failed on all models:`,
        catchupErr instanceof Error ? catchupErr.message.slice(0, 150) : catchupErr,
      );
    }

    if (missed.length > 0) {
      console.log(
        `[legend-extract] page ${page} catchup via ${catchupModel}: found ${missed.length} additional symbols`,
      );
      for (const s of missed) {
        const { x, y, w, h } = extractBbox(s);
        // Model output is untrusted: every field is coerced to its declared type
        // rather than assigned as-is, so a non-string name or pattern cannot
        // reach the DB column.
        deduplicated.push({
          asset_type: String(s.assetType ?? 'Unknown').slice(0, 120),
          symbol_name: strOrNull(s.name),
          tag_pattern: strOrNull(s.tagPattern),
          description: strOrNull(s.description),
          aliases: Array.isArray(s.aliases) ? s.aliases.map(a => String(a)) : [],
          bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h,
        });
      }
    } else if (catchupModel !== null) {
      console.log(`[legend-extract] page ${page} catchup via ${catchupModel}: no missed symbols`);
    }
  } catch (e) {
    console.warn(`[legend-extract] page ${page} catchup pass failed:`, e instanceof Error ? e.message.slice(0, 150) : e);
  }

  const final = deduplicateSymbols(deduplicated, perf.legendDedupeNameIou);
  console.log(`[legend-extract] page ${page}: final ${final.length} symbols`);
  return final;
}

// ─── Single-pass fallback (no buffer) ────────────────────────────────────────

async function extractSinglePass(
  pngBase64: string,
  page: number,
  client: any,
  candidates: string[],
  tuning: Awaited<ReturnType<typeof getTuning>>,
  cfg?: Awaited<ReturnType<typeof getAiConfig>>,
): Promise<ParsedSymbol[]> {
  const PROMPT = `You are a P&ID legend digitizer. Extract ALL symbols from this legend page.
Each item consists of TWO separate elements:
1. The TEXT LABEL (the printed alphanumeric text words)
2. The DRAWING / ICON (the physical equipment drawing/line art)

Return JSON ONLY:
{
  "symbols": [
    {
      "name": "label",
      "assetType": "type",
      "tagPattern": "P-### or null",
      "description": "string or null",
      "aliases": [],
      "label_bbox": [ymin, xmin, ymax, xmax],
      "graphic_bbox": [ymin, xmin, ymax, xmax]
    }
  ]
}
- label_bbox: 0-1000 coords around the text words
- graphic_bbox: 0-1000 coords tight around the physical symbol drawing/icon only`;

  if (cfg && cfg.provider !== 'gemini') {
    const { getVisionProvider } = await import('@/lib/ai-providers');
    const provider = await getVisionProvider(cfg);
    const model = cfg.provider === 'openai' ? cfg.openaiModel : cfg.anthropicModel;

    const res = await provider.generateVisionCompletion({
      model,
      prompt: PROMPT,
      imageBase64: pngBase64,
      mimeType: 'image/png',
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: 'json',
    });

    const j = parseJsonResponse(res.text) as { symbols?: unknown[] };
    const raw = Array.isArray(j.symbols) ? j.symbols : [];
    return raw.map((s: any) => {
      const { x, y, w, h } = extractBbox(s);
      return {
        asset_type: String(s.assetType ?? 'Unknown').slice(0, 120),
        symbol_name: strOrNull(s.name),
        tag_pattern: strOrNull(s.tagPattern),
        description: strOrNull(s.description),
        aliases: Array.isArray(s.aliases) ? s.aliases.map((a: any) => String(a)) : [],
        bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h,
      };
    });
  }

  const imgPart = { inlineData: { mimeType: 'image/png' as const, data: pngBase64 } };
  const generation = generationConfigFrom(tuning.generation, 'legend');
  const jsonIncompatible = tuning.model.jsonIncompatible;
  const guard = makeModelChainGuard(tuning);
  let lastErr: unknown;
  for (const modelName of candidates) {
    if (isJsonModeIncompatible(jsonIncompatible, modelName)) continue;
    if (guard.breaker.isOpen(modelName)) {
      console.warn(`[legend-extract] page ${page} skipping ${modelName}: circuit open`);
      continue;
    }
    if (!guard.shouldAttempt(page, 0)) throw lastErr ?? new Error('All models failed');
    try {
      await guard.gate.wait();
      const model = client.getGenerativeModel({ model: modelName, generationConfig: generation });
      const r = await model.generateContent(
        [{ text: PROMPT }, imgPart],
        { timeout: env.GEMINI_REQUEST_TIMEOUT_MS },
      );
      guard.breaker.recordSuccess(modelName);
      const j = parseJsonResponse(r.response.text()) as { symbols?: unknown[] };
      const raw = Array.isArray(j.symbols) ? j.symbols : [];
      if (raw.length === 0) { lastErr = new Error('0 symbols'); continue; }
      return raw.map((s: any) => {
        const { x, y, w, h } = extractBbox(s);
        return { asset_type: String(s.assetType ?? 'Unknown').slice(0, 120), symbol_name: s.name ?? null, tag_pattern: s.tagPattern ?? null, description: s.description ?? null, aliases: Array.isArray(s.aliases) ? s.aliases : [], bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h };
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isProviderUnavailable(msg);
      console.warn(`[legend-extract] page ${page} ${modelName}: ${msg.slice(0, 150)}`);
      lastErr = e;
      if (!retryable) throw e;
      guard.breaker.recordFailure(modelName);
      guard.attempts += 1;
      if (/429|rate.limit|quota|resource.?exhausted/i.test(msg)) {
        await guard.gate.backoff(guard.attemptDelayMs * 2);
      } else if (guard.attemptDelayMs > 0) {
        await new Promise((r) => setTimeout(r, guard.attemptDelayMs));
      }
      continue;
    }
  }
  lastErr = lastErr;
  if (lastErr) throw lastErr;
  return [];
}

/** Two overlapping vertical halves (legend sheets are columnar). 0-1000 space. */
export const CHUNK_BOXES = [
  { x: 0, y: 0, width: 550, height: 1000 },
  { x: 450, y: 0, width: 550, height: 1000 },
];

/**
 * Robust extraction: full page first (cheapest), chunked fallback when the
 * page fails, returns 0 symbols, or truncates. Chunk bboxes are mapped back
 * to page coordinates and overlap duplicates are merged. The crop function
 * is injected so this stays testable without mupdf.
 */
export async function extractLegendSymbolsRobust(
  pngBase64: string,
  page: number,
  cropChunk: (pngB64: string, box: { x: number; y: number; width: number; height: number }) => Promise<string | null>,
  extractFn: (pngB64: string, page: number) => Promise<ParsedSymbol[]> = extractLegendSymbolsFromPng
): Promise<{ symbols: ParsedSymbol[]; strategy: 'full' | 'chunked' }> {
  let fullErr: unknown = null;
  try {
    const full = await extractFn(pngBase64, page);
    if (full.length > 0) return { symbols: full, strategy: 'full' };
    fullErr = new Error('full-page returned 0 symbols');
  } catch (e) {
    fullErr = e;
  }
  console.warn(`[legend-extract] page ${page} full-page failed (${fullErr instanceof Error ? fullErr.message.slice(0, 120) : fullErr}), trying 2-column chunks`);
  const merged: ParsedSymbol[] = [];
  let chunkErr: unknown = fullErr;
  for (let i = 0; i < CHUNK_BOXES.length; i++) {
    const box = CHUNK_BOXES[i];
    try {
      const chunkB64 = await cropChunk(pngBase64, box);
      if (!chunkB64) { continue; }
      const syms = await extractFn(chunkB64, page);
      for (const s of syms) {
        if (s.bbox_x == null) { merged.push(s); continue; }
        const mapped = offsetChunkBbox(
          { x: s.bbox_x, y: s.bbox_y!, w: s.bbox_w!, h: s.bbox_h! }, box
        );
        merged.push({ ...s, bbox_x: mapped.x, bbox_y: mapped.y, bbox_w: mapped.w, bbox_h: mapped.h });
      }
    } catch (e) {
      chunkErr = e;
      console.warn(`[legend-extract] page ${page} chunk ${i} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }
  }
  const deduped = dedupeSymbols(merged, (await getTuning()).performance.legendDedupeIou);
  if (deduped.length === 0) throw chunkErr ?? fullErr ?? new Error('All chunks failed');
  console.log(`[legend-extract] page ${page} chunked fallback: ${merged.length} → ${deduped.length} after dedupe`);
  return { symbols: deduped, strategy: 'chunked' };
}
