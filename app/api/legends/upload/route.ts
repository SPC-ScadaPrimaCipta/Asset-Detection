import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { validatePdfFile, getPdfPageCountFromBuffer } from "@/lib/pdf-render";
import { getGeminiModel, getDeepSeekClient } from "@/lib/gemini";
import { saveFile } from "@/lib/storage";
import { env } from "@/lib/env";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const name = (form.get("name") as string) || file?.name?.replace(/\.pdf$/i, "") || "Uploaded Legend";
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

    const v = validatePdfFile(file);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    await getPdfPageCountFromBuffer(buf); // validate PDF is parseable

    const legendId = uuidv4();
    // Save legend PDF so /api/legends/[id]/pdf can serve it for the review UI
    const storedFilename = `legend-${legendId}.pdf`;
    await saveFile(storedFilename, buf);

    await db.query("INSERT INTO legends (id, name, description, status) VALUES ($1,$2,$3,'DRAFT')", [
      legendId,
      name,
      `Imported from ${file.name}`,
    ]);

    // Try AI parse (non-blocking failure)
    let draft: Record<string, unknown>[] = [];
    try {
      draft = await withRetry(() => parseLegendPdf(buf, file.name));
      for (const s of draft) {
        const parsed = {
          asset_type: (s.assetType ?? s.asset_type ?? "Unknown") as string,
          symbol_name: (s.symbolName ?? s.symbol_name ?? null) as string | null,
          tag_pattern: (s.tagPattern ?? s.tag_pattern ?? null) as string | null,
          description: (s.description ?? null) as string | null,
          bbox_x: (s as any)?.bboxX ?? (s as any)?.bbox_x ?? null,
          bbox_y: (s as any)?.bboxY ?? (s as any)?.bbox_y ?? null,
          bbox_w: (s as any)?.bboxW ?? (s as any)?.bbox_w ?? null,
          bbox_h: (s as any)?.bboxH ?? (s as any)?.bbox_h ?? null,
          pid_page: (s as any)?.page ?? (s as any)?.pid_page ?? null,
          aliases: (Array.isArray(s.aliases) ? s.aliases : []) as string[],
        };
        await db.query(
          `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT')`,
          [uuidv4(), legendId, parsed.asset_type, parsed.symbol_name, parsed.tag_pattern, parsed.description, parsed.bbox_x, parsed.bbox_y, parsed.bbox_w, parsed.bbox_h, parsed.pid_page, parsed.aliases]
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[legend/upload] AI parse failed:", msg.slice(0, 300));
    }

    return NextResponse.json({ id: legendId, name, symbols: draft }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[legend/upload]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e: unknown) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /503|429|overloaded|high demand|rate/i.test(msg);
      if (!transient || i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

async function parseLegendPdf(buf: Buffer, filename: string): Promise<Record<string, unknown>[]> {
  // Send full PDF — Gemini accepts application/pdf up to ~20MB
  const b64 = buf.toString("base64");

  // Stronger prompt — also requests bbox + page per symbol
  const prompt = `You are an expert P&ID legend analyzer. Extract ALL symbol definitions from this P&ID legend document.

For each symbol, extract:
1. Asset Type (canonical class: Pump, Valve, Vessel, Tank, Compressor, HX, Filter, Motor, Fan, Instrument, PSV, etc.)
2. Symbol Name (descriptive name visible in legend, e.g., "Pump Symbol", "Gate Valve")
3. Tag Pattern (if visible, like "P-###", "V-###", "E-##", else null)
4. Description (brief description of symbol purpose/meaning, or null)
5. Aliases (alternative names or abbreviations for the symbol)
6. Bounding Box (bbox) — normalized 0–1000 coordinate space tightly enclosing ONLY the symbol graphic itself:
   - bboxX: left x (0 = page left edge, 1000 = page right edge)
   - bboxY: top y (0 = page top edge, 1000 = page bottom edge)
   - bboxW: width
   - bboxH: height
   Ignore title blocks, revision tables, and general notes — bbox must cover the symbol ONLY.
7. Page — 1-based page number where this symbol appears in the legend document.

CRITICAL RULES:
- Examine the entire legend carefully for all symbols shown
- Extract canonical asset types ONLY (do NOT invent)
- Return null for values not visible in the legend
- Do NOT fabricate symbols, tags, or descriptions
- Each symbol should have at least asset_type, symbol_name, bbox (x, y, w, h), and page
- Bounding boxes must tightly enclose the symbol graphic — ignore surrounding text
- Return structured JSON only, no markdown or explanations

Return ONLY valid JSON in this exact format:
{
  "symbols": [
    {
      "assetType": "string",
      "symbolName": "string or null",
      "tagPattern": "string or null",
      "description": "string or null",
      "aliases": ["string"],
      "bboxX": 0,
      "bboxY": 0,
      "bboxW": 0,
      "bboxH": 0,
      "page": 1
    }
  ]
}`;

  // DeepSeek fallback path
  if (env.AI_PROVIDER === "deepseek" && env.DEEPSEEK_API_KEY) {
    const client = getDeepSeekClient();
    const c = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Parse legend from file: ${filename}. Return symbols JSON only.` },
      ],
      response_format: { type: "json_object" },
    });
    const j = JSON.parse(c.choices[0].message.content ?? "{}") as Record<string, unknown>;
    return Array.isArray(j.symbols) ? (j.symbols as Record<string, unknown>[]) : [];
  }

  // Gemini — send full PDF, no truncation
  const model = getGeminiModel();
  console.log("[parseLegendPdf] Analyzing legend PDF, size:", buf.length, "bytes");

  const r = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: "application/pdf", data: b64 } },
  ]);

  const text = r.response.text();
  console.log("[parseLegendPdf] Gemini response length:", text.length);

  // Parse JSON: try code block first, then raw JSON extraction
  let j: Record<string, unknown>;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    j = JSON.parse(codeBlockMatch[1]) as Record<string, unknown>;
  } else {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found in Gemini response");
    j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  }

  if (Array.isArray(j.symbols)) return j.symbols as Record<string, unknown>[];
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  return [];
}
