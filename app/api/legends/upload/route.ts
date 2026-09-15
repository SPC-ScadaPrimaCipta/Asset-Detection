import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { validatePdfFile, getPdfPageCountFromBuffer } from "@/lib/pdf-render";
import { getGeminiModel } from "@/lib/gemini";
import { saveFile } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const name = (form.get("name") as string) || file?.name?.replace(/\.pdf$/i, "") || "Uploaded Legend";
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  const v = validatePdfFile(file);
  if (v) return NextResponse.json({ error: v }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  await getPdfPageCountFromBuffer(buf);

  const legendId = uuidv4();
  const storedFilename = `legend-${legendId}.pdf`;
  await saveFile(storedFilename, buf);

  await db.query("INSERT INTO legends (id, name, description, status) VALUES ($1,$2,$3,$4)", [legendId, name, `Imported from ${file.name}`, 'DRAFT']);

  let draft: any[] = [];
  try {
    draft = await parseLegendPdf(buf);
    for (const s of draft) {
      const parsed = {
        asset_type: s.assetType ?? s.asset_type ?? "Unknown",
        symbol_name: s.symbolName ?? s.symbol_name ?? null,
        tag_pattern: s.tagPattern ?? s.tag_pattern ?? null,
        description: s.description ?? null,
        aliases: s.aliases ?? [],
      };
      await db.query(
        "INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')",
        [uuidv4(), legendId, parsed.asset_type, parsed.symbol_name, parsed.tag_pattern, parsed.description, parsed.aliases]
      );
    }
  } catch (e: any) {
    console.warn("[legend/upload] AI parse failed:", e.message);
  }

  return NextResponse.json({ id: legendId, name, symbols: draft }, { status: 201 });
}

async function parseLegendPdf(buf: Buffer): Promise<any[]> {
  const b64 = buf.toString("base64");
  const prompt = `You are an expert P&ID legend analyzer. Extract ALL symbol definitions from this P&ID legend document.

For each symbol, extract:
1. Asset Type (canonical class: Pump, Valve, Vessel, Tank, Compressor, HX, Filter, Motor, Fan, Instrument, PSV, etc.)
2. Symbol Name (descriptive name visible in legend, e.g., "Pump Symbol", "Gate Valve")
3. Tag Pattern (if visible, like "P-###", "V-###", "E-##", else null)
4. Description (brief description of symbol purpose/meaning, or null)
5. Aliases (alternative names or abbreviations for the symbol)

CRITICAL RULES:
- Examine the entire legend carefully for all symbols shown
- Extract canonical asset types ONLY (do NOT invent)
- Return null for values not visible in the legend
- Do NOT fabricate symbols, tags, or descriptions
- Each symbol should have at least asset_type and symbol_name
- Return structured JSON only, no markdown or explanations

Return ONLY valid JSON in this exact format:
{
  "symbols": [
    {
      "assetType": "string",
      "symbolName": "string or null",
      "tagPattern": "string or null",
      "description": "string or null",
      "aliases": ["string"]
    }
  ]
}`;

  try {
    const model = getGeminiModel();
    console.log("[parseLegendPdf] Analyzing legend PDF, size:", buf.length, "bytes");
    
    const r = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: "application/pdf", data: b64 } },
    ]);
    
    const text = r.response.text();
    console.log("[parseLegendPdf] Gemini response length:", text.length);
    
    // Extract JSON: try code block first, then raw JSON
    let json: any;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      json = JSON.parse(codeBlockMatch[1]);
      console.log("[parseLegendPdf] Parsed from code block");
    } else {
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        console.warn("[parseLegendPdf] No JSON found in response");
        return [];
      }
      json = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      console.log("[parseLegendPdf] Parsed from raw text");
    }
    
    if (!json.symbols || !Array.isArray(json.symbols)) {
      console.warn("[parseLegendPdf] Invalid structure, no symbols array");
      return [];
    }
    
    // Validate and normalize each symbol
    const symbols = json.symbols
      .filter((s: any) => s && s.assetType)
      .map((s: any) => ({
        assetType: String(s.assetType).trim(),
        symbolName: s.symbolName ? String(s.symbolName).trim() : null,
        tagPattern: s.tagPattern ? String(s.tagPattern).trim() : null,
        description: s.description ? String(s.description).trim() : null,
        aliases: Array.isArray(s.aliases) ? s.aliases.map((a: any) => String(a).trim()) : [],
      }));
    
    console.log("[parseLegendPdf] Extracted", symbols.length, "valid symbols");
    return symbols;
  } catch (e: any) {
    console.error("[parseLegendPdf] Failed:", e.message);
    return [];
  }
}
