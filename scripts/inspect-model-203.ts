#!/usr/bin/env tsx
/**
 * YOLO Model v203 Inspection & Contract Validator (Phase 1)
 *
 * Direct node runtime execution of ONNX inspection (fail-closed):
 * - File existence & SHA-256 hash verification
 * - ONNX session creation via onnxruntime-node
 * - Public metadata API inspection (inputNames, outputNames, inputMetadata, outputMetadata)
 * - Actual float32 dummy inference execution using actual tensor dims and type
 * - Finite float validation across all 4,451,328 elements
 * - True ONNX ModelProto metadata_props protobuf parsing for class names
 * - Strict contiguous 0..202 ID validation with duplicate detection
 * - Resource cleanup in finally block
 *
 * Usage:
 *   npx tsx scripts/inspect-model-203.ts          # Human-readable report (exit 0 on valid, 1 on invalid, 2 on missing file)
 *   npx tsx scripts/inspect-model-203.ts --json   # JSON object on stdout (exit 0 on valid, 1 on invalid, 2 on missing file)
 */

import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export const MODEL_PATH = path.resolve(process.cwd(), 'model/yolo-pid-v8n-203.onnx');
export const EXPECTED_SHA256 = '92f22175ade687a0f7e29617c3a3ae9cbf80266dda6df30d74fb9c3c95917e6c';

export const EXPECTED_INPUT_NAME = 'images';
export const EXPECTED_INPUT_TYPE = 'float32';
export const EXPECTED_INPUT_SIZE = 1024;
export const EXPECTED_INPUT_SHAPE = [1, 3, EXPECTED_INPUT_SIZE, EXPECTED_INPUT_SIZE];

export const EXPECTED_OUTPUT_NAME = 'output0';
export const EXPECTED_OUTPUT_TYPE = 'float32';
export const EXPECTED_CLASS_COUNT = 203;
export const EXPECTED_OUTPUT_CHANNELS = 207; // 4 bbox + 203 classes
export const EXPECTED_CANDIDATES = 21504;
export const EXPECTED_CLASS_OFFSET = 4;
export const EXPECTED_OUTPUT_SHAPE = [1, EXPECTED_OUTPUT_CHANNELS, EXPECTED_CANDIDATES];
export const EXPECTED_TOTAL_OUTPUT_LENGTH = 1 * EXPECTED_OUTPUT_CHANNELS * EXPECTED_CANDIDATES; // 4,451,328
export const EXPECTED_CLASS_0_LABEL = 'valve.3way_ball.iso';
export const EXPECTED_CLASS_202_LABEL = 'fitting.eccentric_reducer.iso';

export interface ModelInspectionResult {
  file: {
    exists: boolean;
    path: string;
    sizeBytes: number;
    sha256: string;
  };
  observed: {
    sessionCreated: boolean;
    inputNames: string[];
    outputNames: string[];
    inputMetadata: {
      name: string;
      type: string;
      isTensor: boolean;
      shape: number[];
    } | null;
    outputMetadata: {
      name: string;
      type: string;
      isTensor: boolean;
      shape: number[];
    } | null;
    inference: {
      success: boolean;
      outputName: string;
      outputType: string;
      outputDims: number[];
      outputLength: number;
      allFinite: boolean;
    } | null;
    metadataProps: {
      found: boolean;
      rawNamesCount: number;
      ids: number[];
      class0Label: string;
      class202Label: string;
      duplicateIds: number[];
      missingIds: number[];
      extraIds: number[];
    };
  };
  expected: {
    sha256: string;
    inputName: string;
    inputType: string;
    inputShape: number[];
    outputName: string;
    outputType: string;
    outputShape: number[];
    outputLength: number;
    classCount: number;
    classOffset: number;
    class0Label: string;
    expectedRange: [number, number];
  };
  validation: {
    passed: boolean;
    errors: string[];
  };
}

