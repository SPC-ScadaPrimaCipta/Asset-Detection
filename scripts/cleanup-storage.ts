/**
 * Storage cleanup utility — removes orphaned files from ./storage that have
 * no corresponding record in the database.
 *
 * Orphans accumulate when:
 * - Upload fails after file write but before DB insert
 * - Document deleted but file not removed
 * - Legend deleted but PDF file not removed
 *
 * Usage:
 *   node -r ts-node/register -r tsconfig-paths/register scripts/cleanup-storage.ts
 *   # or dry-run (list only, no delete):
 *   DRY_RUN=true node -r ts-node/register -r tsconfig-paths/register scripts/cleanup-storage.ts
 */

import { readdir, unlink, stat } from 'fs/promises';
import { join, isAbsolute, resolve } from 'path';
import db from '../lib/db';

const DRY_RUN = process.env.DRY_RUN === 'true';

const STORAGE_PATH = process.env.STORAGE_PATH
  ? (isAbsolute(process.env.STORAGE_PATH)
      ? process.env.STORAGE_PATH
      : resolve(process.cwd(), process.env.STORAGE_PATH))
  : join(process.cwd(), 'storage');

async function main() {
  console.log(`[cleanup] storage path: ${STORAGE_PATH}`);
  console.log(`[cleanup] dry run: ${DRY_RUN}`);

  // Collect all filenames tracked in DB
  const [docRows, legendRows] = await Promise.all([
    db.query<{ file_path: string }>('SELECT file_path FROM documents'),
    db.query<{ file_path: string }>(
      `SELECT CONCAT('legend-', id::text, '.pdf') AS file_path FROM legends`
    ),
  ]);

  const tracked = new Set<string>([
    ...docRows.rows.map((r) => r.file_path),
    ...legendRows.rows.map((r) => r.file_path),
  ]);

  // List all files in storage directory (non-recursive, top level only)
  let files: string[];
  try {
    files = await readdir(STORAGE_PATH);
  } catch (err: unknown) {
    console.error('[cleanup] cannot read storage dir:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let orphanCount = 0;
  let orphanBytes = 0;

  for (const filename of files) {
    // Skip subdirectories and temp/test files
    const fullPath = join(STORAGE_PATH, filename);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }
    if (fileStat.isDirectory()) continue;
    if (filename.startsWith('_test_')) continue; // dev test renders

    if (!tracked.has(filename)) {
      orphanCount++;
      orphanBytes += fileStat.size;
      if (DRY_RUN) {
        console.log(`[cleanup] ORPHAN (would delete): ${filename} (${Math.round(fileStat.size / 1024)}KB)`);
      } else {
        try {
          await unlink(fullPath);
          console.log(`[cleanup] deleted: ${filename} (${Math.round(fileStat.size / 1024)}KB)`);
        } catch (err: unknown) {
          console.warn(`[cleanup] failed to delete ${filename}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  console.log(
    `[cleanup] done. ${orphanCount} orphan(s) found` +
    ` (${Math.round(orphanBytes / 1024)}KB).` +
    (DRY_RUN ? ' DRY RUN — nothing deleted.' : '')
  );

  await db.end();
}

main().catch((err) => {
  console.error('[cleanup] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
