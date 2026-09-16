import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getGeminiModel } from '@/lib/gemini';
import { getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { env } from '@/lib/env';

const RENDER_SCALE = 2.0;

/**
 * POST /api/legends/[id]/reparse
 *
 * Renders each PDF page to PNG, sends to Gemini Vision with a prompt
 * that asks for normalized bounding boxes (0–1000 range, ymin/xmin/ymax/xmax).
 * Stores normalized values so the viewer can convert to canvas coords at any zoom.
 */
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
        symbols = await parseLegendPage(pngBase64, page);
      } catch (e: unknown) {
        console.warn(`[reparse] page ${page} AI failed:`, (e instanceof Error ? e.message : String(e)).slice(0, 300));
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
            s.bbox_xmin, s.bbox_ymin,
            s.bbox_xmax != null && s.bbox_xmin != null ? s.bbox_xmax - s.bbox_xmin : null,
            s.bbox_ymax != null && s.bbox_ymin != null ? s.bbox_ymax - s.bbox_ymin : null,
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
  // Normalized 0-1000 bounding box (ymin, xmin, ymax, xmax)
  bbox_ymin: number | null;
  bbox_xmin: number | null;
  bbox_ymax: number | null;
  bbox_xmax: number | null;
}

async function parseLegendPage(pngBase64: string, page: number): Promise<ParsedSymbol[]> {
  if (env.AI_PROVIDER === 'deepseek') {
    console.warn('[reparse] DeepSeek does not support image — skipping bbox detection');
    return [];
  }

  const model = getGeminiModel();

  // Gemini natively understands normalized 0-1000 bbox format [ymin, xmin, ymax, xmax]
  // This is the format Gemini Vision was trained on — much more accurate than pixel coords
  const prompt = `You are analyzing page ${page} of a P&ID (Piping and Instrumentation Diagram) legend.

Task: Detect and locate EVERY industrial equipment symbol shown in this legend page.

For each symbol, provide:
1. name: the symbol name exactly as shown in the legend
2. assetType: canonical equipment class (Pump, Valve, Vessel, Instrument, Filter, etc.)
3. tagPattern: tag format if visible (e.g. "P-###"), else null
4. bbox: bounding box of the SYMBOL GRAPHIC (not the text label) as [ymin, xmin, ymax, xmax]
   where coordinates are NORMALIZED 0-1000:
   - 0,0 = top-left corner of the image
   - 1000,1000 = bottom-right corner of the image

IMPORTANT:
- Detect ALL symbols visible — do not skip any
- bbox must enclose only the graphic drawing, NOT surrounding text
- Be precise with bbox — tight around the symbol shape
- Return null for tagPattern if not shown
- Return ONLY valid JSON, no explanation

JSON format:
{
  "symbols": [
    {
      "name": "Gate Valve",
      "assetType": "Valve",
      "tagPattern": null,
      "bbox": [120, 45, 145, 75]
    }
  ]
}`;

  const r = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: pngBase64 } },
  ]);

  const text = r.response.text();
  console.log(`[reparse] page ${page} response length: ${text.length}`);

  let j: { symbols?: unknown[] };
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) {
    j = JSON.parse(m[1]) as typeof j;
  } else {
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in Gemini response');
    j = JSON.parse(text.slice(start, end + 1)) as typeof j;
  }

  const raw = Array.isArray(j.symbols) ? j.symbols : [];

  return raw.map((s): ParsedSymbol => {
    const sym  = s as Record<string, unknown>;
    const bbox = sym.bbox as number[] | null | undefined;

    // bbox format: [ymin, xmin, ymax, xmax] normalized 0-1000
    const bbox_ymin = Array.isArray(bbox) && bbox[0] != null ? Number(bbox[0]) : null;
    const bbox_xmin = Array.isArray(bbox) && bbox[1] != null ? Number(bbox[1]) : null;
    const bbox_ymax = Array.isArray(bbox) && bbox[2] != null ? Number(bbox[2]) : null;
    const bbox_xmax = Array.isArray(bbox) && bbox[3] != null ? Number(bbox[3]) : null;

    return {
      asset_type:  String(sym.assetType ?? sym.asset_type ?? 'Unknown').slice(0, 120),
      symbol_name: ((sym.name ?? sym.symbolName ?? sym.symbol_name ?? null) as string | null),
      tag_pattern: ((sym.tagPattern ?? sym.tag_pattern ?? null) as string | null),
      description: null,
      aliases:     [],
      bbox_ymin, bbox_xmin, bbox_ymax, bbox_xmax,
    };
  });
}
