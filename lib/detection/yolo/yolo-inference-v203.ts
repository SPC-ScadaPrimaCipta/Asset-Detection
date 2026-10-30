/**
 * YOLO v203 Inference Engine — Offline single-image / tile testing wrapper.
 *
 * Dedicated wrapper for yolo-pid-v8n-203.onnx:
 *   - Preprocessing: 1024×1024 letterbox float32 NCHW
 *   - ONNX Runtime execution with [1, 3, 1024, 1024] input
 *   - Decoding: 207 channels (4 bbox + 203 classes), offset 4, no objectness
 *   - Unresolved semantics (assetType: null)
 *
 * NOTE: This is for offline evaluation and testing. Production worker remains unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ort from 'onnxruntime-node';
import {
  preprocessForYolo,
} from '@/lib/detection/yolo/yolo-preprocessing';
import {
  YOLO_V203_INPUT_SIZE,
} from '@/lib/detection/yolo/yolo-class-map-v203';
import {
  decodeAndFilterV203,
  DEFAULT_V203_DECODE_CONFIG,
  type YoloV203DecodeConfig,
  type YoloV203Detection,
} from '@/lib/detection/yolo/yolo-decoder-v203';

export const DEFAULT_V203_MODEL_PATH = path.resolve(
  process.cwd(),
  'model/yolo-pid-v8n-203.onnx',
);

let cachedV203Session: ort.InferenceSession | null = null;
let cachedV203ModelPath: string | null = null;

const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

/**
 * Guard against attempting ONNX inference on missing or unhydrated LFS files.
 */
export async function assertYoloV203ModelArtifact(modelPath: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(modelPath);
  } catch {
    throw new Error(`YOLO v203 model file not found at: ${modelPath}`);
  }

  if (stat.size < 1_000_000) {
    const preview = await fs.promises.readFile(modelPath, 'utf8').catch(() => '');
    if (preview.startsWith(GIT_LFS_POINTER_PREFIX)) {
      throw new Error(
        `YOLO v203 model is a Git LFS pointer, not a hydrated ONNX artifact: ${modelPath}`,
      );
    }
    throw new Error(
      `YOLO v203 model file is unexpectedly small (${stat.size} bytes): ${modelPath}. Expected ~14MB.`,
    );
  }
}

/**
 * Get or create an ONNX InferenceSession for v203 (cached across calls).
 */
export async function getYoloV203Session(
  modelPath = DEFAULT_V203_MODEL_PATH,
): Promise<ort.InferenceSession> {
  if (cachedV203Session && cachedV203ModelPath === modelPath) {
    return cachedV203Session;
  }

  await assertYoloV203ModelArtifact(modelPath);

  const opts: ort.InferenceSession.SessionOptions = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  };

  cachedV203Session = await ort.InferenceSession.create(modelPath, opts);
  cachedV203ModelPath = modelPath;
  return cachedV203Session;
}

/** Clear the v203 session cache (used in tests). */
export function clearYoloV203SessionCache(): void {
  cachedV203Session = null;
  cachedV203ModelPath = null;
}

export interface YoloV203InferenceOptions {
  modelPath?: string;
  config?: Partial<YoloV203DecodeConfig>;
}

/**
 * Run end-to-end YOLO v203 inference on an image buffer (PNG, JPEG, etc.).
 * Returns normalized 0-1000 detections with unresolved semantics.
 */
export async function runYoloV203Inference(
  imageBuffer: Buffer,
  options: YoloV203InferenceOptions = {},
): Promise<YoloV203Detection[]> {
  const modelPath = options.modelPath ?? DEFAULT_V203_MODEL_PATH;
  const session = await getYoloV203Session(modelPath);

  const { tensor, meta } = await preprocessForYolo(imageBuffer, YOLO_V203_INPUT_SIZE);

  const flatData = tensor instanceof Float32Array ? tensor : new Float32Array(tensor);
  const inputName = session.inputNames[0] || 'images';
  const feeds: Record<string, ort.Tensor> = {
    [inputName]: new ort.Tensor('float32', flatData, [
      1,
      3,
      YOLO_V203_INPUT_SIZE,
      YOLO_V203_INPUT_SIZE,
    ]),
  };

  const results = await session.run(feeds);
  const outputName = session.outputNames[0] || 'output0';
  const outputTensor = results[outputName];
  if (!outputTensor) {
    throw new Error(`runYoloV203Inference: '${outputName}' tensor missing from model output`);
  }

  const outputData = outputTensor.data as Float32Array;

  const config: YoloV203DecodeConfig = {
    confidenceThreshold: options.config?.confidenceThreshold ?? DEFAULT_V203_DECODE_CONFIG.confidenceThreshold,
    nmsIouThreshold: options.config?.nmsIouThreshold ?? DEFAULT_V203_DECODE_CONFIG.nmsIouThreshold,
    maxDetections: options.config?.maxDetections ?? DEFAULT_V203_DECODE_CONFIG.maxDetections,
  };

  return decodeAndFilterV203(outputData, meta, config);
}
