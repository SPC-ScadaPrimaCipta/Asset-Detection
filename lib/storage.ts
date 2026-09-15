import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const STORAGE_PATH = join(process.env.STORAGE_PATH ?? /*turbopackIgnore: true*/ process.cwd(), 'storage');

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
