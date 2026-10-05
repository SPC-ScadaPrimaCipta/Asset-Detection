/**
 * YOLO ONNX inference engine — server-side onnxruntime-node wrapper.
 *
 * Provides a cached InferenceSession, runs letterbox preprocessing, executes
 * the ONNX graph, decodes the [1, 37, 8400] output with channel-major indexing,
 * applies class-aware NMS, and returns normalized 0-1000 detections.
 */

import * as fs from 'fs';
import * as ort from 'onnxruntime-node';
import {
  getYoloConfidenceThreshold,
  getYoloMaxDetections,
  getYoloModelPath,
  getYoloNmsIou,
  YOLO_ENABLED,
} from '@/lib/detection/feature-flags';
import {
  preprocessForYolo,
  YOLO_INPUT_SIZE,
} from '@/lib/detection/yolo/yolo-preprocessing';
import {
  decodeAndFilter,
  type YoloDecodeConfig,
  type YoloDetection,
} from '@/lib/detection/yolo/yolo-decoder';

let cachedSession: ort.InferenceSession | null = null;
let cachedModelPath: string | null = null;

const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

/**
 * Guard against attempting ONNX inference on a Git LFS pointer file.
 *
 * If a checkout ran without `git lfs pull`, model/yolo-pid.onnx is a ~130-byte
 * text file with the pointer metadata. Passing that to onnxruntime-node produces
 * a cryptic native crash. This asserts the file is a hydrated binary (>1MB).
 */
export async function assertYoloModelArtifact(modelPath: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(modelPath);
  } catch {
    throw new Error(`YOLO model file not found: ${modelPath}`);
  }

  if (stat.size < 1_000_000) {
    const preview = await fs.promises.readFile(modelPath, 'utf8').catch(() => '');
    if (preview.startsWith(GIT_LFS_POINTER_PREFIX)) {
      throw new Error(
        `YOLO model is a Git LFS pointer, not a hydrated ONNX artifact: ${modelPath}. ` +
          'Run `git lfs pull` before starting the detection worker.',
      );
    }
    throw new Error(
      `YOLO model file is unexpectedly small (${stat.size} bytes): ${modelPath}. Expected ~99MB.`,
    );
  }
}

/**
 * Get or create an ONNX InferenceSession (cached across calls).
 */
export async function getYoloSession(
  modelPath = getYoloModelPath(),
): Promise<ort.InferenceSession> {
  if (cachedSession && cachedModelPath === modelPath) {
    return cachedSession;
  }

  // Ensure the model file is a real hydrated binary before giving it to ONNX Runtime.
  await assertYoloModelArtifact(modelPath);

  // Session options: multi-threaded CPU inference.
  const opts: ort.InferenceSession.SessionOptions = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  };

  cachedSession = await ort.InferenceSession.create(modelPath, opts);
  cachedModelPath = modelPath;
  return cachedSession;
}

/** Clear the session cache (used in tests). */
export function clearYoloSessionCache(): void {
  cachedSession = null;
  cachedModelPath = null;
}

export interface YoloInferenceOptions {
  modelPath?: string;
  config?: Partial<YoloDecodeConfig>;
}

/**
 * Run end-to-end YOLO inference on an image buffer (PNG, JPEG, etc.).
 *
 * Returns normalized 0-1000 detections ready for Legend filtering.
 * Throws if YOLO_ENABLED is false (caller should check feature flags first).
 */
export async function runYoloInference(
  imageBuffer: Buffer,
  options: YoloInferenceOptions = {},
): Promise<YoloDetection[]> {
  const session = await getYoloSession(options.modelPath);
  const { tensor, meta } = await preprocessForYolo(imageBuffer);

  // Use Float32Array constructor explicitly; in Jest VM contexts, ensure the
  // buffer is a standard typed array.
  const flatData = tensor instanceof Float32Array ? tensor : new Float32Array(tensor);
  const feeds: Record<string, ort.Tensor> = {
    images: new ort.Tensor('float32', flatData, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]),
  };

  const results = await session.run(feeds);
  const outputTensor = results.output0;
  if (!outputTensor) {
    throw new Error('runYoloInference: output0 tensor missing from model output');
  }

  const outputData = outputTensor.data as Float32Array;

  const config: YoloDecodeConfig = {
    confidenceThreshold: options.config?.confidenceThreshold ?? getYoloConfidenceThreshold(),
    nmsIouThreshold: options.config?.nmsIouThreshold ?? getYoloNmsIou(),
    maxDetections: options.config?.maxDetections ?? getYoloMaxDetections(),
  };

  return decodeAndFilter(outputData, meta, config);
}
