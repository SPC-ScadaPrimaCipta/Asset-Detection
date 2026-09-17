import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { env } from '@/lib/env';

const RENDER_SCALE = 4.0; // ~288dpi

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const leg = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (leg.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });

    const storedFilename = `legend-${id}.pdf`;
    let buf: Buffer;
    try {
      buf = await getFile(storedFilename) as unknown as Buffer;
    } catch {
      return NextResponse.json(
        { error: 'Legend PDF not found in storage. Re-upload to re-parse.' },
        { status: 404 }
      );
    }

    const pageCount = await getPdfPageCountFromBuffer(buf);
    await db.query("DELETE FROM legend_symbols WHERE legend_id=$1 AND status='DRAFT'", [id]);

    let totalInserted = 0;

    for (let page = 1; page <= pageCount; page++) {
      let pngBase64: string;
      try {
        const png = await renderPageToPng(buf, page, RENDER_SCALE);
        pngBase64 = png.toString('base64');
      } catch (e: unknown) {
        console.warn(`[reparse] page ${page} render failed:`, (e instanceof Error ? e.message : String(e)).slice(0, 200));
        continue;
      }

      let symbols: ParsedSymbol[] = [];
      try {
        symbols = await parsePageSymbols(pngBase64, page);
      } catch (e: unknown) {
        console.warn(`[reparse] page ${page} AI failed:`, (e instanceof Error ? e.message : String(e)).slice(0, 500));
        continue;
      }

      for (const s of symbols) {
        await db.query(
          `INSERT INTO legend_symbols
             (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status,
              bbox_x, bbox_y, bbox_w, bbox_h, pid_page)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12)`,
          [
            uuidv4(), id,
            s.asset_type.slice(0, 120),
            s.symbol_name,
            s.tag_pattern,
            s.description,
            s.aliases,
            s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h,
            page,
          ]
        );
        totalInserted++;
      }
    }

    return NextResponse.json({ inserted: totalInserted, pages: pageCount });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends/reparse]', msg);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}

interface ParsedSymbol {
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  description: string | null;
  aliases: string[];
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
}

function getModel() {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  console.log(`[reparse] using model: ${modelName}`);
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });
}

function parseJsonResponse(text: string): Record<string, unknown> {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { /* fall through */ }
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) { try { return JSON.parse(m[1]) as Record<string, unknown>; } catch { /* fall through */ } }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  throw new Error(`No JSON found in response: ${text.slice(0, 400)}`);
}

async function parsePageSymbols(pngBase64: string, page: number): Promise<ParsedSymbol[]> {
  if (env.AI_PROVIDER === 'deepseek') {
    console.warn('[reparse] DeepSeek does not support image analysis');
    return [];
  }

  const model = getModel();
  const imgPart = { inlineData: { mimeType: 'image/png', data: pngBase64 } };

  // ── PASS 1: Understand what kind of document this is ──────────────────────
  const classifyPrompt = `Analyze this image and determine what type of engineering document it is.

Respond with ONLY this JSON (no explanation):
{
  "documentType": "LEGEND_TABLE" | "PID_DIAGRAM" | "MIXED" | "OTHER",
  "description": "one sentence describing what you see",
  "hasLegendTable": true | false,
  "hasPidContent": true | false
}

Definitions:
- LEGEND_TABLE: A table or list showing P&ID symbols with their names/descriptions (a key/legend sheet)
- PID_DIAGRAM: A full Piping & Instrumentation Diagram showing connected equipment, pipes, and instruments
- MIXED: Contains both a legend table AND a P&ID diagram
- OTHER: Something else entirely`;

  const classifyR = await model.generateContent([{ text: classifyPrompt }, imgPart]);
  const classifyText = classifyR.response.text();
  console.log(`[reparse] page ${page} classification:`, classifyText.slice(0, 300));

  let docType = 'PID_DIAGRAM';
  try {
    const cls = parseJsonResponse(classifyText) as { documentType?: string };
    docType = cls.documentType ?? 'PID_DIAGRAM';
  } catch {
    console.warn(`[reparse] page ${page} classify parse failed, defaulting to PID_DIAGRAM`);
  }

  console.log(`[reparse] page ${page} document type: ${docType}`);

  // ── PASS 2: Extract symbols based on document type ────────────────────────
  if (docType === 'LEGEND_TABLE') {
    return parseLegendTable(model, imgPart, page);
  } else {
    // PID_DIAGRAM, MIXED, or OTHER — all get full P&ID asset extraction
    return parsePidDiagram(model, imgPart, page);
  }
}

