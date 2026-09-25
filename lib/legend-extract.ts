import { getAiConfig } from '@/lib/ai-config';
import { getGeminiClient } from '@/lib/gemini';
import { resolveGeminiModels } from '@/lib/model-resolver';

export interface ParsedSymbol {
  asset_type: string; symbol_name: string | null; tag_pattern: string | null;
  description: string | null; aliases: string[];
  bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
}

// Models known to NOT respect responseMimeType: application/json
const JSON_MODE_INCOMPATIBLE = new Set(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);

async function getModelWithFallback() {
  const cfg = await getAiConfig();
  const client = await getGeminiClient();
  const candidates = await resolveGeminiModels();
  return { client, candidates, cfg };
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
`

function makeRegionPrompt(regionLabel: string): string {
  return `You are a P&ID legend digitizer analyzing a CROPPED REGION of a legend sheet.
This crop shows region: "${regionLabel}"

YOUR MISSION: Find EVERY SINGLE symbol graphic in this crop. Missing even one is a failure.

For EACH distinct symbol graphic/icon/drawing visible:
1. Read the exact label/name printed next to or below it
2. Identify asset type  
3. Provide TIGHT bounding box around ONLY the icon/drawing graphic
   - Coordinates 0-1000 where (0,0)=top-left of THIS CROP, (1000,1000)=bottom-right
   - Format: [ymin, xmin, ymax, xmax]
   - TIGHT = box edges touch the outermost pixels of the symbol graphic only
   - Do NOT include text labels, whitespace padding in the box

Return JSON ONLY (no markdown, no explanation):
{"symbols":[{"name":"exact label text","assetType":"Pump|Valve|Vessel|Tank|Compressor|Heat Exchanger|Filter|Instrument|PSV|Control Valve|Motor|Fan|Column|Reactor|Separator|Agitator|Ejector|Strainer|Driver|other","tagPattern":"P-### or null","description":"short or null","aliases":[],"bbox":[ymin,xmin,ymax,xmax]}]}

IMPORTANT:
- Scan systematically top-to-bottom, left-to-right — do not skip any row
- Include ALL symbols including partial ones at crop edges
- Small/simple symbols (single line, circle, rectangle) must be included too
- Do NOT include: title headers, text-only rows, grid lines, notes
- If truly no symbols: return {"symbols":[]}`;
}

// ─── Call Gemini for one region ───────────────────────────────────────────────

async function analyzeRegion(
  cropBase64: string,
  regionLabel: string,
  client: any,
  candidates: string[],
  page: number,
  regionIdx: number,
): Promise<Array<{ name: string; assetType: string; tagPattern: string | null; description: string | null; aliases: string[]; bbox: number[] }>> {
  const imgPart = { inlineData: { mimeType: 'image/png' as const, data: cropBase64 } };
  let lastErr: unknown;

  for (const modelName of candidates) {
    if (JSON_MODE_INCOMPATIBLE.has(modelName)) continue;
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.05, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      });
      });
      const r = await model.generateContent([{ text: makeRegionPrompt(regionLabel) }, imgPart]);
      const text = r.response.text();
      const j = parseJsonResponse(text) as { symbols?: unknown[] };
      const raw = Array.isArray(j.symbols) ? j.symbols : [];
      console.log(`[legend-extract] page ${page} region ${regionIdx} "${regionLabel}": ${raw.length} symbols via ${modelName}`);
      return raw as any[];
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|quota|rate|overloaded|high demand|503|not.found|404|fetch/i.test(msg);
      console.warn(`[legend-extract] page ${page} region ${regionIdx} model ${modelName}: ${msg.slice(0, 150)}`);
      lastErr = e;
      if (retryable) continue;
      throw e;
    }
  }
  throw lastErr ?? new Error('All models failed for region');
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

function deduplicateSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  for (const s of symbols) {
    const isDupe = out.some(existing => {
      if (!existing.bbox_x || !s.bbox_x) return false;
      // IoU overlap check
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
      // Also check name similarity
      const nameSim = existing.symbol_name?.toLowerCase() === s.symbol_name?.toLowerCase();
      return iou > 0.3 || nameSim;
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
export async function extractLegendSymbolsFromPng(
  pngBase64: string,
  page: number,
  pngBuffer?: Buffer,
): Promise<ParsedSymbol[]> {
  const { client, candidates, cfg } = await getModelWithFallback();
  if (cfg.provider === 'deepseek') throw new Error('DeepSeek cannot analyse images — switch provider to Gemini in Settings');

  // If no buffer provided, fall back to single-pass (legacy)
  if (!pngBuffer) {
    return extractSinglePass(pngBase64, page, client, candidates);
  }

  const sharp = (await import('sharp')).default;
  const meta = await sharp(pngBuffer).metadata();
  const imgW = meta.width ?? 1000;
  const imgH = meta.height ?? 1000;

  // Determine grid based on aspect ratio
  // Standard P&ID legend: landscape, many columns → 6 cols × 4 rows
  // More rows = smaller region = Gemini sees fewer symbols per crop = less likely to miss
  const aspectRatio = imgW / imgH;
  const cols = aspectRatio > 1.5 ? 6 : aspectRatio > 1 ? 4 : 3;
  const rows = 4; // increased from 3 → catches more symbols per region
  const regions = buildRegions(cols, rows, 0.15); // 15% overlap (was 5%)

  console.log(`[legend-extract] page ${page}: ${imgW}x${imgH}, splitting into ${cols}x${rows}=${regions.length} regions (15% overlap)`);

  const allSymbols: ParsedSymbol[] = [];

  // Process regions sequentially to avoid rate limiting
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];

    // Crop region from full image
    const cropX = Math.round(region.x * imgW);
    const cropY = Math.round(region.y * imgH);
    const cropW = Math.max(10, Math.round(region.w * imgW));
    const cropH = Math.max(10, Math.round(region.h * imgH));

    // Upscale crop to at least 800px wide for better Gemini accuracy on small symbols
    const targetW = Math.max(800, cropW);

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

    // Analyze region
    let rawSymbols: any[] = [];
    try {
      rawSymbols = await analyzeRegion(cropBase64, region.label, client, candidates, page, i);
    } catch (e) {
      console.warn(`[legend-extract] page ${page} region ${i} analyze failed:`, e);
      // Add small delay before next region on error
      await new Promise(r => setTimeout(r, 1000));
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

    // Small delay between regions to avoid rate limiting
    if (i < regions.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Remove duplicates from overlapping region borders
  const deduplicated = deduplicateSymbols(allSymbols);
  console.log(`[legend-extract] page ${page}: ${allSymbols.length} raw → ${deduplicated.length} after dedup`);

  // ── Catch-up pass: full page scan to find anything missed ───────────────────
  // Send full page with list of already-detected names so Gemini only returns NEW ones
  try {
    const detectedNames = deduplicated
      .filter(s => s.symbol_name)
      .map(s => s.symbol_name!)
      .slice(0, 60); // cap to avoid prompt overflow

    const catchupPrompt = `You are a P&ID legend digitizer. This is a FULL legend page.

Already detected symbols (do NOT repeat these):
${detectedNames.map(n => `- ${n}`).join('\n')}

YOUR TASK: Find ONLY symbols NOT in the list above that exist in this image.
Look especially for: small symbols, symbols near borders, symbols in dense areas that might have been missed.

Return JSON ONLY:
{"symbols":[{"name":"exact label","assetType":"type","tagPattern":"P-### or null","description":"null","aliases":[],"bbox":[ymin,xmin,ymax,xmax]}]}

If all symbols already detected, return: {"symbols":[]}
bbox: 0-1000 coords relative to full image, tight around icon only.`;

    const catchModel = candidates.find(m => !JSON_MODE_INCOMPATIBLE.has(m)) ?? candidates[0];
    const model = (client as any).getGenerativeModel({
      model: catchModel,
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' },
    });
    const res = await model.generateContent([
      { text: catchupPrompt },
      { inlineData: { mimeType: 'image/png', data: pngBase64 } },
    ]);
    const j = parseJsonResponse(res.response.text()) as { symbols?: unknown[] };
    const missed = Array.isArray(j.symbols) ? j.symbols as any[] : [];

    if (missed.length > 0) {
      console.log(`[legend-extract] page ${page} catchup: found ${missed.length} additional symbols`);
      for (const s of missed) {
        const { x, y, w, h } = extractBbox(s);
        deduplicated.push({
          asset_type: String(s.assetType ?? 'Unknown').slice(0, 120),
          symbol_name: s.name ?? null,
          tag_pattern: s.tagPattern ?? null,
          description: s.description ?? null,
          aliases: Array.isArray(s.aliases) ? s.aliases : [],
          bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h,
        });
      }
    } else {
      console.log(`[legend-extract] page ${page} catchup: no missed symbols`);
    }
  } catch (e) {
    console.warn(`[legend-extract] page ${page} catchup pass failed:`, e instanceof Error ? e.message.slice(0, 150) : e);
  }

  const final = deduplicateSymbols(deduplicated);
  console.log(`[legend-extract] page ${page}: final ${final.length} symbols`);
  return final;
}

// ─── Single-pass fallback (no buffer) ────────────────────────────────────────

async function extractSinglePass(pngBase64: string, page: number, client: any, candidates: string[]): Promise<ParsedSymbol[]> {
  const PROMPT = `You are a P&ID legend digitizer. Extract ALL symbols from this legend page.
Return JSON ONLY: {"symbols":[{"name":"label","assetType":"type","tagPattern":"P-### or null","description":"string or null","aliases":[],"bbox":[ymin,xmin,ymax,xmax]}]}
bbox: tight around symbol graphic only, 0-1000 coords, NOT including text label.`;

  const imgPart = { inlineData: { mimeType: 'image/png' as const, data: pngBase64 } };
  let lastErr: unknown;
  for (const modelName of candidates) {
    if (JSON_MODE_INCOMPATIBLE.has(modelName)) continue;
    try {
      const model = client.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' } });
      const r = await model.generateContent([{ text: PROMPT }, imgPart]);
      const j = parseJsonResponse(r.response.text()) as { symbols?: unknown[] };
      const raw = Array.isArray(j.symbols) ? j.symbols : [];
      if (raw.length === 0) { lastErr = new Error('0 symbols'); continue; }
      return raw.map((s: any) => {
        const { x, y, w, h } = extractBbox(s);
        return { asset_type: String(s.assetType ?? 'Unknown').slice(0, 120), symbol_name: s.name ?? null, tag_pattern: s.tagPattern ?? null, description: s.description ?? null, aliases: Array.isArray(s.aliases) ? s.aliases : [], bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h };
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|quota|rate|overloaded|503|404|fetch/i.test(msg);
      console.warn(`[legend-extract] page ${page} ${modelName}: ${msg.slice(0, 150)}`);
      lastErr = e;
      if (retryable) continue;
      throw e;
    }
  }
  lastErr = lastErr;
  if (lastErr) throw lastErr;
  return [];
}

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
