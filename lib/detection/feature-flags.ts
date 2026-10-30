/**
 * V3.0 Detection Feature Flags
 *
 * Controls the detection engine mode:
 * - V2.0 (all flags false): Gemini Vision as primary detection engine
 * - V3.0 (DETECTION_V3_ENABLED=true): YOLO + OCR + OpenCV + Legend as primary;
 *   Gemini as support/fallback for coverage gaps, ambiguity, verification,
 *   function understanding, and process-flow understanding.
 *
 * Default: all false (V2.0 behavior preserved).
 */

import * as path from 'path';

/**
 * Master flag for V3.0 detection pipeline. When false, all other V3.0 flags
 * are ignored and the V2.0 Gemini-only pipeline runs unchanged.
 */
export const DETECTION_V3_ENABLED =
  process.env.DETECTION_V3_ENABLED === 'true';

/**
 * Enable YOLO ONNX inference for symbol detection. Requires DETECTION_V3_ENABLED.
 */
export const YOLO_ENABLED =
  DETECTION_V3_ENABLED && process.env.YOLO_ENABLED === 'true';

/**
 * Returns true if both DETECTION_V3_ENABLED and YOLO_ENABLED are active at call time.
 */
export function isYoloEnabled(): boolean {
  return process.env.DETECTION_V3_ENABLED === 'true' && process.env.YOLO_ENABLED === 'true';
}

/**
 * Enable OCR (tesseract.js) for tag/label/code extraction from candidate crops.
 * Requires DETECTION_V3_ENABLED.
 */
export const OCR_ENABLED =
  DETECTION_V3_ENABLED && process.env.OCR_ENABLED === 'true';

/**
 * Enable OpenCV/Canvas template matching against Legend symbol templates.
 * Requires DETECTION_V3_ENABLED.
 */
export const OPENCV_ENABLED =
  DETECTION_V3_ENABLED && process.env.OPENCV_ENABLED === 'true';

/**
 * YOLO confidence threshold (0.0-1.0). Detections below this are discarded.
 */
export function getYoloConfidenceThreshold(): number {
  const val = parseFloat(process.env.YOLO_CONFIDENCE_THRESHOLD || '0.30');
  if (!Number.isFinite(val) || val < 0 || val > 1) {
    throw new Error('YOLO_CONFIDENCE_THRESHOLD must be between 0 and 1');
  }
  return val;
}

/**
 * YOLO NMS IoU threshold. Boxes with IoU above this and same class are merged.
 */
export function getYoloNmsIou(): number {
  const val = parseFloat(process.env.YOLO_NMS_IOU || '0.50');
  if (!Number.isFinite(val) || val < 0 || val > 1) {
    throw new Error('YOLO_NMS_IOU must be between 0 and 1');
  }
  return val;
}

/**
 * Maximum detections to keep after NMS per page.
 */
export function getYoloMaxDetections(): number {
  const val = parseInt(process.env.YOLO_MAX_DETECTIONS || '300', 10);
  if (!Number.isFinite(val) || val < 1) {
    throw new Error('YOLO_MAX_DETECTIONS must be a positive integer');
  }
  return val;
}

/**
 * YOLO model path — resolved relative to project root or environment variable.
 * Cross-platform compatible, no developer-specific absolute paths.
 */
export function getYoloModelPath(): string {
  const rawPath = process.env.YOLO_MODEL_PATH || './model/yolo-pid.onnx';
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

/**
 * Validation: ensure thresholds are sane at module load time.
 */
if (YOLO_ENABLED) {
  try {
    getYoloConfidenceThreshold();
    getYoloNmsIou();
    getYoloMaxDetections();
  } catch (e) {
    console.error('[feature-flags] YOLO validation failed:', e);
    throw e;
  }
}
