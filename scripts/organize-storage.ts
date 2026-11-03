/**
 * Migration & Cleanup Script: Organize Local Storage
 *
 * Sorts flat legacy files in `storage/` into neat domain subdirectories:
 * - `storage/documents/` (P&ID PDFs & DXFs)
 * - `storage/legends/` (Legend master PDFs)
 * - `storage/legends/symbols/` (Legend symbol crops)
 * - `storage/pages/` (Rendered page viewer images & DXF SVGs)
 * - `storage/debug/` (One-off test & evaluation artifacts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { categorizeFilename } from '../lib/storage';

const STORAGE_PATH = process.env.STORAGE_PATH
  ? (path.isAbsolute(process.env.STORAGE_PATH)
      ? process.env.STORAGE_PATH
      : path.resolve(process.cwd(), process.env.STORAGE_PATH))
  : path.resolve(process.cwd(), 'storage');

console.log(`[storage-organize] Target storage directory: ${STORAGE_PATH}`);

if (!fs.existsSync(STORAGE_PATH)) {
  console.log('[storage-organize] Storage directory does not exist. Exiting.');
  process.exit(0);
}

const entries = fs.readdirSync(STORAGE_PATH, { withFileTypes: true });
const stats = {
  legendSymbols: 0,
  legendPdfs: 0,
  documents: 0,
  pages: 0,
  debugTest: 0,
  skippedDirs: 0,
  untouchedFiles: 0,
};

for (const entry of entries) {
  if (entry.isDirectory()) {
    stats.skippedDirs++;
    // Clean up accidental empty double-nested storage/storage if present
    if (entry.name === 'storage') {
      try {
        const nested = path.join(STORAGE_PATH, 'storage');
        const nestedFiles = fs.readdirSync(nested);
        if (nestedFiles.length === 0) {
          fs.rmdirSync(nested);
          console.log('[storage-organize] Removed empty double-nested storage/storage directory');
        }
      } catch { /* ignore */ }
    }
    continue;
  }

  const filename = entry.name;
  const srcPath = path.join(STORAGE_PATH, filename);

  // 1. Check domain categorization
  const catPath = categorizeFilename(filename);
  if (catPath !== filename) {
    const destPath = path.join(STORAGE_PATH, catPath);
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.renameSync(srcPath, destPath);

    if (catPath.startsWith('legends' + path.sep + 'symbols')) {
      stats.legendSymbols++;
    } else if (catPath.startsWith('legends')) {
      stats.legendPdfs++;
    } else if (catPath.startsWith('documents')) {
      stats.documents++;
    } else if (catPath.startsWith('pages')) {
      stats.pages++;
    }
    continue;
  }

  // 2. Debug & test artifacts -> move to storage/debug/
  const isDebugOrTest = /^(debug-|test-|test_|eval-|yolo-)/i.test(filename);
  if (isDebugOrTest) {
    const debugDir = path.join(STORAGE_PATH, 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    fs.renameSync(srcPath, path.join(debugDir, filename));
    stats.debugTest++;
    continue;
  }

  stats.untouchedFiles++;
}

console.log('\n[storage-organize] Organization completed successfully!');
console.table({
  'Legend Symbol Crops (-> storage/legends/symbols/)': stats.legendSymbols,
  'Legend Master PDFs (-> storage/legends/)': stats.legendPdfs,
  'P&ID Documents (-> storage/documents/)': stats.documents,
  'Viewer Page Renders (-> storage/pages/)': stats.pages,
  'Debug & Test Files (-> storage/debug/)': stats.debugTest,
  'Existing Subdirectories Preserved': stats.skippedDirs,
  'Other Untouched Files': stats.untouchedFiles,
});

