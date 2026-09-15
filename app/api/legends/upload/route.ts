import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { validatePdfFile, getPdfPageCountFromBuffer } from "@/lib/pdf-render";
import { getGeminiModel, getDeepSeekClient } from "@/lib/gemini";
import { env } from "@/lib/env";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const name = (form.get("name") as string) || file?.name?.replace(/\.pdf$/i, "") || "Uploaded Legend";
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  const v = validatePdfFile(file);
  if (v) return NextResponse.json({ error: v }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  await getPdfPageCountFromBuffer(buf); // validates PDF is parseable

  const legendId = uuidv4();
  await db.query("INSERT INTO legends (id, name, description) VALUES ($1,$2,$3)", [legendId, name, `Imported from ${file.name}`]);

  // Try AI parse (non-blocking failure)
  let draft: any[] = [];
  try {
    draft = await parseLegendPdf(buf);
    for (const s of draft) {
      const parsed = { asset_type: s.assetType ?? s.asset_type ?? "Unknown", symbol_name: s.symbolName ?? s.symbol_name ?? null, tag_pattern: s.tagPattern ?? s.tag_pattern ?? null, description: s.description ?? null, aliases: s.aliases ?? [] };
      await db.query("INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')",
        [uuidv4(), legendId, parsed.asset_type, parsed.symbol_name, parsed.tag_pattern, parsed.description, parsed.aliases]);
    }
    // Legend stays DRAFT until symbols reviewed
    if (draft.length > 0) await db.query("UPDATE legends SET status='DRAFT' WHERE id=$1", [legendId]);
  } catch (e: any) {
    console.warn("[legend/upload] AI parse failed:", e.message);
  }

  return NextResponse.json({ id: legendId, name, symbols: draft }, { status: 201 });
}

async function parseLegendPdf(buf: Buffer): Promise<any[]> {
  const b64 = buf.toString("base64").slice(0, 80000);
  const prompt = `You are a P\u0026ID legend parser. Extract every symbol definition visible in this legend document image(s).

Return JSON: { "symbols": [ { "assetType": string, "symbolName": string|null, "tagPattern": string|null, "description": string|null, "aliases": string[] }] }

Rules:
- assetType is canonical equipment class (Pump, Valve, Vessel, etc.)
- tagPattern like "P-###" if visible, else null
- Do not invent symbols.`;

  if (env.AI_PROVIDER === "deepseek" && env.DEEPSEEK_API_KEY) {
    const client = getDeepSeekClient();
    const c = await client.chat.completions.create({ model: "deepseek-chat", messages: [{ role: "system", content: prompt }, { role: "user", content: "Parse the attached legend PDF (base64 truncated). Return symbols JSON." }], response_format: { type: "json_object" } });
    const j = JSON.parse(c.choices[0].message.content ?? "{}");
    return Array.isArray(j.symbols) ? j.symbols : [];
  }

  const model = getGeminiModel();
  const r = await model.generateContent([{ text: prompt }, { inlineData: { mimeType: "application/pdf", data: b64 } }]);
  const text = r.response.text();
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const j = JSON.parse(m ? m[1] : text);
  return Array.isArray(j.symbols) ? j.symbols : Array.isArray(j) ? j : [];
}
