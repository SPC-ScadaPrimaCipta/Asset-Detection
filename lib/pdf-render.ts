import { PDFDocument } from "pdf-lib";

const MAX_PDF_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME = ["application/pdf"];

export function validatePdfFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type) && !file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files are allowed";
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

// ponytail: replace with mupdf WASM render (2048px) when high-res page images needed for Gemini Vision.
// MVP sends PDF bytes directly to Gemini which accepts application/pdf — no PNG conversion required.
export async function renderPagePlaceholder(buffer: Buffer): Promise<string> {
  return buffer.toString("base64").slice(0, 120000);
}

// Lightweight text extraction for DeepSeek path (no native deps).
// Uses pdf-lib raw content scan — best-effort, Gemini path does not need this.
export async function extractPdfTextByPage(buffer: Buffer): Promise<string[]> {
  try {
    const doc = await PDFDocument.load(buffer as unknown as Uint8Array, { ignoreEncryption: true });
    const pages: string[] = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      try {
        const page = doc.getPage(i);
        const contents: any = (page as any).contents;
        pages.push(contents ? String(contents).slice(0, 4000) : "");
      } catch { pages.push(""); }
    }
    return pages;
  } catch { return [""]; }
}
