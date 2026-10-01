/**
 * Backfill reference_image_url untuk legend_symbols yang belum punya crop gambar.
 *
 * Crop diambil langsung dari bbox_x/y/w/h yang tersimpan di DB (hasil Scan Legend),
 * lalu disimpan ke storage sebagai reference few-shot untuk detection.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-legend-crops.ts
 *   npx tsx --env-file=.env.local scripts/backfill-legend-crops.ts --legend-id <id>
 *   npx tsx --env-file=.env.local scripts/backfill-legend-crops.ts --force   (re-generate semua)
 */

import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { env } from '../lib/env';
import { getTuning } from '../lib/tuning';

// DATABASE_URL and STORAGE_PATH come from the app's env loader, so a script can
// never silently talk to a different database than the running app (which is how
// a hardcoded port 5433 previously diverged from the app's 5432).
const DB_URL = env.DATABASE_URL;
const STORAGE_PATH = env.STORAGE_PATH;
const renderScale = await getTuning().then((t) => t.performance.legendRenderScale);

const args = process.argv.slice(2);
const legendArg = args.indexOf('--legend-id') !== -1 ? args[args.indexOf('--legend-id') + 1] : null;
const forceAll = args.includes('--force');

// ─── helpers ───────────────────────────────────────────────────────────────

function hashBuf(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex');
}

async function saveFile(name: string, buf: Buffer) {
  const { writeFile, mkdir } = await import('fs/promises');
  await mkdir(STORAGE_PATH, { recursive: true });
  await writeFile(join(STORAGE_PATH, name), buf);
}

async function backfillFromBbox(
  pool: Pool,
  legendId: string,
  force: boolean,
  log: (m: string) => void
): Promise<number> {
  const whereExtra = force ? '' : 'AND ls.reference_image_url IS NULL';
  const symRows = (await pool.query(
    `SELECT ls.id, ls.legend_id, ls.symbol_name, ls.asset_type,
            ls.bbox_x, ls.bbox_y, ls.bbox_w, ls.bbox_h, ls.pid_page
     FROM legend_symbols ls
     WHERE ls.legend_id=$1 AND ls.status='ACTIVE'
       AND ls.bbox_x IS NOT NULL AND ls.bbox_w IS NOT NULL
       ${whereExtra}`,
    [legendId]
  )).rows;

  if (symRows.length === 0) {
    log(`  [SKIP] Tidak ada simbol dengan bbox di legend ${legendId}`);
    return 0;
  }

  log(`  ${symRows.length} simbol punya bbox — cropping dari PDF`);

  const pdfName = `legend-${legendId}.pdf`;
  let pdfBuf: Buffer;
  try {
    pdfBuf = await readFile(join(STORAGE_PATH, pdfName));
  } catch {
    log(`  [SKIP] PDF ${pdfName} tidak ditemukan`);
    return 0;
  }

  const { renderPageToPng } = await import('../lib/pdf-render');
  const { cropPageRegion } = await import('../lib/image-crop');

  // Group by page
  const byPage = new Map<number, typeof symRows>();
  for (const s of symRows) {
    const p = s.pid_page ?? 1;
    if (!byPage.has(p)) byPage.set(p, []);
    byPage.get(p)!.push(s);
  }

  let saved = 0;
  for (const [pageNum, group] of byPage) {
    let rendered: Awaited<ReturnType<typeof renderPageToPng>>;
    try {
      rendered = await renderPageToPng(pdfBuf, pageNum, renderScale);
    } catch (e) {
      log(`  [ERR] Render page ${pageNum}: ${(e as Error).message}`);
      continue;
    }

    const pngB64 = rendered.png.toString('base64');
    for (const s of group) {
      try {
        const crop = await cropPageRegion(
          pngB64,
          { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
          rendered.width, rendered.height, 0.05
        );
        if (!crop) continue;

        const cropBuf = Buffer.from(crop, 'base64');
        const h = hashBuf(cropBuf).slice(0, 12);
        const fname = `legend-${s.legend_id}-p${pageNum}-${h}.png`;
        await saveFile(fname, cropBuf);
        await pool.query(
          `UPDATE legend_symbols SET reference_image_url=$1, reference_crop_hash=$2, updated_at=NOW()
           WHERE id=$3`,
          [fname, hashBuf(cropBuf), s.id]
        );
        saved++;
        log(`  ✓ ${s.symbol_name ?? s.asset_type} → ${fname}`);
      } catch (e) {
        log(`  [WARN] Simbol ${s.id}: ${(e as Error).message?.slice(0, 100)}`);
      }
    }
  }
  return saved;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DB_URL });

  // Pastikan kolom ada
  await pool.query(`ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS reference_image_url TEXT`);
  await pool.query(`ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS reference_crop_hash TEXT`);

  // Ambil legend yang perlu diproses
  const legendWhere = legendArg ? 'WHERE id=$1' : '';
  const legendRows = (await pool.query(
    `SELECT id, name FROM legends ${legendWhere}`,
    legendArg ? [legendArg] : []
  )).rows as Array<{ id: string; name: string }>;

  console.log(`\n=== Backfill Legend Crops ===`);
  console.log(`Legends: ${legendRows.length}, force: ${forceAll}\n`);

  let totalSaved = 0;
  for (const leg of legendRows) {
    console.log(`\nLegend: ${leg.name} (${leg.id})`);
    const log = (m: string) => console.log(m);

    const saved = await backfillFromBbox(pool, leg.id, forceAll, log);

    console.log(`  → Saved: ${saved} crops`);
    totalSaved += saved;
  }

  console.log(`\n=== Total: ${totalSaved} crops disimpan ===\n`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
