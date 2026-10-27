import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

export async function extractTextFromRegion(imageBuffer: Buffer, bbox: { left: number, top: number, width: number, height: number }): Promise<string> {
  // Preprocess: crop and thresholding for better OCR
  const processed = await sharp(imageBuffer)
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .greyscale()
    .threshold(128)
    .toBuffer();

  const worker = await createWorker('eng');
  const { data: { text } } = await worker.recognize(processed);
  await worker.terminate();
  
  return text.trim();
}

export async function cropBBoxFromBuffer(buffer: Buffer, bbox: { x: number, y: number, width: number, height: number }, padding: number): Promise<Buffer> {
  return sharp(buffer)
    .extract({
      left: Math.max(0, bbox.x - padding),
      top: Math.max(0, bbox.y - padding),
      width: bbox.width + padding * 2,
      height: bbox.height + padding * 2
    })
    .toBuffer();
}

export async function cropAdaptiveTagRegionFromBuffer(buffer: Buffer, symbolBbox: { x: number, y: number, width: number, height: number }, config: { expandX: number, expandY: number }): Promise<{ buffer: Buffer }> {
  const buf = await sharp(buffer)
    .extract({
      left: Math.max(0, symbolBbox.x - config.expandX),
      top: Math.max(0, symbolBbox.y - config.expandY),
      width: symbolBbox.width + config.expandX * 2,
      height: symbolBbox.height + config.expandY * 2
    })
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
  // Simple heuristic: find a pattern that looks like a tag (e.g., 3 letters + hyphen + numbers)
  const match = text.match(/[A-Z]{2,}-\d+/);
  return match ? match[0] : null;
}

export async function runTagOcr(buffer: Buffer): Promise<{ rawText: string, normalizedText: string, confidence: number, isTag: boolean }> {
  const worker = await createWorker('eng');
  const { data: { text, confidence } } = await worker.recognize(buffer);
  await worker.terminate();
  const trimmed = text.trim();
  return {
    rawText: trimmed,
    normalizedText: trimmed,
    confidence: confidence / 100,
    isTag: !!extractBestTagFromText(trimmed)
  };
}
