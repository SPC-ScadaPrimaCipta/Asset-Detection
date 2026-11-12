/**
 * Storage abstraction layer.
 *
 * Current implementation: local filesystem (`STORAGE_PATH` env or `./storage`).
 * Automatically organizes files into clean domain subdirectories:
 * - `documents/`: Uploaded P&ID PDFs & DXFs
 * - `legends/`: Uploaded Legend PDFs
 * - `legends/symbols/`: Extracted Legend symbol crops
 * - `pages/`: Rendered viewer PNGs & DXF SVG page renders
 * - `dataset/`: Training dataset images & annotations
 * - `exports/`: Exported Asset Register Excel files
 *
 * Supports transparent fallback to legacy flat root for existing files.
 *
 * To migrate to S3 or MinIO:
 *   1. Install `@aws-sdk/client-s3` (or `minio`)
 *   2. Implement `StorageProvider` interface below
 *   3. Swap `activeProvider` to your S3/MinIO implementation
 *   4. No other file changes required — all callers use `saveFile` / `getFile` / `deleteFile`
 */

import { writeFile, readFile, unlink, access } from 'fs/promises';
import { constants, existsSync, mkdirSync } from 'fs';
import { join, isAbsolute, resolve, dirname } from 'path';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface StorageProvider {
  save(filename: string, buffer: Buffer): Promise<void>;
  get(filename: string): Promise<Buffer>;
  delete(filename: string): Promise<void>;
  exists(filename: string): Promise<boolean>;
}

// ─── File Categorization Logic ───────────────────────────────────────────────

/**
 * Automatically categorizes flat filenames into clean domain subdirectories.
 * If the filename already includes a directory path, it is left untouched.
 */
export function categorizeFilename(filename: string): string {
  // If already namespaced / categorized, leave as is
  if (filename.includes('/') || filename.includes('\\')) {
    return filename;
  }

  // 1. Legend Symbol crop images: legend-5b722409-...-p1-c08f6d7131ae.png or -p1-0092d981e916.png
  if (/^legend-.*\.png$/i.test(filename)) {
    return join('legends', 'symbols', filename);
  }

  // 2. Legend PDFs: legend-f88f49f7-806d-47f4-89d0-3c5c32e384b2.pdf
  if (/^legend-.*\.pdf$/i.test(filename)) {
    return join('legends', filename);
  }

  // 3. Rendered viewer / svg page caches: viewer-*.png, dxf-svg-*.svg
  if (/^(viewer-|dxf-svg-)/i.test(filename)) {
    return join('pages', filename);
  }

  // 4. Uploaded P&ID Documents (PDF & DXF)
  if (/\.(pdf|dxf)$/i.test(filename)) {
    return join('documents', filename);
  }

  return filename;
}

// ─── Local Filesystem Provider ────────────────────────────────────────────────

const STORAGE_PATH = process.env.STORAGE_PATH
  ? (isAbsolute(process.env.STORAGE_PATH)
      ? process.env.STORAGE_PATH
      : resolve(process.cwd(), process.env.STORAGE_PATH))
  : join(/*turbopackIgnore: true*/ process.cwd(), 'storage');

if (!existsSync(/*turbopackIgnore: true*/ STORAGE_PATH)) {
  mkdirSync(/*turbopackIgnore: true*/ STORAGE_PATH, { recursive: true });
}

// Ensure standard domain directories exist
const STANDARD_DIRS = ['documents', 'legends', join('legends', 'symbols'), 'pages', 'dataset', 'exports', 'debug'];
for (const d of STANDARD_DIRS) {
  const p = join(STORAGE_PATH, d);
  if (!existsSync(/*turbopackIgnore: true*/ p)) {
    mkdirSync(/*turbopackIgnore: true*/ p, { recursive: true });
  }
}

class LocalStorageProvider implements StorageProvider {
  private base: string;

  constructor(basePath: string) {
    this.base = basePath;
  }

  /**
   * Resolves the full path of a file with transparent fallback:
   * 1. Checks if file exists at the exact path requested
   * 2. Checks if file exists in its categorized domain subfolder
   * 3. Checks if file exists in the legacy flat root
   */
  private resolvePath(filename: string): string {
    // 1. Exact raw path in storage
    const raw = join(this.base, filename);
    if (existsSync(raw)) return raw;

    // 2. Categorized path in storage
    const categorized = categorizeFilename(filename);
    const catPath = join(this.base, categorized);
    if (existsSync(catPath)) return catPath;

    // Default to categorized path for new files or error reporting
    return catPath;
  }

  async save(filename: string, buffer: Buffer): Promise<void> {
    const categorized = categorizeFilename(filename);
    const targetPath = join(this.base, categorized);
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await writeFile(/*turbopackIgnore: true*/ targetPath, buffer);
  }

  async get(filename: string): Promise<Buffer> {
    const targetPath = this.resolvePath(filename);
    return readFile(/*turbopackIgnore: true*/ targetPath);
  }

  async delete(filename: string): Promise<void> {
    const catPath = join(this.base, categorizeFilename(filename));
    if (existsSync(catPath)) {
      await unlink(/*turbopackIgnore: true*/ catPath);
    }
    const flatPath = join(this.base, filename);
    if (existsSync(flatPath) && flatPath !== catPath) {
      await unlink(/*turbopackIgnore: true*/ flatPath);
    }
  }

  async exists(filename: string): Promise<boolean> {
    const targetPath = this.resolvePath(filename);
    try {
      await access(/*turbopackIgnore: true*/ targetPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Active provider (swap here to change backend) ────────────────────────────

const activeProvider: StorageProvider = new LocalStorageProvider(STORAGE_PATH);

// ─── Public API ───────────────────────────────────────────────────────────────

export const saveFile = (filename: string, buffer: Buffer): Promise<void> =>
  activeProvider.save(filename, buffer);

export const getFile = (filename: string): Promise<Buffer> =>
  activeProvider.get(filename);

export const deleteFile = (filename: string): Promise<void> =>
  activeProvider.delete(filename);

export const fileExists = (filename: string): Promise<boolean> =>
  activeProvider.exists(filename);
