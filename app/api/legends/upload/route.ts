import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { validatePdfFile, getPdfPageCountFromBuffer, renderPageToPng } from '@/lib/pdf-render';
import { saveFile } from '@/lib/storage';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { extractLegendSymbolsFromPng } from '@/lib/legend-extract';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rl = checkRateLimit(`legend-upload:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many legend uploads. Try again later.' }, { status: 429, headers: rateLimitHeaders(rl) });
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const name = (form.get('name') as string) || file?.name?.replace(/\.pdf$/i, '') || 'Uploaded Legend';
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const v = validatePdfFile(file);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    await getPdfPageCountFromBuffer(buf);

    const legendId = uuidv4();
    await saveFile(`legend-${legendId}.pdf`, buf);
    await db.query("INSERT INTO legends (id, name, description, status) VALUES ($1,$2,$3,'DRAFT')", [legendId, name, `Imported from ${file.name}`]);

    // Per-page high-res render → Gemini vision (same as reparse)
    let draft: { asset_type: string; symbol_name: string | null }[] = [];
    try {
      const pageCount = await getPdfPageCountFromBuffer(buf);
      for (let page = 1; page <= pageCount; page++) {
        let pngBase64: string;
        try {
          const { png } = await renderPageToPng(buf, page, 3.5);
          pngBase64 = png.toString('base64');
        } catch (e) {
          console.warn(`[legend/upload] page ${page} render failed:`, (e as Error).message?.slice(0, 200));
          continue;
        }
        let symbols: Awaited<ReturnType<typeof extractLegendSymbolsFromPng>>;
        try {
          symbols = await extractLegendSymbolsFromPng(pngBase64, page);
        } catch (e) {
          console.warn(`[legend/upload] page ${page} AI failed:`, (e as Error).message?.slice(0, 300));
          continue;
        }
        for (const s of symbols) {
          await db.query(
            `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT')`,
            [uuidv4(), legendId, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page, s.aliases],
          );
        }
        draft.push(...symbols.map(s => ({ asset_type: s.asset_type, symbol_name: s.symbol_name })));
      }
    } catch (e: unknown) {
      console.warn('[legend/upload] AI parse failed:', (e instanceof Error ? e.message : String(e)).slice(0, 300));
    }

    return NextResponse.json({ id: legendId, name, symbols: draft }, { status: 201, headers: rateLimitHeaders(rl) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend/upload]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
