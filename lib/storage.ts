import { writeFile, readFile } from 'fs/promises';
import { join, isAbsolute, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

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

export const saveFile = async (filename: string, buffer: Buffer) => {
  const filepath = join(STORAGE_PATH, filename);
  await writeFile(/*turbopackIgnore: true*/ filepath, buffer);
};

export const getFile = async (filename: string) => {
  const filepath = join(STORAGE_PATH, filename);
  return await readFile(/*turbopackIgnore: true*/ filepath);
};
