/**
 * One-off repair (Stage 3.5 bugfix verification): generate missing reference
 * crops for symbols that have bboxes but no reference_image_url.
 * Uses the SAME shared helper as upload/reparse. Idempotent — skips rows
 * that already have crops. Never deletes anything.
 * Usage: npx tsx --env-file=.env.local scripts/legend-backfill-crops.ts [legendId]
 */
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { renderPageToPng, getPdfPageCountFromBuffer } from '@/lib/pdf-render';
import { cropAndSaveSymbol } from '@/lib/legend-crop';

async function main() {
  const legendId = process.argv[2] ?? '4cf08173-c7e9-4b80-9107-ff7a5041cc04';
  const pdf = (await getFile(`legend-${legendId}.pdf`)) as unknown as Buffer;
  const pageCount = await getPdfPageCountFromBuffer(pdf);
  const rows = (
    await db.query(
      `SELECT id, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, symbol_name
       FROM legend_symbols WHERE legend_id=$1 AND reference_image_url IS NULL`,
      [legendId]
    )
  ).rows as Record<string, unknown>[];
  console.log(`cropless rows: ${rows.length}, pages: ${pageCount}`);

  const renders = new Map<number, { b64: string; w: number; h: number }>();
  let fixed = 0;
  let failed = 0;
  for (const s of rows) {
    const page = Number(s.pid_page ?? 1);
    if (!renders.has(page)) {
      try {
        const r = await renderPageToPng(pdf, page, 4.0);
        renders.set(page, { b64: r.png.toString('base64'), w: r.width, h: r.height });
      } catch (e) {
        console.warn(`page ${page} render failed:`, (e as Error).message?.slice(0, 120));
        continue;
      }
    }
    const r = renders.get(page)!;
    const { refUrl, refHash } = await cropAndSaveSymbol(
      r.b64,
      { x: s.bbox_x as number, y: s.bbox_y as number, width: s.bbox_w as number, height: s.bbox_h as number },
      r.w, r.h, legendId, page, 0.05
    );
    if (refUrl) {
      await db.query(
        'UPDATE legend_symbols SET reference_image_url=$1, reference_crop_hash=$2, updated_at=NOW() WHERE id=$3',
        [refUrl, refHash, s.id]
      );
      fixed++;
    } else {
      failed++;
      console.warn(`crop failed for ${(s.symbol_name as string) ?? s.id}`);
    }
  }
  console.log(`fixed: ${fixed}, failed: ${failed}`);
  await db.end();
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
