/**
 * Backfill reference images for existing legend_symbols.
 * Renders legend PDFs at 4.0 scale, crops each symbol bbox, saves PNG to storage,
 * and fills reference_image_url + reference_crop_hash.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-reference-images.ts [--legend-id <id>]
 */
import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { env } from '../lib/env';
import { getTuning } from '../lib/tuning';

// Use the app's env loader and legend render scale so a backfill produces crops
// at the same resolution as the live Scan Legend flow.
const connStr = env.DATABASE_URL;
const storageRoot = env.STORAGE_PATH;
const renderScale = await getTuning().then((t) => t.performance.legendRenderScale);

async function main() {
  const args = process.argv.slice(2);
  const legendIdx = args.indexOf('--legend-id');
  const onlyLegend = legendIdx !== -1 ? args[legendIdx + 1] : null;

  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS reference_image_url TEXT`);
    await pool.query(`ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS reference_crop_hash TEXT`);

    const symRows = (await pool.query(
      `SELECT ls.id, ls.legend_id, ls.bbox_x, ls.bbox_y, ls.bbox_w, ls.bbox_h, ls.pid_page
       FROM legend_symbols ls
       JOIN legends l ON l.id = ls.legend_id
       WHERE ls.reference_image_url IS NULL
         AND ls.bbox_x IS NOT NULL AND ls.bbox_w IS NOT NULL
         ${onlyLegend ? 'AND ls.legend_id = $1' : ''}
       LIMIT 500`,
      onlyLegend ? [onlyLegend] : []
    )).rows;
    console.log(`Symbols needing backfill: ${symRows.length}`);
    if (symRows.length === 0) return;

    const { renderPageToPng } = await import('../lib/pdf-render');
    const { cropPageRegion } = await import('../lib/image-crop');
    const { hashImage } = await import('../lib/symbol-cache');
    const { saveFile } = await import('../lib/storage');

    // Group by legend_id+page to render each page once
    const byPage = new Map<string, typeof symRows>();
    for (const s of symRows) {
      const k = `${s.legend_id}:p${s.pid_page ?? 1}`;
      if (!byPage.has(k)) byPage.set(k, []);
      byPage.get(k)!.push(s);
    }

    let done = 0;
    for (const [key, group] of byPage) {
      const [legendId, pStr] = key.split(':p');
      const page = parseInt(pStr, 10) || 1;
      try {
        const legRow = (await pool.query(`SELECT id FROM legends WHERE id=$1`, [legendId])).rows[0];
        if (!legRow) continue;
        // Legend PDF stored as legend-<id>.pdf (see upload route)
        const pdfName = `legend-${legendId}.pdf`;
        let pdfBuf: Buffer;
        try {
          const storagePath = storageRoot;
          pdfBuf = await readFile(join(storagePath, pdfName));
        } catch {
          console.warn(`skip ${key}: PDF not found (${pdfName})`);
          continue;
        }
        const rendered = await renderPageToPng(pdfBuf, page, renderScale);
        const b64 = rendered.png.toString('base64');
        for (const s of group) {
          try {
            const crop = await cropPageRegion(
              b64,
              { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
              rendered.width, rendered.height, 0.05
            );
            if (!crop) continue;
            const h = hashImage(crop);
            const refName = `legend-${legendId}-p${page}-${h.slice(0, 12)}.png`;
            await saveFile(refName, Buffer.from(crop, 'base64'));
            await pool.query(
              `UPDATE legend_symbols SET reference_image_url=$1, reference_crop_hash=$2 WHERE id=$3`,
              [refName, h, s.id]
            );
            done++;
          } catch (e) {
            console.warn(`symbol ${s.id} failed:`, (e as Error).message?.slice(0, 120));
          }
        }
      } catch (e) {
        console.warn(`page ${key} failed:`, (e as Error).message?.slice(0, 150));
      }
    }
    console.log(`Backfilled ${done}/${symRows.length} symbols.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
