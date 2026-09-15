import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getGeminiModel, getDeepSeekClient } from '@/lib/gemini';
import { env } from '@/lib/env';

/**
 * POST /api/legends/[id]/reparse
 * Re-runs AI legend parse on the stored PDF and upserts symbols.
 * Useful when original parse failed (e.g., DB schema missing columns).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const leg = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (leg.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });

    // PDF stored as legend-{id}.pdf
    const storedFilename = `legend-${id}.pdf`;
    let buf: Buffer;
    try {
      buf = await getFile(storedFilename) as unknown as Buffer;
    } catch {
      return NextResponse.json({ error: 'Legend PDF not found in storage. Re-upload to re-parse.' }, { status: 404 });
    }

    const draft = await parseLegendPdf(buf, leg.rows[0].name);

    // Delete existing DRAFT symbols, then re-insert
    await db.query("DELETE FROM legend_symbols WHERE legend_id=$1 AND status='DRAFT'", [id]);

    let inserted = 0;
    for (const s of draft) {
      const parsed = {
        asset_type: ((s.assetType ?? s.asset_type ?? 'Unknown') as string).slice(0, 120),
        symbol_name: ((s.symbolName ?? s.symbol_name ?? null) as string | null),
        tag_pattern: ((s.tagPattern ?? s.tag_pattern ?? null) as string | null),
        description: ((s.description ?? null) as string | null),
        aliases: (Array.isArray(s.aliases) ? s.aliases : []) as string[],
      };
      await db.query(
        `INSERT INTO legend_symbols
           (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')`,
        [uuidv4(), id, parsed.asset_type, parsed.symbol_name, parsed.tag_pattern, parsed.description, parsed.aliases]
      );
      inserted++;
    }

    return NextResponse.json({ inserted, total: draft.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends/reparse]', msg);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}

async function parseLegendPdf(buf: Buffer, name: string): Promise<Record<string, unknown>[]> {
  const b64 = buf.toString('base64');

  const prompt = `You are an expert P&ID legend analyzer. Extract ALL symbol definitions from this P&ID legend document.

For each symbol, extract:
1. Asset Type (canonical class: Pump, Valve, Vessel, Tank, Compressor, HX, Filter, Motor, Fan, Instrument, PSV, etc.)
2. Symbol Name (descriptive name visible in legend)
3. Tag Pattern (if visible, like "P-###", "V-###", else null)
4. Description (brief description or null)
5. Aliases (alternative names or abbreviations)

CRITICAL RULES:
- Extract ALL symbols you can find in the legend
- Return null for values not visible
- Do NOT fabricate symbols or descriptions
- Return ONLY valid JSON, no markdown

Return ONLY this JSON:
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

  if (env.AI_PROVIDER === 'deepseek' && env.DEEPSEEK_API_KEY) {
    const client = getDeepSeekClient();
    const c = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Parse legend: ${name}` },
      ],
      response_format: { type: 'json_object' },
    });
    const j = JSON.parse(c.choices[0].message.content ?? '{}') as Record<string, unknown>;
    return Array.isArray(j.symbols) ? (j.symbols as Record<string, unknown>[]) : [];
  }

  const model = getGeminiModel();
  const r = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'application/pdf', data: b64 } },
  ]);

  const text = r.response.text();
  let j: Record<string, unknown>;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) {
    j = JSON.parse(m[1]) as Record<string, unknown>;
  } else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in Gemini response');
    j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  }

  if (Array.isArray(j.symbols)) return j.symbols as Record<string, unknown>[];
  if (Array.isArray(j)) return j as Record<string, unknown>[];
  return [];
}
