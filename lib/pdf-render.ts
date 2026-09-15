import { PDFDocument } from "pdf-lib";

const MAX_PDF_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME = ["application/pdf"];

export function validatePdfFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type) && !file.name.toLowerCase().endsWith(".pdf"))
    return "Only PDF files are allowed";
  if (file.size === 0) return "Empty file";
  if (file.size > MAX_PDF_SIZE) return "File too large (max 50MB)";
  return null;
}

export async function getPdfPageCountFromBuffer(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer as unknown as Uint8Array, { ignoreEncryption: true });
  const n = doc.getPageCount();
  if (n === 0) throw new Error("Empty PDF: 0 pages");
  return n;
}

/**
 * Render a single PDF page to PNG using mupdf.
 *
 * @param buffer  - Full PDF buffer
 * @param pageNumber - 1-based page number
 * @param scale  - Render scale factor. 3.0 ≈ 216 dpi (recommended for P&ID detail).
 *                 Higher = better symbol recognition, larger PNG.
 * @returns PNG as Buffer
 */
export async function renderPageToPng(
  buffer: Buffer,
  pageNumber: number,
  scale = 3.0
): Promise<Buffer> {
  // Dynamic import — mupdf is ESM with top-level await, must use import()
  const mupdf = await import("mupdf");
  const { Document, Matrix } = mupdf;

  const doc = Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new Error(`Page ${pageNumber} out of range (document has ${pageCount} pages)`);
  }

  const page = doc.loadPage(pageNumber - 1); // mupdf is 0-indexed
  const matrix = Matrix.scale(scale, scale);
  // DeviceRGB = standard RGB, no alpha channel needed
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const png = pixmap.asPNG();

  // mupdf returns Uint8Array — convert to Node Buffer
  return Buffer.from(png);
}

/**
 * Lightweight text extraction for DeepSeek path (no native deps).
 * Uses pdf-lib raw content scan — best-effort, Gemini path does not need this.
 */
export async function extractPdfTextByPage(buffer: Buffer): Promise<string[]> {
  try {
    const doc = await PDFDocument.load(buffer as unknown as Uint8Array, { ignoreEncryption: true });
    const pages: string[] = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      try {
        const page = doc.getPage(i);
        const contents: unknown = (page as unknown as Record<string, unknown>).contents;
        pages.push(contents ? String(contents).slice(0, 4000) : "");
      } catch {
        pages.push("");
      }
    }
    return pages;
  } catch {
    return [""];
  }
}
