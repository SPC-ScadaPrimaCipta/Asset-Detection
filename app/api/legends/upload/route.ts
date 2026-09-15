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
  const prompt = `You are a P&ID legend parser. Extract every symbol definition visible in this legend PDF.

Return ONLY valid JSON (no markdown): { "symbols": [ { "assetType": string, "symbolName": string|null, "tagPattern": string|null, "description": string|null, "aliases": string[] }] }

Rules:
- assetType is canonical equipment class (Pump, Valve, Vessel, etc.)
- tagPattern like "P-###" if visible, else null
- Do not invent symbols.`;

  try {
    const model = getGeminiModel();
    const r = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: "application/pdf", data: b64 } },
    ]);
    const text = r.response.text();
    const jsonMatch = text.match(/\{[\s\S]*"symbols"[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[parseLegendPdf] no JSON found:", text.slice(0, 300));
      return [];
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed.symbols) ? parsed.symbols : [];
  } catch (e: any) {
    console.warn("[parseLegendPdf] failed:", e.message);
    return [];
  }
}
