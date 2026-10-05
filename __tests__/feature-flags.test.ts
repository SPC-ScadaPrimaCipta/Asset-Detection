import * as path from 'path';

/**
 * Feature flag + model path resolution tests.
 *
 * feature-flags.ts reads process.env at module load time for the boolean flags,
 * so those are tested by re-importing with jest.resetModules(). The path
 * resolver reads env at call time, so it can be tested directly.
 */

describe('Feature flags — default false (V2.0 preserved)', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  function loadFlags(env: Record<string, string | undefined>) {
    process.env = { ...ORIGINAL_ENV, ...env };
    // Ensure the vars are genuinely absent when undefined.
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
    }
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/lib/detection/feature-flags');
  }

  it('all flags are false when no env vars are set', () => {
    const flags = loadFlags({
      DETECTION_V3_ENABLED: undefined,
      YOLO_ENABLED: undefined,
      OCR_ENABLED: undefined,
      OPENCV_ENABLED: undefined,
    });

    expect(flags.DETECTION_V3_ENABLED).toBe(false);
    expect(flags.YOLO_ENABLED).toBe(false);
    expect(flags.OCR_ENABLED).toBe(false);
    expect(flags.OPENCV_ENABLED).toBe(false);
  });

  it('sub-flags stay false when DETECTION_V3_ENABLED is false, even if set true', () => {
    const flags = loadFlags({
      DETECTION_V3_ENABLED: undefined,
      YOLO_ENABLED: 'true',
      OCR_ENABLED: 'true',
      OPENCV_ENABLED: 'true',
    });

    expect(flags.DETECTION_V3_ENABLED).toBe(false);
    expect(flags.YOLO_ENABLED).toBe(false);
    expect(flags.OCR_ENABLED).toBe(false);
    expect(flags.OPENCV_ENABLED).toBe(false);
  });

  it('sub-flags become true only when master flag is also true', () => {
    const flags = loadFlags({
      DETECTION_V3_ENABLED: 'true',
      YOLO_ENABLED: 'true',
      OCR_ENABLED: 'true',
      OPENCV_ENABLED: 'true',
    });

    expect(flags.DETECTION_V3_ENABLED).toBe(true);
    expect(flags.YOLO_ENABLED).toBe(true);
    expect(flags.OCR_ENABLED).toBe(true);
    expect(flags.OPENCV_ENABLED).toBe(true);
  });

  it('only the literal string "true" enables a flag', () => {
    const flags = loadFlags({
      DETECTION_V3_ENABLED: 'TRUE',
      YOLO_ENABLED: '1',
    });

    expect(flags.DETECTION_V3_ENABLED).toBe(false);
    expect(flags.YOLO_ENABLED).toBe(false);
  });

  it('default YOLO thresholds are sane', () => {
    const flags = loadFlags({
      YOLO_CONFIDENCE_THRESHOLD: undefined,
      YOLO_NMS_IOU: undefined,
      YOLO_MAX_DETECTIONS: undefined,
    });

    expect(flags.getYoloConfidenceThreshold()).toBe(0.3);
    expect(flags.getYoloNmsIou()).toBe(0.5);
    expect(flags.getYoloMaxDetections()).toBe(300);
  });

  it('rejects out-of-range confidence and IoU values', () => {
    const flags = loadFlags({
      YOLO_CONFIDENCE_THRESHOLD: '1.5',
      YOLO_NMS_IOU: '-0.2',
    });

    expect(() => flags.getYoloConfidenceThreshold()).toThrow(/between 0 and 1/);
    expect(() => flags.getYoloNmsIou()).toThrow(/between 0 and 1/);
  });

  it('rejects non-positive max detections', () => {
    const flags = loadFlags({ YOLO_MAX_DETECTIONS: '0' });
    expect(() => flags.getYoloMaxDetections()).toThrow(/positive integer/);
  });
});

describe('getYoloModelPath — cross-platform resolution, no hard-coded dev path', () => {
  const ORIGINAL_ENV = process.env;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getYoloModelPath } = require('@/lib/detection/feature-flags');

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('falls back to <project-root>/model/yolo-pid.onnx when YOLO_MODEL_PATH is unset', () => {
    delete process.env.YOLO_MODEL_PATH;

    const resolved = getYoloModelPath();

    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.resolve(process.cwd(), 'model', 'yolo-pid.onnx'));
  });

  it('keeps an absolute YOLO_MODEL_PATH unchanged', () => {
    const abs = path.resolve(process.cwd(), 'some', 'where', 'model.onnx');
    process.env.YOLO_MODEL_PATH = abs;

    expect(getYoloModelPath()).toBe(abs);
  });

  it('resolves a relative YOLO_MODEL_PATH against process.cwd()', () => {
    process.env.YOLO_MODEL_PATH = './artifacts/yolo-pid.onnx';

    const resolved = getYoloModelPath();

    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.resolve(process.cwd(), 'artifacts', 'yolo-pid.onnx'));
  });

  it('handles a relative path without a leading ./ prefix', () => {
    process.env.YOLO_MODEL_PATH = 'model/yolo-pid.onnx';

    expect(getYoloModelPath()).toBe(path.resolve(process.cwd(), 'model', 'yolo-pid.onnx'));
  });

  it('source contains no hard-coded developer absolute path', () => {
    // Guard against a regression that reintroduces the original dev path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/detection/feature-flags.ts'),
      'utf8',
    );

    expect(src).not.toMatch(/C:\/Users\//i);
    expect(src).not.toMatch(/C:\\\\Users\\\\/i);
    // Exactly one return inside getYoloModelPath — no unreachable leftover.
    const fnBody = src.slice(src.indexOf('export function getYoloModelPath'));
    const upToClose = fnBody.slice(0, fnBody.indexOf('\n}'));
    expect(upToClose.match(/return /g)?.length).toBe(1);
  });
});
