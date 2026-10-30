import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

let sharedWorkerPromise: Promise<any> | null = null;

async function getWorker(): Promise<any> {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = createWorker('eng');
  }
  return sharedWorkerPromise;
}

function clampExtractRegion(
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(imgW - 1, Math.round(x)));
  const top = Math.max(0, Math.min(imgH - 1, Math.round(y)));
  const width = Math.max(1, Math.min(imgW - left, Math.round(w)));
  const height = Math.max(1, Math.min(imgH - top, Math.round(h)));
  return { left, top, width, height };
}

export async function extractTextFromRegion(imageBuffer: Buffer, bbox: { left: number, top: number, width: number, height: number }): Promise<string> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 100000;
  const imgH = meta.height ?? 100000;
  const rect = clampExtractRegion(imgW, imgH, bbox.left, bbox.top, bbox.width, bbox.height);

  const processed = await sharp(imageBuffer)
    .extract(rect)
    .greyscale()
    .threshold(128)
    .toBuffer();

  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(processed);
  return text.trim();
}

export async function cropBBoxFromBuffer(buffer: Buffer, bbox: { x: number, y: number, width: number, height: number }, padding: number): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 100000;
  const imgH = meta.height ?? 100000;
  const rect = clampExtractRegion(
    imgW,
    imgH,
    bbox.x - padding,
    bbox.y - padding,
    bbox.width + padding * 2,
    bbox.height + padding * 2,
  );

  return sharp(buffer)
    .extract(rect)
    .toBuffer();
}

export async function cropAdaptiveTagRegionFromBuffer(buffer: Buffer, symbolBbox: { x: number, y: number, width: number, height: number }, config: { expandX: number, expandY: number }): Promise<{ buffer: Buffer }> {
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 100000;
  const imgH = meta.height ?? 100000;
  const rect = clampExtractRegion(
    imgW,
    imgH,
    symbolBbox.x - config.expandX,
    symbolBbox.y - config.expandY,
    symbolBbox.width + config.expandX * 2,
    symbolBbox.height + config.expandY * 2,
  );

  const buf = await sharp(buffer)
    .extract(rect)
    .toBuffer();
  return { buffer: buf };
}

export function calculateAdaptiveTagBBox(
  symbolBbox: { x: number; y: number; width: number; height: number },
  pageW: number,
  pageH: number,
  config: { expandX: number; expandY: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, symbolBbox.x - config.expandX);
  const y = Math.max(0, symbolBbox.y - config.expandY);
  const right = Math.min(pageW, symbolBbox.x + symbolBbox.width + config.expandX);
  const bottom = Math.min(pageH, symbolBbox.y + symbolBbox.height + config.expandY);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function extractBestTagFromText(text: string): string | null {
  if (!text) return null;
  const tokens = text.match(/\b[A-Z]{1,6}-\d+[A-Z0-9]*\b/g);
  if (!tokens || tokens.length === 0) return null;
  const isPipeSpec = (t: string) => /^(CS|SS|AS|FS|IS)-\d+$/i.test(t);
  const candidate = tokens.find(t => !isPipeSpec(t));
  return candidate ?? tokens[0];
}

export async function runTagOcr(buffer: Buffer): Promise<{ rawText: string, normalizedText: string, confidence: number, isTag: boolean }> {
  const worker = await getWorker();
  const { data: { text, confidence } } = await worker.recognize(buffer);
  const trimmed = text.trim();
  return {
    rawText: trimmed,
    normalizedText: trimmed,
    confidence: confidence / 100,
    isTag: !!extractBestTagFromText(trimmed)
  };
}
