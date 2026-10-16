/**
 * Node-side OCR Engine
 *
 * Uses tesseract.js v7 to read asset tags from YOLO-detected bounding box crops.
 * Optimized for P&ID tag formats: P-101, XV-103A, FV-201, PSV-101B, E-201, T-101.
 *
 * Preprocessing: grayscale → sharpen → binarize (Otsu threshold via sharp).
 * Strategy: PSM 7 (single line) → PSM 8 (single word) → PSM 6 (block) fallback.
 */

import sharp from 'sharp';

// ── Types ──────────────────────────────────────────────────────────────────
export interface OcrResult {
  text: string;
  confidence: number; // 0.0 - 1.0
  isTag: boolean;     // matches P&ID tag pattern
  normalizedText: string; // uppercase, trimmed, noise-free
  rawText: string;    // unmodified OCR output
}

// ── Tag detection regex ────────────────────────────────────────────────────
// Matches: P-101, XV-103A, FV-201, PSV-101B, E-201, T-101, TIC-2001A, LG-301
const TAG_PATTERN = /^[A-Z]{1,5}[-]?\d{1,5}[A-Z]?$/i;
const TAG_PATTERN_RELAXED = /[A-Z]{1,5}[-]?\d{2,5}/i; // for partial matches in block OCR

// ── Tesseract worker singleton ─────────────────────────────────────────────
let _worker: import('tesseract.js').Worker | null = null;
let _workerInitializing = false;
let _workerInitQueue: Array<(w: import('tesseract.js').Worker) => void> = [];

// Hot-reload safety: terminate worker when Next.js hot-reloads this module
if (process.env.NODE_ENV === 'development' && typeof module !== 'undefined') {
  // @ts-expect-error — Next.js HMR hook
  if (module.hot) {
    // @ts-expect-error — Next.js HMR hook
    module.hot.dispose(() => {
      if (_worker) {
        _worker.terminate().catch(() => {});
        _worker = null;
      }
    });
  }
}

async function getWorker(): Promise<import('tesseract.js').Worker> {
  if (_worker) return _worker;

  if (_workerInitializing) {
    // Queue callers waiting for init
    return new Promise((resolve) => {
      _workerInitQueue.push(resolve);
    });
  }

  _workerInitializing = true;
  const Tesseract = (await import('tesseract.js')).default;

  const worker = await Tesseract.createWorker('eng', 1, {
    logger: () => {}, // suppress progress logs
  });

  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_ ',
  });

  _worker = worker;
  _workerInitializing = false;

  // Drain queue
  for (const resolve of _workerInitQueue) resolve(worker);
  _workerInitQueue = [];

  return worker;
}

export async function terminateOcrWorker(): Promise<void> {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
  }
}

// ── Image preprocessing ────────────────────────────────────────────────────
async function preprocessForOcr(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .grayscale()
    .sharpen({ sigma: 1.5 })
    .threshold(128) // Otsu-like binarization
    .toBuffer();
}

async function preprocessForTagOcr(imageBuffer: Buffer): Promise<Buffer> {
  // More aggressive preprocessing for small tags
  return sharp(imageBuffer)
    .grayscale()
    .normalize() // stretch contrast
    .sharpen({ sigma: 1.0 }) // reduced from 2.0 — over-sharpening blurs thin strokes
    .threshold(140)
    .resize({ width: 200, height: 60, fit: 'inside', withoutEnlargement: false })
    .toBuffer();
}

// ── Crop helper ────────────────────────────────────────────────────────────
export async function cropBBoxFromBuffer(
  pageBuffer: Buffer,
  bbox: { x: number; y: number; width: number; height: number },
  expansionPx = 8,
): Promise<Buffer> {
  const meta = await sharp(pageBuffer).metadata();
  const imgW = meta.width ?? 1000;
  const imgH = meta.height ?? 1000;

  const left = Math.max(0, Math.floor(bbox.x - expansionPx));
  const top = Math.max(0, Math.floor(bbox.y - expansionPx));
  const right = Math.min(imgW, Math.ceil(bbox.x + bbox.width + expansionPx));
  const bottom = Math.min(imgH, Math.ceil(bbox.y + bbox.height + expansionPx));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return sharp(pageBuffer)
    .extract({ left, top, width, height })
    .toBuffer();
}