/** Compute SHA-256 hash of a file. */
export function computeSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Parse protobuf ModelProto metadata_props (field 14) from an ONNX binary buffer.
 * Field 14 is repeated StringStringEntryProto:
 *   field 1 (tag 0x0A): key (string)
 *   field 2 (tag 0x12): value (string)
 */
export function parseOnnxMetadataProps(buf: Buffer): Record<string, string> {
  const metadata: Record<string, string> = {};
  let offset = 0;

  function readVarint(): number {
    let result = 0;
    let shift = 0;
    while (offset < buf.length) {
      const byte = buf[offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  while (offset < buf.length) {
    const tag = readVarint();
    if (tag === 0 && offset >= buf.length) break;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      readVarint();
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const len = readVarint();
      if (fieldNum === 14) {
        // StringStringEntryProto
        const end = offset + len;
        let key = '';
        let val = '';
        while (offset < end) {
          const subTag = readVarint();
          const subField = subTag >>> 3;
          const subWire = subTag & 0x07;
          if (subWire === 2) {
            const subLen = readVarint();
            const strVal = buf.toString('utf8', offset, offset + subLen);
            offset += subLen;
            if (subField === 1) key = strVal;
            else if (subField === 2) val = strVal;
          } else if (subWire === 0) {
            readVarint();
          } else if (subWire === 1) {
            offset += 8;
          } else if (subWire === 5) {
            offset += 4;
          }
        }
        if (key) metadata[key] = val;
      } else {
        offset += len;
      }
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }

  return metadata;
}

/**
 * Parse Ultralytics names dictionary format without eval:
 *   "{0: 'label0', 1: 'label1', ...}"
 * Detects duplicate IDs, missing IDs, and format errors.
 */
export function parseNamesDict(namesStr: string): {
  names: Record<number, string>;
  duplicateIds: number[];
  ids: number[];
} {
  const trimmed = namesStr.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error('Malformed names metadata: missing surrounding curly braces');
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return { names: {}, duplicateIds: [], ids: [] };
  }

  const entryRegex = /(\d+)\s*:\s*(?:'([^']*)'|"([^"]*)")/g;
  const names: Record<number, string> = {};
  const duplicateIds: number[] = [];
  const ids: number[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(inner)) !== null) {
    const id = parseInt(match[1], 10);
    const label = match[2] !== undefined ? match[2] : match[3];

    if (seen.has(id)) {
      duplicateIds.push(id);
    } else {
      seen.add(id);
      ids.push(id);
    }
    names[id] = label;
  }

  ids.sort((a, b) => a - b);
  return { names, duplicateIds, ids };
}

/**
 * Pure fail-closed validation function for inspection results.
 */
