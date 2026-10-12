/**
 * YOLO Model 203-class Contract Validation (Phase 1)
 *
 * Runs ONNX model inspection in an isolated Node child process (fail-closed):
 *   - Part 1: Real model runtime validation & contract verification
 *   - Part 2: Negative tests for fail-closed validation helpers
 */

import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  type ModelInspectionResult,
  validateInspectionResult,
  parseNamesDict,
  parseOnnxMetadataProps,
  EXPECTED_SHA256,
  EXPECTED_INPUT_NAME,
  EXPECTED_INPUT_TYPE,
  EXPECTED_INPUT_SHAPE,
  EXPECTED_OUTPUT_NAME,
  EXPECTED_OUTPUT_TYPE,
  EXPECTED_OUTPUT_SHAPE,
  EXPECTED_TOTAL_OUTPUT_LENGTH,
  EXPECTED_CLASS_COUNT,
  EXPECTED_CLASS_OFFSET,
  EXPECTED_CLASS_0_LABEL,
} from '../scripts/inspect-model-203';

describe('YOLO Model 203-class — Contract Validation (Phase 1)', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const modelPath = path.resolve(repoRoot, 'model/yolo-pid-v8n-203.onnx');
  const scriptPath = path.resolve(repoRoot, 'scripts/inspect-model-203.ts');
  const tsxCliPath = require.resolve('tsx/cli');

  let inspectionResult: ModelInspectionResult | null = null;
  let inspectionExitCode = -1;
  let inspectionError: Error | null = null;
  let inspectionStderr = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      execFile(
        process.execPath,
        [tsxCliPath, scriptPath, '--json'],
        {
          cwd: repoRoot,
          timeout: 30000,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          inspectionError = error;
          inspectionExitCode = error ? (error.code as number ?? 1) : 0;
          inspectionStderr = stderr;

          if (stdout && stdout.trim().length > 0) {
            try {
              inspectionResult = JSON.parse(stdout.trim()) as ModelInspectionResult;
            } catch (parseErr) {
              console.error('Failed to parse inspection JSON output:', parseErr, stdout);
            }
          }
          resolve();
        },
      );
    });
  }, 35000);

  // ─── PART 1: REAL MODEL RUNTIME VALIDATION ────────────────────────

  describe('Part 1: Real Model Runtime Contract', () => {
    it('verifies that model file exists on disk', () => {
      expect(fs.existsSync(modelPath)).toBe(true);
      expect(inspectionResult).not.toBeNull();
      expect(inspectionResult?.file.exists).toBe(true);
    });

    it('verifies SHA-256 matches the Phase 1 reference model hash', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      expect(inspectionResult.file.sha256).toBe(EXPECTED_SHA256);
    });

    it('creates ONNX inference session without error and exits with code 0', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      expect(inspectionExitCode).toBe(0);
      expect(inspectionError).toBeNull();
      expect(inspectionResult.observed.sessionCreated).toBe(true);
    });

    it('validates observed input metadata via public API: images, float32, [1, 3, 1024, 1024]', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      const inMeta = inspectionResult.observed.inputMetadata;
      expect(inMeta).not.toBeNull();
      expect(inMeta?.name).toBe(EXPECTED_INPUT_NAME);
      expect(inMeta?.type).toBe(EXPECTED_INPUT_TYPE);
      expect(inMeta?.shape).toEqual(EXPECTED_INPUT_SHAPE);
    });

    it('validates observed output metadata via public API: output0, float32, [1, 207, 21504]', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      const outMeta = inspectionResult.observed.outputMetadata;
      expect(outMeta).not.toBeNull();
      expect(outMeta?.name).toBe(EXPECTED_OUTPUT_NAME);
      expect(outMeta?.type).toBe(EXPECTED_OUTPUT_TYPE);
      expect(outMeta?.shape).toEqual(EXPECTED_OUTPUT_SHAPE);
    });

    it('executes actual inference with float32 input and verifies output dims and length', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      const inf = inspectionResult.observed.inference;
      expect(inf).not.toBeNull();
      expect(inf?.success).toBe(true);
      expect(inf?.outputType).toBe(EXPECTED_OUTPUT_TYPE);
      expect(inf?.outputDims).toEqual(EXPECTED_OUTPUT_SHAPE);
      expect(inf?.outputLength).toBe(EXPECTED_TOTAL_OUTPUT_LENGTH);
      expect(inf?.allFinite).toBe(true);
    });

    it('extracts exactly 203 raw class names with contiguous IDs 0..202 from ModelProto metadata', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      const meta = inspectionResult.observed.metadataProps;
      expect(meta.found).toBe(true);
      expect(meta.rawNamesCount).toBe(EXPECTED_CLASS_COUNT);
      expect(meta.duplicateIds).toEqual([]);
      expect(meta.missingIds).toEqual([]);
      expect(meta.extraIds).toEqual([]);
      expect(meta.ids[0]).toBe(0);
      expect(meta.ids[meta.ids.length - 1]).toBe(202);
      expect(meta.class0Label).toBe(EXPECTED_CLASS_0_LABEL);
    });

    it('confirms entire inspection passed fail-closed validation with zero errors', () => {
      if (!inspectionResult?.file.exists) {
        throw new Error(`Model not found at ${modelPath} — integration check cannot run`);
      }
      expect(inspectionResult.validation.passed).toBe(true);
      expect(inspectionResult.validation.errors).toEqual([]);
    });
  });

  // ─── PART 2: NEGATIVE TESTS (FAIL-CLOSED VALIDATOR LOGIC) ─────────

  describe('Part 2: Fail-Closed Validator Negative Tests', () => {
    function createMockValidResult(): ModelInspectionResult {
      return {
        file: {
          exists: true,
          path: '/mock/yolo-pid-v8n-203.onnx',
          sizeBytes: 13972266,
          sha256: EXPECTED_SHA256,
        },
        observed: {
          sessionCreated: true,
          inputNames: ['images'],
          outputNames: ['output0'],
          inputMetadata: {
            name: 'images',
            type: 'float32',
            isTensor: true,
            shape: [1, 3, 1024, 1024],
          },
          outputMetadata: {
            name: 'output0',
            type: 'float32',
            isTensor: true,
            shape: [1, 207, 21504],
          },
          inference: {
            success: true,
            outputName: 'output0',
            outputType: 'float32',
            outputDims: [1, 207, 21504],
            outputLength: 4451328,
            allFinite: true,
          },
          metadataProps: {
            found: true,
            rawNamesCount: 203,
            ids: Array.from({ length: 203 }, (_, i) => i),
            class0Label: 'valve.3way_ball.iso',
            class202Label: 'fitting.eccentric_reducer.iso',
            duplicateIds: [],
            missingIds: [],
            extraIds: [],
          },
        },
        expected: {
          sha256: EXPECTED_SHA256,
          inputName: EXPECTED_INPUT_NAME,
          inputType: EXPECTED_INPUT_TYPE,
          inputShape: EXPECTED_INPUT_SHAPE,
          outputName: EXPECTED_OUTPUT_NAME,
          outputType: EXPECTED_OUTPUT_TYPE,
          outputShape: EXPECTED_OUTPUT_SHAPE,
          outputLength: EXPECTED_TOTAL_OUTPUT_LENGTH,
          classCount: EXPECTED_CLASS_COUNT,
          classOffset: EXPECTED_CLASS_OFFSET,
          class0Label: EXPECTED_CLASS_0_LABEL,
          expectedRange: [0, 202],
        },
        validation: {
          passed: true,
          errors: [],
        },
      };
    }

    it('fails when model file is missing', () => {
      const mock = createMockValidResult();
      mock.file.exists = false;
      const val = validateInspectionResult(mock);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('does not exist'))).toBe(true);
    });

    it('fails when SHA-256 hash does not match expected', () => {
      const mock = createMockValidResult();
      mock.file.sha256 = 'bad_hash_00000000000000000000000000000000000000000000000000000000000000';
      const val = validateInspectionResult(mock);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('SHA-256 mismatch'))).toBe(true);
    });

    it('fails when input or output metadata is unavailable', () => {
      const mockIn = createMockValidResult();
      mockIn.observed.inputMetadata = null;
      const valIn = validateInspectionResult(mockIn);
      expect(valIn.passed).toBe(false);
      expect(valIn.errors.some((e) => e.includes('Input metadata is unavailable'))).toBe(true);

      const mockOut = createMockValidResult();
      mockOut.observed.outputMetadata = null;
      const valOut = validateInspectionResult(mockOut);
      expect(valOut.passed).toBe(false);
      expect(valOut.errors.some((e) => e.includes('Output metadata is unavailable'))).toBe(true);
    });

    it('fails when input shape or dtype is incorrect (e.g. 640x640 or float64)', () => {
      const mockShape = createMockValidResult();
      mockShape.observed.inputMetadata!.shape = [1, 3, 640, 640];
      const valShape = validateInspectionResult(mockShape);
      expect(valShape.passed).toBe(false);
      expect(valShape.errors.some((e) => e.includes('Input shape mismatch'))).toBe(true);

      const mockType = createMockValidResult();
      mockType.observed.inputMetadata!.type = 'float64';
      const valType = validateInspectionResult(mockType);
      expect(valType.passed).toBe(false);
      expect(valType.errors.some((e) => e.includes('Input type mismatch'))).toBe(true);
    });

    it('fails when output shape or channel count is incorrect (e.g. 32 classes / 36 channels)', () => {
      const mockOut = createMockValidResult();
      mockOut.observed.outputMetadata!.shape = [1, 36, 8400];
      const val = validateInspectionResult(mockOut);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('Output shape mismatch'))).toBe(true);
    });

    it('fails when inference tensor contains non-finite values (NaN / Infinity)', () => {
      const mockInf = createMockValidResult();
      mockInf.observed.inference!.allFinite = false;
      const val = validateInspectionResult(mockInf);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('non-finite values'))).toBe(true);
    });

    it('fails when output data length does not match expected candidate count', () => {
      const mockLen = createMockValidResult();
      mockLen.observed.inference!.outputLength = 4000000;
      const val = validateInspectionResult(mockLen);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('Inference output length mismatch'))).toBe(true);
    });

    it('detects duplicate class IDs in names dictionary parser', () => {
      const dictStr = "{0: 'valve.3way_ball.iso', 0: 'duplicate.valve', 1: 'valve.gate'}";
      const { duplicateIds, ids } = parseNamesDict(dictStr);
      expect(duplicateIds).toEqual([0]);
      expect(ids).toEqual([0, 1]);

      const mock = createMockValidResult();
      mock.observed.metadataProps.duplicateIds = duplicateIds;
      const val = validateInspectionResult(mock);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('Duplicate class IDs detected'))).toBe(true);
    });

    it('fails when class IDs are missing from the 0..202 contiguous sequence', () => {
      const mock = createMockValidResult();
      mock.observed.metadataProps.missingIds = [50, 51];
      const val = validateInspectionResult(mock);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('Missing class IDs in 0..202'))).toBe(true);
    });

    it('fails when Class ID 0 label does not match expected', () => {
      const mock = createMockValidResult();
      mock.observed.metadataProps.class0Label = 'wrong.class0.label';
      const val = validateInspectionResult(mock);
      expect(val.passed).toBe(false);
      expect(val.errors.some((e) => e.includes('Class 0 label mismatch'))).toBe(true);
    });
  });
});
