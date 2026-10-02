/**
 * Storage abstraction layer.
 *
 * Current implementation: local filesystem (`STORAGE_PATH` env or `./storage`).
 *
 * To migrate to S3 or MinIO:
 *   1. Install `@aws-sdk/client-s3` (or `minio`)
 *   2. Implement `StorageProvider` interface below
 *   3. Swap `activeProvider` to your S3/MinIO implementation
 *   4. No other file changes required — all callers use `saveFile` / `getFile` / `deleteFile`
 *
 * Example future providers:
 *   - `S3StorageProvider`   — AWS S3 via @aws-sdk/client-s3
 *   - `MinIOStorageProvider` — MinIO compatible S3 API
 */

import { writeFile, readFile, unlink, access } from 'fs/promises';
import { constants } from 'fs';
import { join, isAbsolute, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface StorageProvider {
  save(filename: string, buffer: Buffer): Promise<void>;
  get(filename: string): Promise<Buffer>;
  delete(filename: string): Promise<void>;
  exists(filename: string): Promise<boolean>;
}

// ─── Local Filesystem Provider ────────────────────────────────────────────────

// If STORAGE_PATH is set in env, use it directly (already the full path).
// If not set, default to <cwd>/storage.
// Do NOT append 'storage' again — that causes double-nesting (storage/storage/).
const STORAGE_PATH = process.env.STORAGE_PATH
  ? (isAbsolute(process.env.STORAGE_PATH)
      ? process.env.STORAGE_PATH
      : resolve(process.cwd(), process.env.STORAGE_PATH))
  : join(/*turbopackIgnore: true*/ process.cwd(), 'storage');

if (!existsSync(/*turbopackIgnore: true*/ STORAGE_PATH)) {
  mkdirSync(/*turbopackIgnore: true*/ STORAGE_PATH, { recursive: true });
}

class LocalStorageProvider implements StorageProvider {
  private base: string;

  constructor(basePath: string) {
    this.base = basePath;
  }

  private path(filename: string): string {
    return join(this.base, filename);
  }

  async save(filename: string, buffer: Buffer): Promise<void> {
    await writeFile(/*turbopackIgnore: true*/ this.path(filename), buffer);
  }

  async get(filename: string): Promise<Buffer> {
    return readFile(/*turbopackIgnore: true*/ this.path(filename));
  }

  async delete(filename: string): Promise<void> {
    await unlink(/*turbopackIgnore: true*/ this.path(filename));
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await access(/*turbopackIgnore: true*/ this.path(filename), constants.F_OK);
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
