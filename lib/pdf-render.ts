import { PDFDocument } from "pdf-lib";
import { execFile } from "child_process";
import path from "path";
import { env } from "./env";
const RENDER_SCRIPT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "scripts/render-page.mjs");

const ALLOWED_MIME = ["application/pdf"];

export function validatePdfFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type) && !file.name.toLowerCase().endsWith(".pdf"))
    return "Only PDF files are allowed";
  if (file.size === 0) return "Empty file";
  const maxBytes = env.UPLOAD_MAX_PDF_MB * 1024 * 1024;
  if (file.size > maxBytes) return `File too large (max ${env.UPLOAD_MAX_PDF_MB}MB)`;
  return null;
}

export async function getPdfPageCountFromBuffer(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer as unknown as Uint8Array, { ignoreEncryption: true });
  const n = doc.getPageCount();
  if (n === 0) throw new Error("Empty PDF: 0 pages");
  return n;
}

/**
 * Render a single PDF page to PNG using mupdf in-process.
 *
 * Previously used child_process.execFile per page (spawn Node.js subprocess + stdin/stdout
 * base64 serialization = ~300-500ms overhead per page). Now calls mupdf directly in the
 * worker process — eliminates subprocess spawn cost entirely.
 *
 * Falls back to child_process if direct mupdf import fails (e.g. platform mismatch).
 *
 * @param buffer     - Full PDF buffer
 * @param pageNumber - 1-based page number
 * @param scale      - Render scale factor. 3.0 ≈ 216 dpi (see
 *                     lib/detection/config.ts — the detection pipeline default).
 * @returns { png, width, height }
 */
export async function renderPageToPng(
  buffer: Buffer,
  pageNumber: number,
  scale = 3.0
): Promise<{ png: Buffer; width: number; height: number }> {
  try {
    // Direct in-process mupdf — no subprocess spawn overhead
    const mupdf = await import("mupdf" as string);
    const { Document, Matrix, ColorSpace } = mupdf;

    const doc = Document.openDocument(buffer, "application/pdf");
    const pageCount = doc.countPages();

    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page ${pageNumber} out of range (${pageCount} pages)`);
    }

    const page = doc.loadPage(pageNumber - 1);
    const matrix = Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(matrix, ColorSpace.DeviceRGB, false);
    const png = Buffer.from(pixmap.asPNG());

    return { png, width: pixmap.getWidth(), height: pixmap.getHeight() };
  } catch (inProcessErr) {
    // Fallback: child_process (preserves backward compat if direct import fails)
    const errMsg = inProcessErr instanceof Error ? inProcessErr.message : String(inProcessErr);
    // Re-throw range errors immediately — no point falling back
    if (errMsg.includes('out of range')) throw inProcessErr;

    console.warn(`[pdf-render] direct mupdf failed, falling back to subprocess: ${errMsg.slice(0, 200)}`);

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
}
