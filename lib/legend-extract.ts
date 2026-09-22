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

export async function extractLegendSymbolsFromPng(pngBase64: string, page: number): Promise<ParsedSymbol[]> {
  const { client, candidates, cfg } = await getModelWithFallback();
  if (cfg.provider === 'deepseek') throw new Error('DeepSeek cannot analyse images — switch provider to Gemini in Settings');
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
      return raw.map((s): ParsedSymbol => {
        const sym = s as Record<string, unknown>;
        const { x, y, w, h } = extractBbox(sym);
        return {
          asset_type: String((sym.assetType ?? (sym as any).asset_type ?? 'Unknown')).slice(0, 120),
          symbol_name: (sym.name as string ?? (sym as any).symbolName as string ?? (sym as any).symbol_name as string ?? null) as string | null,
          tag_pattern: (sym.tagPattern as string ?? (sym as any).tag_pattern as string ?? null) as string | null,
          description: (sym.description as string ?? null) as string | null,
          aliases: Array.isArray(sym.aliases) ? sym.aliases as string[] : Array.isArray((sym as any).alias) ? (sym as any).alias as string[] : [],
          bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h,
        };
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|quota|rate|overloaded|high demand|503|not.found|404|fetch/i.test(msg);
      console.warn(`[legend-extract] page ${page} model ${modelName} failed: ${msg.slice(0, 300)}`);
      lastErr = e;
      if (retryable) continue;
      throw e;
    }
  }
  throw lastErr ?? new Error('All models failed');
}
