import { getAiConfig } from '@/lib/ai-config';
import { getGeminiClient } from '@/lib/gemini';
import { resolveGeminiModels, resolveDeepSeekModels } from '@/lib/model-resolver';
import OpenAI from 'openai';

export interface ParsedSymbol {
  asset_type: string; symbol_name: string | null; tag_pattern: string | null;
  description: string | null; aliases: string[];
  bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
}

async function getModelWithFallback() {
  const cfg = await getAiConfig();
  const client = await getGeminiClient();
  const candidates = await resolveGeminiModels();
  return { client, candidates, cfg };
}

export function parseJsonResponse(text: string): Record<string, unknown> {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) { try { return JSON.parse(m[1]) as Record<string, unknown>; } catch {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
  throw new Error(`No JSON in response: ${text.slice(0, 500)}`);
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

/**
 * DeepSeek reparse prompt — text-only, no image.
 * Used when provider=deepseek or as fallback when Gemini image analysis fails.
 * Accepts OCR text extracted from legend page and re-structures it into ParsedSymbol format.
 */
const DEEPSEEK_REPARSE_PROMPT = `You are a P&ID legend parser. You will receive OCR text extracted from a P&ID legend sheet.

Your task: parse the OCR text and extract every equipment symbol entry.

For each symbol entry found in the OCR text:
- name: the symbol label (e.g. "CENTRIFUGAL PUMP", "GATE VALVE", "VESSEL")
- assetType: canonical type from this list: Pump|Valve|Vessel|Tank|Compressor|Heat Exchanger|Filter|Instrument|PSV|Control Valve|Motor|Fan|Column|Reactor|Separator|Agitator|Ejector|Strainer|other
- tagPattern: tag pattern if present (e.g. "P-###", "V-###"), else null
- description: short description if present, else null
- aliases: alternative spellings/abbreviations if present, else []

Return JSON ONLY — no markdown, no explanation:
{"symbols":[{"name":"...","assetType":"...","tagPattern":"P-### or null","description":"string or null","aliases":[]}]}

Rules:
- Parse everything that looks like an equipment symbol entry.
- Do NOT invent entries not present in the OCR text.
- If OCR text is unclear, extract best-effort.
- Return valid JSON only.`;

function mapRawToSymbol(s: Record<string, unknown>): ParsedSymbol {
  const { x, y, w, h } = extractBbox(s);
  return {
    asset_type: String((s.assetType ?? (s as any).asset_type ?? 'Unknown')).slice(0, 120),
    symbol_name: ((s.name as string) ?? ((s as any).symbolName as string) ?? ((s as any).symbol_name as string) ?? null) as string | null,
    tag_pattern: ((s.tagPattern as string) ?? ((s as any).tag_pattern as string) ?? null) as string | null,
    description: ((s.description as string) ?? null) as string | null,
    aliases: Array.isArray(s.aliases) ? s.aliases as string[] : Array.isArray((s as any).alias) ? (s as any).alias as string[] : [],
    bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h,
  };
}

/**
 * Extract legend symbols from a rendered PNG page using Gemini Vision.
 * Falls back across gemini-3.6-flash → gemini-2.5-flash.
 */
export async function extractLegendSymbolsFromPng(pngBase64: string, page: number): Promise<ParsedSymbol[]> {
  const { client, candidates, cfg } = await getModelWithFallback();

  // DeepSeek cannot analyze images — no base64 image understanding.
  // Caller should use extractLegendSymbolsFromOcr() with OCR text instead.
  if (cfg.provider === 'deepseek') {
    throw new Error('DeepSeek cannot analyse images — use extractLegendSymbolsFromOcr() with OCR text, or switch provider to Gemini in Settings');
  }

  const imgPart = { inlineData: { mimeType: 'image/png', data: pngBase64 } };
  let lastErr: unknown;
  for (const modelName of candidates) {
    try {
      const model = client.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' } });
      const r = await model.generateContent([{ text: DENSE_PROMPT }, imgPart]);
      const text = r.response.text();
      const j = parseJsonResponse(text) as { symbols?: unknown[]; data?: unknown[] };
      const raw: unknown[] = Array.isArray(j.symbols) ? j.symbols : Array.isArray(j.data) ? j.data : Array.isArray(j as unknown as unknown[]) ? j as unknown as unknown[] : [];
      if (raw.length === 0) {
        lastErr = new Error(`Model ${modelName} returned 0 symbols`);
        const retryable = /429|quota|rate|overloaded|503|not.found|404/i.test(text);
        if (!retryable) { console.warn(`[legend-extract] page ${page} 0 symbols from ${modelName}, trying next`); continue; }
        throw lastErr;
      }
      return raw.map((s) => mapRawToSymbol(s as Record<string, unknown>));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Always try next model unless it's an auth error (wrong API key) or explicit non-retryable.
      // Covers: 404, not found, deprecated, unsupported, FAILED_PRECONDITION, model errors, rate limits, etc.
      const authError = /API.?key|PERMISSION_DENIED|invalid.key|unauthorized|403/i.test(msg);
      console.warn(`[legend-extract] page ${page} model ${modelName} failed: ${msg.slice(0, 300)}`);
      lastErr = e;
      if (!authError) continue;  // try next model
      throw e;  // auth error — no point retrying other models with same key
    }
  }
  throw lastErr ?? new Error('All models failed');
}

/**
 * Reparse legend symbols from OCR text using DeepSeek (text-only).
 * Used when:
 *   - provider = deepseek (no image support)
 *   - Gemini image extraction failed and OCR text is available as fallback
 *   - User explicitly requests reparse with DeepSeek
 *
 * @param ocrText  OCR text extracted from legend page(s)
 * @param page     page number (for logging)
 */
export async function extractLegendSymbolsFromOcr(ocrText: string, page: number): Promise<ParsedSymbol[]> {
  const cfg = await getAiConfig();

  if (cfg.provider === 'deepseek' && cfg.deepseekKey) {
    return extractLegendFromOcrWithDeepSeek(ocrText, page, cfg.deepseekKey, cfg.deepseekModel ?? 'deepseek-chat');
  }

  // Gemini text-only fallback — use same model chain but text-only content
  const { client, candidates } = await getModelWithFallback();
  let lastErr: unknown;
  for (const modelName of candidates) {
    try {
      const model = client.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' } });
      const r = await model.generateContent([
        { text: DEEPSEEK_REPARSE_PROMPT },
        { text: `OCR TEXT FROM PAGE ${page}:\n${ocrText.slice(0, 12000)}` },
      ]);
      const text = r.response.text();
      const j = parseJsonResponse(text) as { symbols?: unknown[] };
      const raw: unknown[] = Array.isArray(j.symbols) ? j.symbols : [];
      if (raw.length === 0) { lastErr = new Error(`Model ${modelName} returned 0 symbols from OCR`); continue; }
      console.log(`[legend-extract] OCR reparse page ${page} via Gemini ${modelName}: ${raw.length} symbols`);
      return raw.map((s) => mapRawToSymbol(s as Record<string, unknown>));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[legend-extract] OCR reparse page ${page} model ${modelName} failed: ${msg.slice(0, 300)}`);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All models failed for OCR reparse');
}

/**
 * DeepSeek text-only legend extraction.
 * DeepSeek-chat handles structured JSON extraction from OCR text well.
 */
async function extractLegendFromOcrWithDeepSeek(
  ocrText: string,
  page: number,
  apiKey: string,
  model: string,
): Promise<ParsedSymbol[]> {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: DEEPSEEK_REPARSE_PROMPT },
      {
        role: 'user',
        content: `OCR TEXT FROM LEGEND PAGE ${page}:\n${ocrText.slice(0, 12000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 8192,
  });

  const text = completion.choices[0].message.content ?? '{}';
  const j = parseJsonResponse(text) as { symbols?: unknown[] };
  const raw: unknown[] = Array.isArray(j.symbols) ? j.symbols : [];

  if (raw.length === 0) {
    throw new Error(`DeepSeek returned 0 symbols from OCR text (page ${page})`);
  }

  console.log(`[legend-extract] DeepSeek OCR reparse page ${page}: ${raw.length} symbols`);
  return raw.map((s) => mapRawToSymbol(s as Record<string, unknown>));
}
