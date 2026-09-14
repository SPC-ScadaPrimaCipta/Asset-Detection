import { PDFDocument } from 'pdf-lib';
import { readFile } from 'fs/promises';

export const getPdfPageCount = async (path: string) => {
  const buffer = await readFile(path);
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
};
