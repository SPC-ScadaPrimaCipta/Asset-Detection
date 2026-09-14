import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const STORAGE_PATH = process.env.STORAGE_PATH || join(process.cwd(), 'storage');

if (!existsSync(STORAGE_PATH)) {
  mkdirSync(STORAGE_PATH, { recursive: true });
}

export const saveFile = async (filename: string, buffer: Buffer) => {
  await writeFile(join(STORAGE_PATH, filename), buffer);
};

export const getFile = async (filename: string) => {
  return await readFile(join(STORAGE_PATH, filename));
};
