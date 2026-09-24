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
  const s = trimmed.indexOf('{'), e = trimmed.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) return JSON.parse(trimmed.slice(s, e + 1)) as Record<string, unknown>;
  throw new Error(`No JSON in response: ${trimmed.slice(0, 200)}`);
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

// ─── Region prompt ────────────────────────────────────────────────────────────

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
  throw lastErr ?? new Error('All models failed');
}
