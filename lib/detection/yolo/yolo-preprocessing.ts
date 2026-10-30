/**
 * YOLO preprocessing — letterbox resize + inverse transform metadata.
 *
 * The model expects a fixed 640x640 square input. P&ID page rasters are almost
 * never square, so we letterbox: scale by the smaller of the two ratios, center
 * the result, and pad with neutral grey (114). The scale and pad offsets must be
 * carried through decoding and inverted BEFORE normalizing to the project's
 * 0-1000 bbox space, otherwise every box is shifted/scaled wrong on the page.
 *
 * Input to the model: NCHW, RGB, float32, normalized [0,1].
 */

import sharp from 'sharp';

/** Model input side length. Must match the ONNX input shape. */
export const YOLO_INPUT_SIZE = 640;

/** Pad colour, matching the standard YOLO letterbox grey. */
export const LETTERBOX_PAD_VALUE = 114;

export interface LetterboxMeta {
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  /** Uniform scale applied to the source before padding. */
  scale: number;
  /** Left padding in input pixels. */
  padX: number;
  /** Top padding in input pixels. */
  padY: number;
}

export interface YoloPreprocessResult {
  /** NCHW float32 buffer, length 1*3*640*640. */
  tensor: Float32Array;
  meta: LetterboxMeta;
}

/**
 * Compute letterbox geometry for a source image. Pure — safe to unit test.
 */
export function computeLetterboxMeta(
  sourceWidth: number,
  sourceHeight: number,
  inputSize = YOLO_INPUT_SIZE,
): LetterboxMeta {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('computeLetterboxMeta: source dimensions must be positive');
  }

  const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const scaledW = Math.round(sourceWidth * scale);
  const scaledH = Math.round(sourceHeight * scale);
  const padX = Math.floor((inputSize - scaledW) / 2);
  const padY = Math.floor((inputSize - scaledH) / 2);

  return {
    sourceWidth,
    sourceHeight,
    inputWidth: inputSize,
    inputHeight: inputSize,
    scale,
    padX,
    padY,
  };
}

/**
 * Letterbox a source image buffer into a 640x640 RGB raw buffer, then convert
 * to a normalized NCHW Float32Array.
 *
 * `source` may be any image format sharp can read (PNG/JPEG/BMP/raw).
 */
export async function preprocessForYolo(
  source: Buffer,
  inputSize = YOLO_INPUT_SIZE,
): Promise<YoloPreprocessResult> {
  const base = sharp(source);
  const { width, height } = await base.metadata();
  if (!width || !height) {
    throw new Error('preprocessForYolo: could not read source image dimensions');
  }

  const meta = computeLetterboxMeta(width, height, inputSize);

  const scaledW = Math.max(1, Math.round(width * meta.scale));
  const scaledH = Math.max(1, Math.round(height * meta.scale));

  // Letterbox: resize preserving aspect ratio, then extend onto a grey canvas.
  const letterboxed = await sharp(source)
    .resize(scaledW, scaledH, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .extend({
      top: meta.padY,
      bottom: inputSize - scaledH - meta.padY,
      left: meta.padX,
      right: inputSize - scaledW - meta.padX,
      background: { r: LETTERBOX_PAD_VALUE, g: LETTERBOX_PAD_VALUE, b: LETTERBOX_PAD_VALUE },
    })
    .raw()
    .toBuffer();

  // raw() yields HWC uint8 RGB. Convert to NCHW float32 in [0,1].
  const tensor = new Float32Array(1 * 3 * inputSize * inputSize);
  const channelStride = inputSize * inputSize;
  const pixelCount = channelStride;

  for (let p = 0; p < pixelCount; p++) {
    const r = letterboxed[p * 3 + 0];
    const g = letterboxed[p * 3 + 1];
    const b = letterboxed[p * 3 + 2];
    tensor[0 * channelStride + p] = r / 255;
    tensor[1 * channelStride + p] = g / 255;
    tensor[2 * channelStride + p] = b / 255;
  }

  return { tensor, meta };
}

/**
 * Invert a letterbox-space bbox back to source pixel coordinates.
 * Input box is corner format (x1, y1, x2, y2) in 640x640 space.
 * Output is clamped to the source image bounds.
 */
export function invertLetterboxBox(
  box: { x1: number; y1: number; x2: number; y2: number },
  meta: LetterboxMeta,
): { x1: number; y1: number; x2: number; y2: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const x1 = clamp((box.x1 - meta.padX) / meta.scale, 0, meta.sourceWidth);
  const y1 = clamp((box.y1 - meta.padY) / meta.scale, 0, meta.sourceHeight);
  const x2 = clamp((box.x2 - meta.padX) / meta.scale, 0, meta.sourceWidth);
  const y2 = clamp((box.y2 - meta.padY) / meta.scale, 0, meta.sourceHeight);

  // Guard against fully-clamped (degenerate) boxes.
  return {
    x1: Math.min(x1, x2),
    y1: Math.min(y1, y2),
    x2: Math.max(x1, x2),
    y2: Math.max(y1, y2),
  };
}