export function validateInspectionResult(res: ModelInspectionResult): {
  passed: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!res.file.exists) {
    errors.push(`Model file does not exist: ${res.file.path}`);
    return { passed: false, errors };
  }

  if (res.file.sha256.toLowerCase() !== res.expected.sha256.toLowerCase()) {
    errors.push(
      `SHA-256 mismatch: observed ${res.file.sha256} vs expected ${res.expected.sha256}`,
    );
  }

  if (!res.observed.sessionCreated) {
    errors.push('Failed to create ONNX inference session via onnxruntime-node');
  }

  // Input metadata validation
  const inMeta = res.observed.inputMetadata;
  if (!inMeta) {
    errors.push('Input metadata is unavailable from session');
  } else {
    if (inMeta.name !== res.expected.inputName) {
      errors.push(`Input name mismatch: observed '${inMeta.name}' vs expected '${res.expected.inputName}'`);
    }
    if (inMeta.type !== res.expected.inputType) {
      errors.push(`Input type mismatch: observed '${inMeta.type}' vs expected '${res.expected.inputType}'`);
    }
    if (JSON.stringify(inMeta.shape) !== JSON.stringify(res.expected.inputShape)) {
      errors.push(
        `Input shape mismatch: observed [${inMeta.shape.join(', ')}] vs expected [${res.expected.inputShape.join(', ')}]`,
      );
    }
  }

  // Output metadata validation
  const outMeta = res.observed.outputMetadata;
  if (!outMeta) {
    errors.push('Output metadata is unavailable from session');
  } else {
    if (outMeta.name !== res.expected.outputName) {
      errors.push(`Output name mismatch: observed '${outMeta.name}' vs expected '${res.expected.outputName}'`);
    }
    if (outMeta.type !== res.expected.outputType) {
      errors.push(`Output type mismatch: observed '${outMeta.type}' vs expected '${res.expected.outputType}'`);
    }
    if (JSON.stringify(outMeta.shape) !== JSON.stringify(res.expected.outputShape)) {
      errors.push(
        `Output shape mismatch: observed [${outMeta.shape.join(', ')}] vs expected [${res.expected.outputShape.join(', ')}]`,
      );
    }
  }

  // Actual inference validation
  const inf = res.observed.inference;
  if (!inf) {
    errors.push('Actual inference execution did not produce results');
  } else {
    if (!inf.success) {
      errors.push('Inference execution failed');
    }
    if (inf.outputType !== res.expected.outputType) {
      errors.push(`Inference tensor type mismatch: observed '${inf.outputType}' vs expected '${res.expected.outputType}'`);
    }
    if (JSON.stringify(inf.outputDims) !== JSON.stringify(res.expected.outputShape)) {
      errors.push(
        `Inference tensor dims mismatch: observed [${inf.outputDims.join(', ')}] vs expected [${res.expected.outputShape.join(', ')}]`,
      );
    }
    if (inf.outputLength !== res.expected.outputLength) {
      errors.push(
        `Inference output length mismatch: observed ${inf.outputLength} vs expected ${res.expected.outputLength}`,
      );
    }
    if (!inf.allFinite) {
      errors.push('Inference output tensor contains non-finite values (NaN or Infinity)');
    }
  }

  // Metadata properties validation
  const meta = res.observed.metadataProps;
  if (!meta.found) {
    errors.push("Custom metadata property 'names' not found in ONNX ModelProto");
  } else {
    if (meta.rawNamesCount !== res.expected.classCount) {
      errors.push(
        `Metadata class count mismatch: observed ${meta.rawNamesCount} vs expected ${res.expected.classCount}`,
      );
    }
    if (meta.duplicateIds.length > 0) {
      errors.push(`Duplicate class IDs detected in metadata: ${meta.duplicateIds.join(', ')}`);
    }
    if (meta.missingIds.length > 0) {
      errors.push(`Missing class IDs in 0..${res.expected.classCount - 1} range: ${meta.missingIds.join(', ')}`);
    }
    if (meta.extraIds.length > 0) {
      errors.push(`Extra class IDs outside 0..${res.expected.classCount - 1} range: ${meta.extraIds.join(', ')}`);
    }
    if (meta.class0Label !== res.expected.class0Label) {
      errors.push(
        `Class 0 label mismatch: observed '${meta.class0Label}' vs expected '${res.expected.class0Label}'`,
      );
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Perform comprehensive inspection of the target ONNX model.
 */
export async function inspectModel(targetPath: string = MODEL_PATH): Promise<ModelInspectionResult> {
  const expected = {
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
    expectedRange: [0, EXPECTED_CLASS_COUNT - 1] as [number, number],
  };

  if (!fs.existsSync(targetPath)) {
    const baseResult: ModelInspectionResult = {
      file: {
        exists: false,
        path: targetPath,
        sizeBytes: 0,
        sha256: '',
      },
      observed: {
        sessionCreated: false,
        inputNames: [],
        outputNames: [],
        inputMetadata: null,
        outputMetadata: null,
        inference: null,
        metadataProps: {
          found: false,
          rawNamesCount: 0,
          ids: [],
          class0Label: '',
          class202Label: '',
          duplicateIds: [],
          missingIds: [],
          extraIds: [],
        },
      },
      expected,
      validation: {
        passed: false,
        errors: [`Model file not found at ${targetPath}`],
      },
    };
    return baseResult;
  }

  const fileBytes = fs.readFileSync(targetPath);
  const sizeBytes = fileBytes.length;
  const actualSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');

  // Extract ONNX protobuf metadata
  const onnxMeta = parseOnnxMetadataProps(fileBytes);
  const namesStr = onnxMeta['names'];
  let metadataProps = {
    found: Boolean(namesStr),
    rawNamesCount: 0,
    ids: [] as number[],
    class0Label: '',
    class202Label: '',
    duplicateIds: [] as number[],
    missingIds: [] as number[],
    extraIds: [] as number[],
  };

  if (namesStr) {
    const { names, duplicateIds, ids } = parseNamesDict(namesStr);
    const missingIds: number[] = [];
    const extraIds: number[] = [];

    for (let i = 0; i < EXPECTED_CLASS_COUNT; i++) {
      if (!(i in names)) missingIds.push(i);
    }
    for (const id of ids) {
      if (id < 0 || id >= EXPECTED_CLASS_COUNT) extraIds.push(id);
    }

    metadataProps = {
      found: true,
      rawNamesCount: ids.length,
      ids,
      class0Label: names[0] || '',
      class202Label: names[202] || '',
      duplicateIds,
      missingIds,
      extraIds,
    };
  }

  let session: ort.InferenceSession | null = null;
  let sessionCreated = false;
  let observedInputMeta: { name: string; type: string; isTensor: boolean; shape: number[] } | null = null;
  let observedOutputMeta: { name: string; type: string; isTensor: boolean; shape: number[] } | null = null;
  let observedInference: {
    success: boolean;
    outputName: string;
    outputType: string;
    outputDims: number[];
    outputLength: number;
    allFinite: boolean;
  } | null = null;

  try {
    session = await ort.InferenceSession.create(targetPath, {
      executionProviders: ['cpu'],
      logSeverityLevel: 3,
    });
    sessionCreated = true;

    // Public API metadata
    const inMetaArr = session.inputMetadata;
    if (inMetaArr && inMetaArr.length > 0) {
      const im = inMetaArr[0] as any;
      observedInputMeta = {
        name: im.name,
        type: im.type,
        isTensor: Boolean(im.isTensor),
        shape: Array.from(im.shape || []),
      };
    }

    const outMetaArr = session.outputMetadata;
    if (outMetaArr && outMetaArr.length > 0) {
      const om = outMetaArr[0] as any;
      observedOutputMeta = {
        name: om.name,
        type: om.type,
        isTensor: Boolean(om.isTensor),
        shape: Array.from(om.shape || []),
      };
    }

    // Actual dummy inference execution
    const inputName = session.inputNames[0];
    const inputBuffer = new Float32Array(1 * 3 * EXPECTED_INPUT_SIZE * EXPECTED_INPUT_SIZE);
    const inputTensor = new ort.Tensor('float32', inputBuffer, [
      1,
      3,
      EXPECTED_INPUT_SIZE,
      EXPECTED_INPUT_SIZE,
    ]);

    const results = await session.run({ [inputName]: inputTensor });
    const outputName = session.outputNames[0];
    const outputTensor = results[outputName];
    const outputData = outputTensor.data as Float32Array;

    let allFinite = true;
    for (let i = 0; i < outputData.length; i++) {
      if (!Number.isFinite(outputData[i])) {
        allFinite = false;
        break;
      }
    }

    observedInference = {
      success: true,
      outputName,
      outputType: outputTensor.type,
      outputDims: Array.from(outputTensor.dims).map(Number),
      outputLength: outputData.length,
      allFinite,
    };
  } finally {
    if (session && typeof session.release === 'function') {
      try {
        await session.release();
      } catch {
        // Ignored in cleanup
      }
    }
  }

  const result: ModelInspectionResult = {
    file: {
      exists: true,
      path: targetPath,
      sizeBytes,
      sha256: actualSha256,
    },
    observed: {
      sessionCreated,
      inputNames: session ? Array.from(session.inputNames) : [],
      outputNames: session ? Array.from(session.outputNames) : [],
      inputMetadata: observedInputMeta,
      outputMetadata: observedOutputMeta,
      inference: observedInference,
      metadataProps,
    },
    expected,
    validation: {
      passed: false,
      errors: [],
    },
  };

  result.validation = validateInspectionResult(result);
  return result;
}

async function main() {
  const isJson = process.argv.includes('--json');

  try {
    const result = await inspectModel(MODEL_PATH);

    if (isJson) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.file.exists) {
        process.stderr.write(`Model file not found: ${MODEL_PATH}\n`);
        process.exit(2);
      }
      if (!result.validation.passed) {
        process.stderr.write(`Validation failed:\n${result.validation.errors.join('\n')}\n`);
        process.exit(1);
      }
      process.exit(0);
    }

    // Human-readable report
    console.log('🔍 YOLO v203 Model Inspection & Contract Report');
    console.log('==============================================');
    console.log(`Path           : ${result.file.path}`);
    console.log(`Exists         : ${result.file.exists}`);
    console.log(`Size           : ${(result.file.sizeBytes / (1024 * 1024)).toFixed(2)} MB (${result.file.sizeBytes} bytes)`);
    console.log(`SHA-256        : ${result.file.sha256}`);
    console.log('');
    console.log('📥 OBSERVED INPUT METADATA');
    console.log('--------------------------');
    console.log(`Name           : ${result.observed.inputMetadata?.name}`);
    console.log(`Type           : ${result.observed.inputMetadata?.type}`);
    console.log(`Shape          : [${result.observed.inputMetadata?.shape.join(', ')}]`);
    console.log('');
    console.log('📤 OBSERVED OUTPUT METADATA');
    console.log('---------------------------');
    console.log(`Name           : ${result.observed.outputMetadata?.name}`);
    console.log(`Type           : ${result.observed.outputMetadata?.type}`);
    console.log(`Shape          : [${result.observed.outputMetadata?.shape.join(', ')}]`);
    console.log('');
    console.log('🔬 OBSERVED INFERENCE');
    console.log('--------------------');
    console.log(`Output Dims    : [${result.observed.inference?.outputDims.join(', ')}]`);
    console.log(`Output Type    : ${result.observed.inference?.outputType}`);
    console.log(`Output Length  : ${result.observed.inference?.outputLength.toLocaleString()} elements`);
    console.log(`All Finite     : ${result.observed.inference?.allFinite}`);
    console.log('');
    console.log('📋 OBSERVED METADATA (names)');
    console.log('----------------------------');
    console.log(`Raw Names Count: ${result.observed.metadataProps.rawNamesCount}`);
    console.log(`Class 0        : ${result.observed.metadataProps.class0Label}`);
    console.log(`Class 202      : ${result.observed.metadataProps.class202Label}`);
    console.log(`Missing IDs    : ${result.observed.metadataProps.missingIds.length}`);
    console.log(`Duplicate IDs  : ${result.observed.metadataProps.duplicateIds.length}`);
    console.log('==============================================');

    if (result.validation.passed) {
      console.log('✅ CONTRACT VALIDATION: PASSED (all observed values match expected)');
      process.exit(0);
    } else {
      console.error('❌ CONTRACT VALIDATION: FAILED');
      for (const err of result.validation.errors) {
        console.error(`   - ${err}`);
      }
      process.exit(1);
    }
  } catch (err: any) {
    if (isJson) {
      process.stderr.write(`Fatal error: ${err.message}\n`);
    } else {
      console.error(`❌ Fatal inspection failure: ${err.message}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
