/**
 * Central Configuration for YOLO GEO-2 Symbol Detection
 *
 * Ground-truth configuration derived from the verified GEO-2 baseline:
 * - Model: model/yolo-pid-v8n-203.onnx (Fixed 1024x1024 input)
 * - Tiling: 1280x1280 tiles, stride 1024 (20.0% overlap)
 * - Confidence threshold: 0.50
 * - Per-tile NMS: IoU 0.70 (class-aware, cap 300 detections per tile)
 * - Global merge: IoU 0.50 (class-aware)
 * - Target render: 216 DPI (Scale 3.0 from A3 PDF point space)
 */

import * as path from 'path';

export interface YoloGeo2Config {
  /** Relative or absolute path to ONNX model */
  modelPath: string;
  /** ONNX input dimension (fixed square) */
  inputSize: number;
  /** Tile dimension in page coordinates */
  tileSize: number;
  /** Tile stride in page coordinates */
  stride: number;
  /** Confidence score threshold (0.0 - 1.0) */
  confidenceThreshold: number;
  /** Per-tile NMS IoU threshold (class-aware) */
  perTileNmsIou: number;
  /** Maximum candidates retained per tile before cross-tile merge */
  perTileCap: number;
  /** Global cross-tile merge IoU threshold (class-aware) */
  globalMergeIou: number;
  /** Whether NMS and global merge separate by class ID */
  classAware: boolean;
  /** Target DPI for PDF rendering */
  targetPdfDpi: number;
  /** Scale multiplier corresponding to target DPI (3.0 = 216 DPI) */
  pdfRenderScale: number;
}

export const DEFAULT_GEO2_CONFIG: YoloGeo2Config = Object.freeze({
  modelPath: path.resolve(process.cwd(), 'model/yolo-pid-v8n-203.onnx'),
  inputSize: 1024,
  tileSize: 1280,
  stride: 1024,
  confidenceThreshold: 0.50,
  perTileNmsIou: 0.70,
  perTileCap: 300,
  globalMergeIou: 0.50,
  classAware: true,
  targetPdfDpi: 216,
  pdfRenderScale: 3.0,
});

/**
 * Returns effective GEO-2 configuration with optional env overrides and argument overrides.
 * Parameter NMS per-tile (0.70) and global merge (0.50) are distinctly separated.
 */
export function getEffectiveGeo2Config(overrides?: Partial<YoloGeo2Config>): YoloGeo2Config {
  const envModelPath = process.env.GEO2_MODEL_PATH;
  const envConf = process.env.GEO2_CONFIDENCE_THRESHOLD ? parseFloat(process.env.GEO2_CONFIDENCE_THRESHOLD) : undefined;
  const envPerTileNms = process.env.GEO2_PER_TILE_NMS_IOU ? parseFloat(process.env.GEO2_PER_TILE_NMS_IOU) : undefined;
  const envGlobalMerge = process.env.GEO2_GLOBAL_MERGE_IOU ? parseFloat(process.env.GEO2_GLOBAL_MERGE_IOU) : undefined;

  const base: YoloGeo2Config = {
    ...DEFAULT_GEO2_CONFIG,
    ...(envModelPath ? { modelPath: path.isAbsolute(envModelPath) ? envModelPath : path.resolve(process.cwd(), envModelPath) } : {}),
    ...(Number.isFinite(envConf) && envConf! >= 0 && envConf! <= 1 ? { confidenceThreshold: envConf! } : {}),
    ...(Number.isFinite(envPerTileNms) && envPerTileNms! >= 0 && envPerTileNms! <= 1 ? { perTileNmsIou: envPerTileNms! } : {}),
    ...(Number.isFinite(envGlobalMerge) && envGlobalMerge! >= 0 && envGlobalMerge! <= 1 ? { globalMergeIou: envGlobalMerge! } : {}),
  };

  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
  };
}