export interface AdaptiveCropOptions {
  expandX?: number;
  expandY?: number;
}

/**
 * Calculates adaptive bounding box for tag search around a symbol.
 * Ensures the box is strictly clamped to [0, pageWidth] and [0, pageHeight].
 */
export function calculateAdaptiveTagBBox(
  bbox: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  options: AdaptiveCropOptions = {},
): { x: number; y: number; width: number; height: number } {
  const expandX = options.expandX ?? 60;
  const expandY = options.expandY ?? 80;

  const left = Math.max(0, Math.floor(bbox.x - expandX));
  const top = Math.max(0, Math.floor(bbox.y - expandY));
  const right = Math.min(pageWidth, Math.ceil(bbox.x + bbox.width + expandX));
  const bottom = Math.min(pageHeight, Math.ceil(bbox.y + bbox.height + expandY));

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Crops an adaptively expanded context region around a symbol for tag OCR.
 */
export async function cropAdaptiveTagRegionFromBuffer(
  pageBuffer: Buffer,
  bbox: { x: number; y: number; width: number; height: number },
  options: AdaptiveCropOptions = {},
): Promise<{ buffer: Buffer; bbox: { x: number; y: number; width: number; height: number } }> {
  const meta = await sharp(pageBuffer).metadata();
  const imgW = meta.width ?? 1000;
  const imgH = meta.height ?? 1000;

  const tagBbox = calculateAdaptiveTagBBox(bbox, imgW, imgH, options);

  const buffer = await sharp(pageBuffer)
    .extract({
      left: tagBbox.x,
      top: tagBbox.y,
      width: tagBbox.width,
      height: tagBbox.height,
    })
    .toBuffer();

  return { buffer, bbox: tagBbox };
}

// ── Tag extraction helper ──────────────────────────────────────────────────
/**
 * Extract the best matching asset tag from multiline or noisy OCR text.
 */
export function extractBestTagFromText(ocrText: string): string | null {
  if (!ocrText || typeof ocrText !== 'string') return null;

  // Split into lines/tokens
  const lines = ocrText.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const normalized = normalizeTagText(trimmed);
    if (TAG_PATTERN.test(normalized)) {
      return normalized;
    }
  }

  // Token regex across whole string
  const tokenRegex = /\b([A-Z]{1,6}-(?:[A-Z]{1,6}-\d{1,5}[A-Z]{0,2}|\d{1,5}[A-Z]{0,2}))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(ocrText)) !== null) {
    const candidate = normalizeTagText(match[1]);
    if (TAG_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  // Fallback: look for simple relaxed pattern (e.g. XV-103)
  const relaxedRegex = /\b([A-Z]{1,5}[-]?\d{1,5}[A-Z]?)\b/gi;
  while ((match = relaxedRegex.exec(ocrText)) !== null) {
    const candidate = normalizeTagText(match[1]);
    if (TAG_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ── OCR execution ──────────────────────────────────────────────────────────
async function runTesseractPsm(
  imageBuffer: Buffer,
  psm: number,
  _lang: string, // lang is set at worker creation, not per-recognize call
): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker();

  // PSM is a string enum in tesseract.js v7: '7', '8', '6' etc.
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm) as unknown as import('tesseract.js').PSM,
  });

  const { data } = await worker.recognize(imageBuffer);

  const rawText = data.text ?? '';
  // Tesseract confidence is 0-100
  const confidence = Math.min(1, Math.max(0, (data.confidence ?? 0) / 100));
  return { text: rawText, confidence };
}