async function parseLegendTable(
  model: ReturnType<typeof getModel>,
  imgPart: { inlineData: { mimeType: string; data: string } },
  page: number
): Promise<ParsedSymbol[]> {
  const prompt = `This image is a P&ID LEGEND TABLE — it shows symbol definitions with their names.

Extract EVERY symbol definition from this legend. For each symbol shown:

Return JSON:
{
  "symbols": [
    {
      "name": "exact symbol name from legend text",
      "assetType": "canonical type: Pump|Valve|Vessel|Tank|Compressor|Heat Exchanger|Filter|Instrument|PSV|Control Valve|Motor|Fan|Pipe|Reducer|Tee|Elbow|Flange|other",
      "tagPattern": "tag format like P-### if shown, else null",
      "description": "description text if shown, else null",
      "aliases": ["alt names if any"],
      "bbox": [ymin, xmin, ymax, xmax]
    }
  ]
}

bbox = bounding box of the SYMBOL GRAPHIC ONLY (not text label).
Coordinates normalized 0–1000: (0,0)=top-left, (1000,1000)=bottom-right.
Detect ALL symbols — do not miss any.`;

  const r = await model.generateContent([{ text: prompt }, imgPart]);
  const text = r.response.text();
  console.log(`[reparse] page ${page} legend response length: ${text.length}`);

  const j = parseJsonResponse(text) as { symbols?: unknown[] };
  const raw = Array.isArray(j.symbols) ? j.symbols : [];
  console.log(`[reparse] page ${page} legend symbols: ${raw.length}`);

  return raw.map((s): ParsedSymbol => {
    const sym = s as Record<string, unknown>;
    const bbox = sym.bbox as number[] | null | undefined;
    const ymin = Array.isArray(bbox) ? Number(bbox[0] ?? 0) : null;
    const xmin = Array.isArray(bbox) ? Number(bbox[1] ?? 0) : null;
    const ymax = Array.isArray(bbox) ? Number(bbox[2] ?? 0) : null;
    const xmax = Array.isArray(bbox) ? Number(bbox[3] ?? 0) : null;

    return {
      asset_type:  String(sym.assetType ?? 'Unknown').slice(0, 120),
      symbol_name: (sym.name as string | null) ?? null,
      tag_pattern: (sym.tagPattern as string | null) ?? null,
      description: (sym.description as string | null) ?? null,
      aliases:     Array.isArray(sym.aliases) ? (sym.aliases as string[]) : [],
      bbox_x: xmin,
      bbox_y: ymin,
      bbox_w: xmin != null && xmax != null ? Math.max(1, xmax - xmin) : null,
      bbox_h: ymin != null && ymax != null ? Math.max(1, ymax - ymin) : null,
    };
  });
}

async function parsePidDiagram(
  model: ReturnType<typeof getModel>,
  imgPart: { inlineData: { mimeType: string; data: string } },
  page: number
): Promise<ParsedSymbol[]> {
  // For a full P&ID, do a thorough multi-type extraction
  const prompt = `This image is a P&ID (Piping and Instrumentation Diagram). 

Your task: identify and extract ALL distinct equipment symbols, instruments, and tagged items visible in this diagram.

DETECTION SCOPE — find every instance of:
1. ROTATING EQUIPMENT: Pumps (centrifugal, positive displacement, turbine), Compressors, Fans, Blowers, Mixers, Agitators
2. STATIC EQUIPMENT: Vessels, Tanks, Heat Exchangers, Columns, Reactors, Separators, Filters, Strainers, Scrubbers
3. VALVES: Gate, Globe, Ball, Butterfly, Check, Control, PSV/PRV, Pressure Regulator, Needle, Plug
4. INSTRUMENTS: Flow indicators/transmitters (FI/FT/FIC), Pressure (PI/PT/PIC), Temperature (TI/TT/TIC), Level (LI/LT/LIC), Analyzers
5. DRIVERS: Motors, Turbines, Engines
6. PIPING ITEMS: Reducers, Y-strainers, Inline items with tags
7. SPECIALTY: Ejectors, Eductors, Inline mixers

For EACH detected item:
- Read the exact tag/number visible (e.g. P-101, V-201, FIC-301, XV-101A) — if not visible, null
- Identify the symbol type from its graphical shape
- Record precise bounding box

Return JSON:
{
  "assets": [
    {
      "assetType": "equipment type",
      "symbolName": "descriptive symbol name",
      "assetTag": "exact tag text visible or null",
      "tagPattern": "inferred pattern like P-### or null",
      "description": "any visible description text or null",
      "confidence": 0.0-1.0,
      "bbox": [ymin, xmin, ymax, xmax],
      "evidence": "what visual feature identifies this as this type"
    }
  ]
}

bbox normalized 0–1000: (0,0)=top-left, (1000,1000)=bottom-right.
IMPORTANT: Scan the ENTIRE image systematically. Return EVERY identifiable equipment item.
Do NOT detect: pipe lines, signal lines, flow arrows, title blocks, revision tables.`;

  const r = await model.generateContent([{ text: prompt }, imgPart]);
  const text = r.response.text();
  console.log(`[reparse] page ${page} P&ID response length: ${text.length}`);

  const j = parseJsonResponse(text) as { assets?: unknown[] };
  const raw = Array.isArray(j.assets) ? j.assets : [];
  console.log(`[reparse] page ${page} P&ID assets detected: ${raw.length}`);

  return raw.map((s): ParsedSymbol => {
    const sym = s as Record<string, unknown>;
    const bbox = sym.bbox as number[] | null | undefined;
    const ymin = Array.isArray(bbox) ? Number(bbox[0] ?? 0) : null;
    const xmin = Array.isArray(bbox) ? Number(bbox[1] ?? 0) : null;
    const ymax = Array.isArray(bbox) ? Number(bbox[2] ?? 0) : null;
    const xmax = Array.isArray(bbox) ? Number(bbox[3] ?? 0) : null;

    // Use assetTag as part of symbol_name for better display
    const tag = (sym.assetTag as string | null) ?? null;
    const symName = (sym.symbolName as string | null) ?? null;
    const displayName = tag ? `${tag} — ${symName ?? sym.assetType}` : symName;

    return {
      asset_type:  String(sym.assetType ?? 'Unknown').slice(0, 120),
      symbol_name: displayName ?? null,
      tag_pattern: (sym.tagPattern as string | null) ?? null,
      description: (sym.description as string | null) ?? null,
      aliases:     tag ? [tag] : [],
      bbox_x: xmin,
      bbox_y: ymin,
      bbox_w: xmin != null && xmax != null ? Math.max(1, xmax - xmin) : null,
      bbox_h: ymin != null && ymax != null ? Math.max(1, ymax - ymin) : null,
    };
  });
}
