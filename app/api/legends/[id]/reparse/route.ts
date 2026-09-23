import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer, renderPageToPng, extractPdfTextByPage } from '@/lib/pdf-render';
import { extractLegendSymbolsFromPng, extractLegendSymbolsFromOcr } from '@/lib/legend-extract';
import { getAiConfig } from '@/lib/ai-config';

export const maxDuration = 60;
const RENDER_SCALE = 3.5;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const leg = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (leg.rows.length === 0) return NextResponse.json({ error: 'Legend not found' }, { status: 404 });

    let buf: Buffer;
    try { buf = await getFile(`legend-${id}.pdf`) as unknown as Buffer; }
    catch { return NextResponse.json({ error: 'Legend PDF not found in storage. Re-upload to re-parse.' }, { status: 404 }); }

    const cfg = await getAiConfig();
    const useDeepSeek = cfg.provider === 'deepseek';

    const pageCount = await getPdfPageCountFromBuffer(buf);
    await db.query("DELETE FROM legend_symbols WHERE legend_id=$1 AND status='DRAFT'", [id]);

    // Pre-extract OCR for all pages — needed for DeepSeek (no image), and as fallback for Gemini failures
    let ocrPages: string[] = [];
    try {
      ocrPages = await extractPdfTextByPage(buf);
    } catch (e: unknown) {
      console.warn('[legend/reparse] OCR extraction failed (non-fatal):', (e instanceof Error ? e.message : String(e)).slice(0, 200));
    }

    let totalInserted = 0;
    const diagnostics: { page: number; detected: number; method: string; error?: string }[] = [];

    for (let page = 1; page <= pageCount; page++) {
      const pageOcr = ocrPages[page - 1] ?? '';

      if (useDeepSeek) {
        // DeepSeek: text-only reparse via OCR
        if (!pageOcr.trim()) {
          diagnostics.push({ page, detected: 0, method: 'deepseek-ocr', error: 'No OCR text for this page' });
          continue;
        }
        try {
          const symbols = await extractLegendSymbolsFromOcr(pageOcr, page);
          diagnostics.push({ page, detected: symbols.length, method: 'deepseek-ocr' });
          for (const s of symbols) {
            await db.query(
              `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12)`,
              [uuidv4(), id, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.aliases, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page],
            );
            totalInserted++;
          }
        } catch (e: unknown) {
          const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          diagnostics.push({ page, detected: 0, method: 'deepseek-ocr', error: msg });
        }
        continue;
      }

      // Gemini: vision-first, OCR fallback
      let pngBase64: string | null = null;
      try {
        const { png } = await renderPageToPng(buf, page, RENDER_SCALE);
        pngBase64 = png.toString('base64');
      } catch (e: unknown) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        console.warn(`[legend/reparse] page ${page} render failed: ${msg}`);
      }

      if (pngBase64) {
        try {
          const symbols = await extractLegendSymbolsFromPng(pngBase64, page);
          diagnostics.push({ page, detected: symbols.length, method: 'gemini-vision' });
          for (const s of symbols) {
            await db.query(
              `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12)`,
              [uuidv4(), id, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.aliases, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page],
            );
            totalInserted++;
          }
          continue;
        } catch (e: unknown) {
          const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          console.warn(`[legend/reparse] page ${page} Gemini vision failed, trying OCR fallback: ${msg}`);
        }
      }

      // OCR fallback — Gemini render failed or vision AI failed
      if (pageOcr.trim()) {
        try {
          const symbols = await extractLegendSymbolsFromOcr(pageOcr, page);
          diagnostics.push({ page, detected: symbols.length, method: 'gemini-ocr-fallback' });
          for (const s of symbols) {
            await db.query(
              `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12)`,
              [uuidv4(), id, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.aliases, s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page],
            );
            totalInserted++;
          }
        } catch (e: unknown) {
          const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          diagnostics.push({ page, detected: 0, method: 'gemini-ocr-fallback', error: msg });
        }
      } else {
        diagnostics.push({ page, detected: 0, method: 'failed', error: 'Render failed and no OCR text available' });
      }
    }

    return NextResponse.json({ inserted: totalInserted, pages: pageCount, diagnostics });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Re-parse failed', detail: msg.slice(0, 500) }, { status: 500 });
  }
}