// ── Tag normalization ──────────────────────────────────────────────────────
export function normalizeTagText(raw: string): string {
  // Uppercase, trim
  let s = raw.trim().toUpperCase();

  // Remove junk characters not in tag patterns
  s = s.replace(/[^A-Z0-9\-_\s]/g, '');

  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();

  // Fix common OCR errors: O↔0 boundary between letters and digits
  // e.g., "P-1O1" → "P-101", "P-l01" → "P-101"
  s = s.replace(/([A-Z]{1,5}-)([0-9O]{1,5})([A-Z]?)$/, (_m, prefix, nums, suffix) => {
    const fixedNums = nums.replace(/O/g, '0').replace(/l/g, '1').replace(/I/g, '1');
    return `${prefix}${fixedNums}${suffix}`;
  });

  // Add dash if missing between letters and digits: "P101" → "P-101"
  s = s.replace(/^([A-Z]{1,5})(\d{2,5}[A-Z]?)$/, '$1-$2');

  return s;
}

// ── Tag validation ─────────────────────────────────────────────────────────
export function isLikelyTag(text: string): boolean {
  const normalized = normalizeTagText(text);
  if (!normalized || normalized.length < 3) return false;
  return TAG_PATTERN.test(normalized) || TAG_PATTERN_RELAXED.test(normalized);
}

// ── Main OCR function ──────────────────────────────────────────────────────
export async function runOcrOnBuffer(
  imageBuffer: Buffer,
  options?: {
    lang?: string;
    psm?: number;
    whitelist?: string;
  },
): Promise<OcrResult> {
  const lang = options?.lang ?? 'eng';
  const psm = options?.psm ?? 7;

  let processedBuffer: Buffer;
  try {
    processedBuffer = await preprocessForOcr(imageBuffer);
  } catch {
    processedBuffer = imageBuffer;
  }

  const { text: rawText, confidence } = await runTesseractPsm(processedBuffer, psm, lang);

  const normalized = normalizeTagText(rawText);
  const isTag = isLikelyTag(normalized);

  return {
    text: rawText,
    confidence,
    isTag,
    normalizedText: normalized,
    rawText,
  };
}

// ── Tag-optimized OCR ──────────────────────────────────────────────────────
export async function runTagOcr(cropBuffer: Buffer): Promise<OcrResult> {
  let processed: Buffer;
  try {
    processed = await preprocessForTagOcr(cropBuffer);
  } catch {
    processed = cropBuffer;
  }

  // Try PSM 7 (single line) first
  const result7 = await runTesseractPsm(processed, 7, 'eng');
  const norm7 = normalizeTagText(result7.text);
  if (isLikelyTag(norm7) && result7.confidence > 0.5) {
    return {
      text: result7.text,
      confidence: result7.confidence,
      isTag: true,
      normalizedText: norm7,
      rawText: result7.text,
    };
  }

  // Try PSM 8 (single word)
  const result8 = await runTesseractPsm(processed, 8, 'eng');
  const norm8 = normalizeTagText(result8.text);
  if (isLikelyTag(norm8) && result8.confidence > 0.4) {
    return {
      text: result8.text,
      confidence: result8.confidence,
      isTag: true,
      normalizedText: norm8,
      rawText: result8.text,
    };
  }

  // Try PSM 6 (block text) as last resort - scan for tag-like token
  const result6 = await runTesseractPsm(processed, 6, 'eng');
  const tokens6 = result6.text.split(/\s+/).map(normalizeTagText).filter(isLikelyTag);
  if (tokens6.length > 0) {
    const bestTag = tokens6[0];
    return {
      text: result6.text,
      confidence: result6.confidence * 0.8,
      isTag: true,
      normalizedText: bestTag,
      rawText: result6.text,
    };
  }

  // No tag found — return best result anyway
  const best = result7.confidence >= result8.confidence ? result7 : result8;
  const bestNorm = normalizeTagText(best.text);
  return {
    text: best.text,
    confidence: best.confidence,
    isTag: false,
    normalizedText: bestNorm,
    rawText: best.text,
  };
}
