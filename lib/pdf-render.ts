import { PDFDocument } from "pdf-lib";
import { execFile } from "child_process";
import path from "path";
const RENDER_SCRIPT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "scripts/render-page.mjs");

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
 * @param scale      - Render scale factor. 4.0 ≈ 288 dpi (recommended for P&ID detail).
 * @returns { png, width, height }
 */
export async function renderPageToPng(
  buffer: Buffer,
  pageNumber: number,
  scale = 4.0
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

/**
 * Detection V2 — overlapping page tiling (canonical page pixels).
 *
 * Every tile carries full metadata to reconstruct its page-space location:
 * tile coords →(tileToPage)→ page coords →(pageToNormalized)→ 0–1000 → SVG.
 * No independent coordinate system (see lib/detection/geometry/coordinate-transform.ts).
 */
export interface TilePlan {
  /** 0-based tile index in row-major order. */
  index: number;
  /** Tile origin in page pixels. */
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

export interface TileSpec extends TilePlan {
  pageNumber: number;
  overlap: number;
  pageWidth: number;
  pageHeight: number;
  /** Effective DPI = scale * 72 (mupdf default 72 DPI). */
  sourceDpi: number;
}

export interface PageTile extends TileSpec {
  png: Buffer;
}

/**
 * Pure tile-grid planner — no I/O, fully testable.
 *
 * Covers [0, pageWidth] x [0, pageHeight] with tiles of tileSize px and
 * fractional overlap. Edge tiles are shifted (not shrunk) so every tile
 * keeps full tileSize except when the page itself is smaller.
 */
export function computeTileGrid(
  pageWidth: number,
  pageHeight: number,
  tileSize: number,
  overlap: number
): TilePlan[] {
  const step = Math.max(1, Math.round(tileSize * (1 - overlap)));
  const tiles: TilePlan[] = [];
  let index = 0;
  const cols = Math.max(1, Math.ceil((pageWidth - tileSize) / step) + 1);
  const rows = Math.max(1, Math.ceil((pageHeight - tileSize) / step) + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Last tile in each axis snaps to the page edge (overlap grows slightly).
      const tileX = c === cols - 1 ? Math.max(0, pageWidth - tileSize) : c * step;
      const tileY = r === rows - 1 ? Math.max(0, pageHeight - tileSize) : r * step;
      tiles.push({
        index: index++,
        tileX,
        tileY,
        width: Math.min(tileSize, pageWidth - tileX),
        height: Math.min(tileSize, pageHeight - tileY),
      });
    }
  }
  return tiles;
}

/**
 * Render a page once, then slice it into overlapping tiles via mupdf
 * Pixmap pixel copy (same proven pattern as lib/image-crop.ts).
 */
export async function renderPageTiles(
  buffer: Buffer,
  pageNumber: number,
  opts: { scale?: number; tileSize?: number; overlap?: number } = {}
): Promise<{ tiles: PageTile[]; pageWidth: number; pageHeight: number; png: Buffer }> {
  const scale = opts.scale ?? 4.0;
  const tileSize = opts.tileSize ?? 1280;
  const overlap = opts.overlap ?? 0.2;

  const { png, width: pageWidth, height: pageHeight } = await renderPageToPng(
    buffer,
    pageNumber,
    scale
  );

  const mupdf = await import("mupdf" as string);
  const { Image, Pixmap, ColorSpace } = mupdf;
  const srcPm: {
    getWidth(): number;
    getHeight(): number;
    getNumberOfComponents(): number;
    getStride(): number;
    getPixels(): Uint8ClampedArray;
  } = new Image(png).toPixmap();

  const srcW = srcPm.getWidth();
  const srcH = srcPm.getHeight();
  const nComp = srcPm.getNumberOfComponents();
  const srcStride = srcPm.getStride();
  const srcPixels = srcPm.getPixels();

  const plans = computeTileGrid(srcW, srcH, tileSize, overlap);
  const tiles: PageTile[] = [];
  for (const p of plans) {    const cropPm: {
      getStride(): number;
      getPixels(): Uint8ClampedArray;
      asPNG(): Uint8Array;
    } = new Pixmap(ColorSpace.DeviceRGB, [0, 0, p.width, p.height], false);
    const cropPixels = cropPm.getPixels();
    const dstStride = cropPm.getStride();
    for (let row = 0; row < p.height; row++) {
      const srcOff = (p.tileY + row) * srcStride + p.tileX * nComp;
      const dstOff = row * dstStride;
      for (let col = 0; col < p.width * nComp; col++) {
        cropPixels[dstOff + col] = srcPixels[srcOff + col];
      }
    }
    tiles.push({
      ...p,
      pageNumber,
      overlap,
      pageWidth: srcW,
      pageHeight: srcH,
      sourceDpi: Math.round(scale * 72),
      png: Buffer.from(cropPm.asPNG()),
    });
  }
  return { tiles, pageWidth, pageHeight, png };
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
        pages.push(structured.asText().slice(0, 12000));
      } catch {
        pages.push("");
      }
    }
    return pages;
  } catch {
    return [""];
  }
}
