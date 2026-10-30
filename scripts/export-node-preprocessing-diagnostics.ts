#!/usr/bin/env tsx
/**
 * Export Node.js Preprocessing Diagnostic Artifacts for YOLO v203
 *
 * Exports intermediate preprocessing buffers and raw ONNX model outputs
 * using actual application preprocessing code for the resized fixture (1600x1001).
 *
 * Output directory: fixtures/diagnostics/node/
 * Artifacts:
 *   - decoded_rgb_uint8.bin          [1001, 1600, 3] uint8
 *   - resized_rgb_uint8.bin          [641, 1024, 3] uint8
 *   - final_tensor_float32_nchw.bin  [1, 3, 1024, 1024] float32
 *   - raw_output_float32.bin         [1, 207, 21504] float32
 *   - manifest.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  preprocessForYolo,
  computeLetterboxMeta,
} from '../lib/detection/yolo/yolo-preprocessing';
import {
  getYoloV203Session,
  DEFAULT_V203_MODEL_PATH,
} from '../lib/detection/yolo/yolo-inference-v203';
import {
  YOLO_V203_INPUT_SIZE,
} from '../lib/detection/yolo/yolo-class-map-v203';

const MODEL_PATH = DEFAULT_V203_MODEL_PATH;
const FIXTURE_PATH = path.resolve(process.cwd(), 'fixtures/Sheet_1-1__crop_1600x1001.png');
const OUTPUT_DIR = path.resolve(process.cwd(), 'fixtures/diagnostics/node');

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function computeFileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  console.log('🔬 Running Node.js Preprocessing Diagnostics Exporter...');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!fs.existsSync(FIXTURE_PATH)) {
    console.error(`❌ Fixture not found: ${FIXTURE_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`❌ Model not found: ${MODEL_PATH}`);
    process.exit(1);
  }

  const modelFileSha = computeFileSha256(MODEL_PATH);
  const fixtureFileSha = computeFileSha256(FIXTURE_PATH);
  const fixtureBuffer = fs.readFileSync(FIXTURE_PATH);

  // 1. Decode raw RGB
  const decodedBuffer = await sharp(fixtureBuffer)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const decodedRawBytes = decodedBuffer.data;
  const decodedSha = computeSha256(decodedRawBytes);
  const decodedPath = path.join(OUTPUT_DIR, 'decoded_rgb_uint8.bin');
  fs.writeFileSync(decodedPath, decodedRawBytes);

  // 2. Resize raw RGB
  const meta = computeLetterboxMeta(decodedBuffer.info.width, decodedBuffer.info.height, YOLO_V203_INPUT_SIZE);
  const scaledW = Math.max(1, Math.round(decodedBuffer.info.width * meta.scale));
  const scaledH = Math.max(1, Math.round(decodedBuffer.info.height * meta.scale));

  const resizedBuffer = await sharp(fixtureBuffer)
    .resize(scaledW, scaledH, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const resizedRawBytes = resizedBuffer.data;
  const resizedSha = computeSha256(resizedRawBytes);
  const resizedPath = path.join(OUTPUT_DIR, 'resized_rgb_uint8.bin');
  fs.writeFileSync(resizedPath, resizedRawBytes);

  // 3. Final Tensor via actual preprocessForYolo
  const preprocessResult = await preprocessForYolo(fixtureBuffer, YOLO_V203_INPUT_SIZE);
  const tensorFloat32 = preprocessResult.tensor;
  const tensorBytes = Buffer.from(tensorFloat32.buffer, tensorFloat32.byteOffset, tensorFloat32.byteLength);
  const tensorSha = computeSha256(tensorBytes);
  const tensorPath = path.join(OUTPUT_DIR, 'final_tensor_float32_nchw.bin');
  fs.writeFileSync(tensorPath, tensorBytes);

  // 4. ONNX Runtime Execution (Node CPU)
  const session = await getYoloV203Session(MODEL_PATH);
  const inputName = session.inputNames[0] || 'images';
  const feeds: Record<string, ort.Tensor> = {
    [inputName]: new ort.Tensor('float32', tensorFloat32, [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE]),
  };
  const results = await session.run(feeds);
  const outputName = session.outputNames[0] || 'output0';
  const outputTensor = results[outputName];
  const outputFloat32 = outputTensor.data as Float32Array;
  const outputBytes = Buffer.from(outputFloat32.buffer, outputFloat32.byteOffset, outputFloat32.byteLength);
  const outputSha = computeSha256(outputBytes);
  const outputPath = path.join(OUTPUT_DIR, 'raw_output_float32.bin');
  fs.writeFileSync(outputPath, outputBytes);

  const manifest = {
    generator: 'scripts/export-node-preprocessing-diagnostics.ts',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      sharpVersion: sharp.versions.sharp,
      vipsVersion: sharp.versions.vips,
      onnxruntimeVersion: '1.20.1', // onnxruntime-node version
      executionProvider: 'CPUExecutionProvider',
    },
    model: {
      path: MODEL_PATH,
      sha256: modelFileSha,
    },
    fixture: {
      path: FIXTURE_PATH,
      sha256: fixtureFileSha,
      dimensions: [decodedBuffer.info.width, decodedBuffer.info.height],
    },
    letterboxGeometry: {
      scale: meta.scale,
      scaledWidth: scaledW,
      scaledHeight: scaledH,
      padX: meta.padX,
      padY: meta.padY,
      bottomPad: YOLO_V203_INPUT_SIZE - scaledH - meta.padY,
      rightPad: YOLO_V203_INPUT_SIZE - scaledW - meta.padX,
      padValue: 114,
    },
    resizeOptions: {
      library: 'sharp (libvips)',
      kernel: 'default (lanczos3 / cubic)',
      exactCall: `sharp(source).resize(${scaledW}, ${scaledH}, { fit: 'fill' })`,
    },
    artifacts: {
      decodedRgb: {
        file: 'decoded_rgb_uint8.bin',
        dtype: 'uint8',
        shape: [decodedBuffer.info.height, decodedBuffer.info.width, 3],
        byteLength: decodedRawBytes.length,
        sha256: decodedSha,
      },
      resizedRgb: {
        file: 'resized_rgb_uint8.bin',
        dtype: 'uint8',
        shape: [resizedBuffer.info.height, resizedBuffer.info.width, 3],
        byteLength: resizedRawBytes.length,
        sha256: resizedSha,
      },
      finalTensor: {
        file: 'final_tensor_float32_nchw.bin',
        dtype: 'float32',
        layout: 'NCHW',
        byteOrder: 'little-endian',
        shape: [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE],
        byteLength: tensorBytes.length,
        sha256: tensorSha,
      },
      rawOutput: {
        file: 'raw_output_float32.bin',
        dtype: 'float32',
        shape: [1, 207, 21504],
        byteLength: outputBytes.length,
        sha256: outputSha,
      },
    },
  };

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('✅ Node.js diagnostic artifacts exported successfully:');
  console.log(`   Decoded RGB : ${decodedPath} (${decodedRawBytes.length} B, SHA: ${decodedSha.substring(0, 16)}...)`);
  console.log(`   Resized RGB : ${resizedPath} (${resizedRawBytes.length} B, SHA: ${resizedSha.substring(0, 16)}...)`);
  console.log(`   Final Tensor: ${tensorPath} (${tensorBytes.length} B, SHA: ${tensorSha.substring(0, 16)}...)`);
  console.log(`   Raw Output  : ${outputPath} (${outputBytes.length} B, SHA: ${outputSha.substring(0, 16)}...)`);
  console.log(`   Manifest    : ${manifestPath}`);
}

main().catch((err) => {
  console.error('Fatal error exporting Node diagnostics:', err);
  process.exit(1);
});
