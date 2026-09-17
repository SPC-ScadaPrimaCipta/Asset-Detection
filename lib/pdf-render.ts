import { PDFDocument } from "pdf-lib";
import { execFile } from "child_process";
import path from "path";
const RENDER_SCRIPT = path.resolve(process.cwd(), "scripts/render-page.mjs");

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
 * Render a single PDF page to PNG using mupdf (via ESM child process).
 *
 * @param buffer     - Full PDF buffer
 * @param pageNumber - 1-based page number
 * @param scale      - Render scale factor. 4.0 ≈ 288 dpi (recommended for P&ID detail).
 * @returns { png, width, height }
 */
export async function renderPageToPng(
  buffer: Buffer,
  pageNumber: number,
  scale = 4.0
): Promise<{ png: Buffer; width: number; height: number }> {
  const payload = JSON.stringify({
    pdf: buffer.toString("base64"),
    page: pageNumber,
    scale,
  });

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile("node", [RENDER_SCRIPT], { maxBuffer: 100 * 1024 * 1024 });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0 && !out) reject(new Error(`render-page exited ${code}: ${err}`));
      else resolve(out);
    });
    child.stdin?.write(payload);
    child.stdin?.end();
  });

  const result = JSON.parse(stdout) as { png: string; width: number; height: number; error?: string };
  if (result.error) throw new Error(result.error);
  return { png: Buffer.from(result.png, "base64"), width: result.width, height: result.height };
}

/**
 * Extract plain text per page using mupdf's built-in text extraction (via ESM child process).
 */
export async function extractPdfTextByPage(buffer: Buffer): Promise<string[]> {
  try {
    const mupdf = await import("mupdf" as any);
    const { Document } = mupdf;
    const doc = Document.openDocument(buffer, "application/pdf");
    const pageCount = doc.countPages();
    const pages: string[] = [];
    for (let i = 0; i < pageCount; i++) {
      try {
        const page = doc.loadPage(i);
        const structured = page.toStructuredText("preserve-whitespace");
        pages.push(structured.asText().slice(0, 4000));
      } catch {
        pages.push("");
      }
    }
    return pages;
  } catch {
    return [""];
  }
}
