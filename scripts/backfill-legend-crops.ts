/**
 * Backfill reference_image_url untuk legend_symbols yang belum punya crop gambar.
 *
 * Dua jalur:
 *   1. CV service tersedia → /legend/extract dari legend PDF (akurat, pakai OCR + visual)
 *   2. CV service tidak tersedia → crop langsung dari bbox_x/y/w/h di DB (fast fallback)
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

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/asset_detection';
const CV_URL = process.env.CV_SERVICE_URL ?? 'http://localhost:8000';
const STORAGE_PATH = process.env.STORAGE_PATH ?? join(process.cwd(), 'storage');

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

async function cvHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`${CV_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── Path 1: CV service extract ─────────────────────────────────────────────

async function backfillViaCvService(
  pool: Pool,
  legendId: string,
  log: (m: string) => void
): Promise<number> {
  // Baca PDF
  const pdfName = `legend-${legendId}.pdf`;
  let pdfBuf: Buffer;
  try {
    pdfBuf = await readFile(join(STORAGE_PATH, pdfName));
  } catch {
    log(`  [SKIP] PDF ${pdfName} tidak ditemukan di storage`);
    return 0;
  }

  // Render page 1 (most legends are single page)
  const { renderPageToPng } = await import('../lib/pdf-render');
  const { png, width, height } = await renderPageToPng(pdfBuf, 1, 4.0);
  const pngB64 = png.toString('base64');

  log(`  Rendered PDF page 1: ${width}×${height}px`);

  // Kirim ke CV service /legend/extract
  const res = await fetch(`${CV_URL}/legend/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      legendId,
      pages: [{ pageNumber: 1, pngBase64: pngB64 }],
      pdfSha256: hashBuf(pdfBuf),
      renderDpi: 288,
      ocrProvider: 'tesseract',
      minAssocScore: 0.25,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    log(`  [WARN] CV /legend/extract responded ${res.status}`);
    return 0;
  }

  const data = await res.json() as {
    definitions: Array<{
      symbolId: string;
      label: string;
      aliases?: string[];
      symbol?: { rawCropPath?: string; normalizedCropPath?: string };
      variants?: Array<{ normalizedPng?: string }>;
    }>;
  };

  log(`  CV extract: ${data.definitions.length} definisi ditemukan`);

  // Ambil simbol dari DB untuk matching label → id
  const symRows = (await pool.query(
    `SELECT id, symbol_name, asset_type FROM legend_symbols WHERE legend_id=$1 AND status='ACTIVE'`,
    [legendId]
  )).rows as Array<{ id: string; symbol_name: string | null; asset_type: string }>;

  // Normalize helper
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  let saved = 0;
  for (const def of data.definitions) {
    // Match ke DB symbol by label
    const defLabel = norm(def.label);
    const match = symRows.find(
      s => norm(s.symbol_name ?? s.asset_type) === defLabel ||
           (def.aliases ?? []).some(a => norm(a) === norm(s.symbol_name ?? s.asset_type))
    );
    if (!match) {
      log(`  [SKIP] Tidak ada simbol di DB cocok dengan label "${def.label}"`);
      continue;
    }

    // Ambil crop PNG dari variant pertama
    const cropB64 = def.variants?.[0]?.normalizedPng;
    if (!cropB64) {
      log(`  [SKIP] Definisi "${def.label}" tidak punya normalizedPng`);
      continue;
    }

    const cropBuf = Buffer.from(cropB64, 'base64');
    const h = hashBuf(cropBuf).slice(0, 12);
    const fname = `legend-${legendId}-sym-${h}.png`;

    await saveFile(fname, cropBuf);
    await pool.query(
      `UPDATE legend_symbols SET reference_image_url=$1, reference_crop_hash=$2, updated_at=NOW()
       WHERE id=$3`,
      [fname, hashBuf(cropBuf), match.id]
    );
    saved++;
    log(`  ✓ ${match.symbol_name ?? match.asset_type} → ${fname}`);
  }

  return saved;
}

// ─── Path 2: Fallback crop dari bbox di DB ───────────────────────────────────

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
      rendered = await renderPageToPng(pdfBuf, pageNum, 4.0);
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
  console.log(`Legends: ${legendRows.length}, force: ${forceAll}`);

  const cvOk = await cvHealthy();
  console.log(`CV service (${CV_URL}): ${cvOk ? '✓ online' : '✗ offline — akan pakai bbox fallback'}\n`);

  let totalSaved = 0;
  for (const leg of legendRows) {
    console.log(`\nLegend: ${leg.name} (${leg.id})`);
    const log = (m: string) => console.log(m);

    let saved = 0;
    if (cvOk) {
      saved = await backfillViaCvService(pool, leg.id, log).catch(e => {
        log(`  [ERR] CV path gagal: ${(e as Error).message} — fallback ke bbox`);
        return 0;
      });
    }

    // Jika CV tidak jalan atau hasilnya sedikit, fallback ke bbox crop
    if (saved === 0) {
      saved = await backfillFromBbox(pool, leg.id, forceAll, log);
    }

    console.log(`  → Saved: ${saved} crops`);
    totalSaved += saved;
  }

  console.log(`\n=== Total: ${totalSaved} crops disimpan ===\n`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
