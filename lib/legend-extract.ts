import { getAiConfig } from '@/lib/ai-config';
import { getGeminiClient } from '@/lib/gemini';

export interface ParsedSymbol {
  asset_type: string; symbol_name: string | null; tag_pattern: string | null;
  description: string | null; aliases: string[];
  bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
}

const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash'];

async function getModelWithFallback() {
  const cfg = await getAiConfig();
  const client = await getGeminiClient();
  const candidates = [cfg.geminiModel, ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i);
  return { client, candidates, cfg };
}

export function parseJsonResponse(text: string): Record<string, unknown> {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
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
 * maxAttempts includes the first try (default 3 → delays ≈2s, 5s).
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; sleep?: Sleeper; label?: string } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 2000;
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
      console.warn(`[legend-extract] ${opts.label ?? 'call'} attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(wait)}ms: ${msg.slice(0, 160)}`);
      await sleep(Math.min(wait, 60_000));
    }
  }
  throw lastErr;
}

export function extractBbox(sym: Record<string, unknown>): { x: number | null; y: number | null; w: number | null; h: number | null } {
  const arr = sym.bbox as unknown;
  if (Array.isArray(arr) && arr.length >= 4) {
    const a = (arr as unknown[]).map(Number);
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
 * Deduplicate symbols from overlapping chunk regions (or repeated rows):
 * same normalized name + bbox IoU > 0.5 → keep first. Pure, deterministic.
 */
export function dedupeSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
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
        iou01(ob, sb) > 0.5
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

GOAL: Extract EVERY symbol cell shown in the image. This page contains many small symbol cells organized in columns (e.g. PUMPS, EQUIPMENT NUMBERING, INTERNAL, HEAT EXCHANGER, TANK, etc.). Do not skip any column or row.

For each distinct symbol graphic you see (each small icon/drawing in a cell):
- Read the label/name printed next to/below it (e.g. "CENTRIFUGAL PUMP", "GATE VALVE", "VESSEL", "SHELL & TUBE HX").
- If a tag pattern like "P-###" or "V-###" is printed near the symbol, capture it, else null.
- Provide a short description if visible, else null.
- Bounding box of ONLY the symbol graphic (not the text), normalized 0-1000: [ymin, xmin, ymax, xmax] where (0,0)=top-left, (1000,1000)=bottom-right.

Return JSON ONLY:
{"symbols":[{"name":"exact label text","assetType":"canonical: Pump|Valve|Vessel|Tank|Compressor|Heat Exchanger|Filter|Instrument|PSV|Control Valve|Motor|Fan|Column|Reactor|Separator|Agitator|Ejector|Strainer|Flange|Elbow|Tee|Reducer|other","tagPattern":"P-### or null","description":"string or null","aliases":["alt spellings"],"bbox":[ymin,xmin,ymax,xmax]}]}

Rules:
- Scan columns left-to-right, top-to-bottom. Return symbols in reading order.
- A typical dense legend page has 40-120 symbols — expect many. Do NOT return only a handful.
- assetType must be a short canonical type (one of the list). Use "other" only if truly none fits.
- bbox must tightly wrap the icon only. Coordinates 0-1000 integers.
- Do NOT invent symbols. Do NOT include title blocks, revision tables, or the "ISSUED FOR DESIGN" stamp.
- Return valid JSON, no markdown, no explanation.`;

export async function extractLegendSymbolsFromPng(pngBase64: string, page: number): Promise<ParsedSymbol[]> {
  const { client, candidates, cfg } = await getModelWithFallback();
  if (cfg.provider === 'deepseek') throw new Error('DeepSeek cannot analyse images — switch provider to Gemini in Settings');
  const imgPart = { inlineData: { mimeType: 'image/png', data: pngBase64 } };
  let lastErr: unknown;
  for (const modelName of candidates) {
    try {
      const model = client.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' } });
      const text = await callWithRetry(
        async () => {
          const r = await model.generateContent([{ text: DENSE_PROMPT }, imgPart]);
          return r.response.text();
        },
        { maxAttempts: 3, label: `legend page ${page} ${modelName}` }
      );
      const j = parseJsonResponse(text) as { symbols?: unknown[]; data?: unknown[] };
      const raw: unknown[] = Array.isArray(j.symbols) ? j.symbols : Array.isArray(j.data) ? j.data : Array.isArray(j as unknown as unknown[]) ? j as unknown as unknown[] : [];
      if (raw.length === 0) {
        lastErr = new Error(`Model ${modelName} returned 0 symbols`);
        console.warn(`[legend-extract] page ${page} 0 symbols from ${modelName}, trying next`);
        continue;
      }
      return raw.map((s): ParsedSymbol => {
        const sym = s as Record<string, unknown>;
        const rawBox = extractBbox(sym);
        const box = sanitizeBbox(rawBox);
        return {
          asset_type: String((sym.assetType ?? (sym as any).asset_type ?? 'Unknown')).slice(0, 120),
          symbol_name: (sym.name as string ?? (sym as any).symbolName as string ?? (sym as any).symbol_name as string ?? null) as string | null,
          tag_pattern: (sym.tagPattern as string ?? (sym as any).tag_pattern as string ?? null) as string | null,
          description: (sym.description as string ?? null) as string | null,
          aliases: Array.isArray(sym.aliases) ? sym.aliases as string[] : Array.isArray((sym as any).alias) ? (sym as any).alias as string[] : [],
          bbox_x: box?.x ?? null, bbox_y: box?.y ?? null, bbox_w: box?.w ?? null, bbox_h: box?.h ?? null,
        };
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // callWithRetry already exhausted transient errors; other models still get a chance.
      // Non-retryable errors (bad key, deepseek, schema) abort immediately.
      const retryable = /429|quota|rate|overloaded|high demand|503|not\.found|404|fetch|ETIMEDOUT|ECONNRESET/i.test(msg);
      console.warn(`[legend-extract] page ${page} model ${modelName} failed: ${msg.slice(0, 300)}`);
      lastErr = e;
      if (retryable) continue;
      throw e;
    }
  }
  throw lastErr ?? new Error('All models failed');
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
  const deduped = dedupeSymbols(merged);
  if (deduped.length === 0) throw chunkErr ?? fullErr ?? new Error('All chunks failed');
  console.log(`[legend-extract] page ${page} chunked fallback: ${merged.length} → ${deduped.length} after dedupe`);
  return { symbols: deduped, strategy: 'chunked' };
}
