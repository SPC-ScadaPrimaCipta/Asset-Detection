#!/usr/bin/env tsx
/**
 * Comprehensive Preprocessing Parity Diagnostic Engine (Phase 2)
 *
 * Compares Python (OpenCV) and Node (Sharp) preprocessing byte-for-byte,
 * measures runtime isolation on identical inputs, and analyzes candidate transitions at threshold >= 0.30.
 *
 * Output: fixtures/diagnostics/report/preprocessing-diagnostic-report.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  getYoloV203Session,
  DEFAULT_V203_MODEL_PATH,
} from '../lib/detection/yolo/yolo-inference-v203';
import {
  decodeAndFilterV203,
  valueAtV203,
  type YoloV203Detection,
} from '../lib/detection/yolo/yolo-decoder-v203';
import {
  computeLetterboxMeta,
} from '../lib/detection/yolo/yolo-preprocessing';
import {
  YOLO_V203_INPUT_SIZE,
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
} from '../lib/detection/yolo/yolo-class-map-v203';
import {
  solveGeometricBipartiteMatching,
} from './verify-parity-v203';

const PY_DIR = path.resolve(process.cwd(), 'fixtures/diagnostics/python');
const NODE_DIR = path.resolve(process.cwd(), 'fixtures/diagnostics/node');
const REPORT_DIR = path.resolve(process.cwd(), 'fixtures/diagnostics/report');

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

interface BufferDiffStats {
  stage: string;
  pySha256: string;
  nodeSha256: string;
  byteLength: number;
  elementCount: number;
  differingCount: number;
  differingPercentage: number;
  maxAbsDiff: number;
  meanAbsDiff: number;
  sampleDiffs: Array<{
    index: number;
    coord: string;
    pyValue: number;
    nodeValue: number;
    absDiff: number;
  }>;
}

function compareUint8Buffers(
  stage: string,
  pyBuf: Buffer,
  nodeBuf: Buffer,
  width: number,
  height: number,
  channels = 3,
): BufferDiffStats {
  if (pyBuf.length !== nodeBuf.length) {
    throw new Error(`Length mismatch for ${stage}: py=${pyBuf.length}, node=${nodeBuf.length}`);
  }

  const length = pyBuf.length;
  let differingCount = 0;
  let maxAbsDiff = 0;
  let sumAbsDiff = 0;
  const sampleDiffs: BufferDiffStats['sampleDiffs'] = [];

  for (let i = 0; i < length; i++) {
    const pyVal = pyBuf[i];
    const nodeVal = nodeBuf[i];
    const diff = Math.abs(pyVal - nodeVal);

    if (diff > 0) {
      differingCount++;
      sumAbsDiff += diff;
      if (diff > maxAbsDiff) {
        maxAbsDiff = diff;
      }

      if (sampleDiffs.length < 5 || diff === maxAbsDiff) {
        const pixelIdx = Math.floor(i / channels);
        const c = i % channels;
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);
        const cName = c === 0 ? 'R' : c === 1 ? 'G' : 'B';

        if (sampleDiffs.length < 5) {
          sampleDiffs.push({
            index: i,
            coord: `(x=${x}, y=${y}, ch=${cName})`,
            pyValue: pyVal,
            nodeValue: nodeVal,
            absDiff: diff,
          });
        }
      }
    }
  }

  return {
    stage,
    pySha256: computeSha256(pyBuf),
    nodeSha256: computeSha256(nodeBuf),
    byteLength: length,
    elementCount: length,
    differingCount,
    differingPercentage: (differingCount / length) * 100,
    maxAbsDiff,
    meanAbsDiff: length > 0 ? sumAbsDiff / length : 0,
    sampleDiffs,
  };
}

function compareFloat32Arrays(
  stage: string,
  pyArr: Float32Array,
  nodeArr: Float32Array,
): BufferDiffStats {
  if (pyArr.length !== nodeArr.length) {
    throw new Error(`Length mismatch for ${stage}: py=${pyArr.length}, node=${nodeArr.length}`);
  }

  const length = pyArr.length;
  let differingCount = 0;
  let maxAbsDiff = 0;
  let sumAbsDiff = 0;
  const sampleDiffs: BufferDiffStats['sampleDiffs'] = [];

  for (let i = 0; i < length; i++) {
    const pyVal = pyArr[i];
    const nodeVal = nodeArr[i];
    const diff = Math.abs(pyVal - nodeVal);

    if (diff > 1e-7) {
      differingCount++;
      sumAbsDiff += diff;
      if (diff > maxAbsDiff) {
        maxAbsDiff = diff;
      }

      if (sampleDiffs.length < 5) {
        sampleDiffs.push({
          index: i,
          coord: `index=${i}`,
          pyValue: pyVal,
          nodeValue: nodeVal,
          absDiff: diff,
        });
      }
    }
  }

  const pyBuf = Buffer.from(pyArr.buffer, pyArr.byteOffset, pyArr.byteLength);
  const nodeBuf = Buffer.from(nodeArr.buffer, nodeArr.byteOffset, nodeArr.byteLength);

  return {
    stage,
    pySha256: computeSha256(pyBuf),
    nodeSha256: computeSha256(nodeBuf),
    byteLength: pyBuf.length,
    elementCount: length,
    differingCount,
    differingPercentage: (differingCount / length) * 100,
    maxAbsDiff,
    meanAbsDiff: length > 0 ? sumAbsDiff / length : 0,
    sampleDiffs,
  };
}

export async function runDiagnostics() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  console.log('🔍 Executing YOLO v203 Preprocessing Diagnostics...');

  // 1. Load manifests
  const pyManifest = JSON.parse(fs.readFileSync(path.join(PY_DIR, 'manifest.json'), 'utf8'));
  const nodeManifest = JSON.parse(fs.readFileSync(path.join(NODE_DIR, 'manifest.json'), 'utf8'));

  // 2. Compare Decoded RGB [1001, 1600, 3]
  const pyDecoded = fs.readFileSync(path.join(PY_DIR, 'decoded_rgb_uint8.bin'));
  const nodeDecoded = fs.readFileSync(path.join(NODE_DIR, 'decoded_rgb_uint8.bin'));
  const decodedStats = compareUint8Buffers('Decoded RGB (1600x1001)', pyDecoded, nodeDecoded, 1600, 1001);

  // 3. Compare Resized RGB [641, 1024, 3]
  const pyResized = fs.readFileSync(path.join(PY_DIR, 'resized_rgb_uint8.bin'));
  const nodeResized = fs.readFileSync(path.join(NODE_DIR, 'resized_rgb_uint8.bin'));
  const resizedStats = compareUint8Buffers('Resized RGB (1024x641)', pyResized, nodeResized, 1024, 641);

  // 4. Compare Final Float32 Tensor [1, 3, 1024, 1024]
  const pyTensorBuf = fs.readFileSync(path.join(PY_DIR, 'final_tensor_float32_nchw.bin'));
  const nodeTensorBuf = fs.readFileSync(path.join(NODE_DIR, 'final_tensor_float32_nchw.bin'));
  const pyTensor = new Float32Array(pyTensorBuf.buffer, pyTensorBuf.byteOffset, pyTensorBuf.byteLength / 4);
  const nodeTensor = new Float32Array(nodeTensorBuf.buffer, nodeTensorBuf.byteOffset, nodeTensorBuf.byteLength / 4);
  const tensorStats = compareFloat32Arrays('Final Float32 NCHW Tensor', pyTensor, nodeTensor);

  // 5. Compare Raw Output Tensor [1, 207, 21504]
  const pyRawBuf = fs.readFileSync(path.join(PY_DIR, 'raw_output_float32.bin'));
  const nodeRawBuf = fs.readFileSync(path.join(NODE_DIR, 'raw_output_float32.bin'));
  const pyRawOutput = new Float32Array(pyRawBuf.buffer, pyRawBuf.byteOffset, pyRawBuf.byteLength / 4);
  const nodeRawOutput = new Float32Array(nodeRawBuf.buffer, nodeRawBuf.byteOffset, nodeRawBuf.byteLength / 4);
  const rawOutputStats = compareFloat32Arrays('Raw Model Output [1, 207, 21504]', pyRawOutput, nodeRawOutput);

  // 6. Runtime Isolation Test: Run Python Tensor on Node ONNX Runtime Session
  const session = await getYoloV203Session(DEFAULT_V203_MODEL_PATH);
  const inputName = session.inputNames[0] || 'images';
  const feeds: Record<string, ort.Tensor> = {
    [inputName]: new ort.Tensor('float32', pyTensor, [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE]),
  };
  const results = await session.run(feeds);
  const outputName = session.outputNames[0] || 'output0';
  const nodeRawOnPyTensor = results[outputName].data as Float32Array;

  // Compare Node raw output on Py tensor vs Python raw output
  const isolationStats = compareFloat32Arrays(
    'Runtime Isolation (Node CPU vs Python CPU on Identical Py Tensor)',
    pyRawOutput,
    nodeRawOnPyTensor,
  );

  // Compare BBox channels (0..3) and Score channels (4..206) separately in isolation
  let bboxMaxDelta = 0;
  let bboxSumDelta = 0;
  let scoreMaxDelta = 0;
  let scoreSumDelta = 0;

  const totalCandidates = YOLO_V203_CANDIDATE_COUNT;
  for (let i = 0; i < totalCandidates; i++) {
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(valueAtV203(pyRawOutput, c, i) - valueAtV203(nodeRawOnPyTensor, c, i));
      if (d > bboxMaxDelta) bboxMaxDelta = d;
      bboxSumDelta += d;
    }
    for (let c = 4; c < 207; c++) {
      const d = Math.abs(valueAtV203(pyRawOutput, c, i) - valueAtV203(nodeRawOnPyTensor, c, i));
      if (d > scoreMaxDelta) scoreMaxDelta = d;
      scoreSumDelta += d;
    }
  }

  // Decode isolation output
  const meta1600 = computeLetterboxMeta(1600, 1001, YOLO_V203_INPUT_SIZE);
  const decodeConfig = { confidenceThreshold: 0.50, nmsIouThreshold: 0.70, maxDetections: 300 };
  const isolationDetections = decodeAndFilterV203(nodeRawOnPyTensor, meta1600, decodeConfig);

  // Load Python reference detections for 1600x1001
  const pyRefJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'fixtures/reference/yolo-v203-python-reference.json'), 'utf8'),
  );
  const pyRef1600 = pyRefJson.fixtures.nonSquareResize.detections;

  // 7. Threshold Diagnostic Analysis (Candidates with confidence >= 0.30)
  interface SubthresholdCandidate {
    anchorIndex: number;
    rawClassId: number;
    scorePy: number;
    scoreNode: number;
    scoreDelta: number;
    pyBox: [number, number, number, number];
    nodeBox: [number, number, number, number];
  }

  const subthresholdCandidates: SubthresholdCandidate[] = [];
  for (let i = 0; i < totalCandidates; i++) {
    let bestPyClass = -1;
    let bestPyScore = 0;
    let bestNodeClass = -1;
    let bestNodeScore = 0;

    for (let c = 0; c < 203; c++) {
      const pScore = valueAtV203(pyRawOutput, YOLO_V203_CLASS_CHANNEL_OFFSET + c, i);
      const nScore = valueAtV203(nodeRawOutput, YOLO_V203_CLASS_CHANNEL_OFFSET + c, i);
      if (pScore > bestPyScore) {
        bestPyScore = pScore;
        bestPyClass = c;
      }
      if (nScore > bestNodeScore) {
        bestNodeScore = nScore;
        bestNodeClass = c;
      }
    }

    if (bestPyScore >= 0.30 || bestNodeScore >= 0.30) {
      const pcx = valueAtV203(pyRawOutput, 0, i);
      const pcy = valueAtV203(pyRawOutput, 1, i);
      const pw = valueAtV203(pyRawOutput, 2, i);
      const ph = valueAtV203(pyRawOutput, 3, i);

      const ncx = valueAtV203(nodeRawOutput, 0, i);
      const ncy = valueAtV203(nodeRawOutput, 1, i);
      const nw = valueAtV203(nodeRawOutput, 2, i);
      const nh = valueAtV203(nodeRawOutput, 3, i);

      subthresholdCandidates.push({
        anchorIndex: i,
        rawClassId: bestPyClass >= 0 ? bestPyClass : bestNodeClass,
        scorePy: bestPyScore,
        scoreNode: bestNodeScore,
        scoreDelta: Math.abs(bestPyScore - bestNodeScore),
        pyBox: [pcx - pw / 2, pcy - ph / 2, pcx + pw / 2, pcy + ph / 2],
        nodeBox: [ncx - nw / 2, ncy - nh / 2, ncx + nw / 2, ncy + nh / 2],
      });
    }
  }

  subthresholdCandidates.sort((a, b) => b.scorePy - a.scorePy);

  // 8. Offline Sharp Configurations Experiment (Evaluating Available Kernels & Options)
  const fixturePath = path.resolve(process.cwd(), 'fixtures/Sheet_1-1__crop_1600x1001.png');
  const fixtureBuf = fs.readFileSync(fixturePath);
  const scaledW = 1024;
  const scaledH = 641;

  interface SharpConfigEval {
    name: string;
    kernel: string;
    fastShrinkOnLoad: boolean;
    preprocessTimeMs: number;
    resizedStats: BufferDiffStats;
    tensorStats: BufferDiffStats;
    detectionsCount: number;
    matchedCount: number;
    missingCount: number;
    extraCount: number;
    maxConfDelta: number;
    maxBboxDelta: number;
    strictAcceptance: 'PASSED' | 'PARITY_MISMATCH';
  }

  const sharpConfigs = [
    { name: '1. Existing Default (Lanczos3, fastShrink: true)', kernel: 'lanczos3', fastShrinkOnLoad: true, opts: { fit: 'fill' as const } },
    { name: '2. Linear (sharp.kernel.linear, fastShrink: true)', kernel: 'linear', fastShrinkOnLoad: true, opts: { fit: 'fill' as const, kernel: sharp.kernel.linear } },
    { name: '3. Linear (sharp.kernel.linear, fastShrink: false)', kernel: 'linear', fastShrinkOnLoad: false, opts: { fit: 'fill' as const, kernel: sharp.kernel.linear, fastShrinkOnLoad: false } },
    { name: '4. Cubic (sharp.kernel.cubic, fastShrink: false)', kernel: 'cubic', fastShrinkOnLoad: false, opts: { fit: 'fill' as const, kernel: sharp.kernel.cubic, fastShrinkOnLoad: false } },
    { name: '5. Mitchell (sharp.kernel.mitchell, fastShrink: false)', kernel: 'mitchell', fastShrinkOnLoad: false, opts: { fit: 'fill' as const, kernel: sharp.kernel.mitchell, fastShrinkOnLoad: false } },
    { name: '6. Nearest (sharp.kernel.nearest, fastShrink: false)', kernel: 'nearest', fastShrinkOnLoad: false, opts: { fit: 'fill' as const, kernel: sharp.kernel.nearest, fastShrinkOnLoad: false } },
  ];

  const sharpEvaluations: SharpConfigEval[] = [];

  for (const cfg of sharpConfigs) {
    const t0 = performance.now();
    const resResized = await sharp(fixtureBuf)
      .resize(scaledW, scaledH, cfg.opts)
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cfgResizedBuf = resResized.data;

    // Create 1024x1024 grey-padded canvas
    const canvas = new Uint8Array(1024 * 1024 * 3);
    canvas.fill(114);
    for (let row = 0; row < scaledH; row++) {
      const srcOff = row * scaledW * 3;
      const dstOff = ((row + meta1600.padY) * 1024 + meta1600.padX) * 3;
      canvas.set(cfgResizedBuf.subarray(srcOff, srcOff + scaledW * 3), dstOff);
    }

    // Convert to NCHW float32
    const cfgTensor = new Float32Array(3 * 1024 * 1024);
    const planeSize = 1024 * 1024;
    for (let p = 0; p < planeSize; p++) {
      cfgTensor[p] = canvas[p * 3] / 255.0;
      cfgTensor[planeSize + p] = canvas[p * 3 + 1] / 255.0;
      cfgTensor[2 * planeSize + p] = canvas[p * 3 + 2] / 255.0;
    }
    const tPreprocess = performance.now() - t0;

    // Compute diff stats
    const cfgResizedStats = compareUint8Buffers(`Resized (${cfg.name})`, pyResized, cfgResizedBuf, 1024, 641);
    const cfgTensorStats = compareFloat32Arrays(`Tensor (${cfg.name})`, pyTensor, cfgTensor);

    // Inference on this tensor
    const cfgFeeds: Record<string, ort.Tensor> = {
      [inputName]: new ort.Tensor('float32', cfgTensor, [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE]),
    };
    const cfgResults = await session.run(cfgFeeds);
    const cfgRawOutput = cfgResults[outputName].data as Float32Array;

    // Decode detections
    const cfgDetections = decodeAndFilterV203(cfgRawOutput, meta1600, decodeConfig);

    // Match with Python reference
    const pyItems = pyRef1600.map((p: { score: number; bbox: number[]; rawClassId: number }, idx: number) => ({ index: idx, score: p.score, bbox: p.bbox, rawClassId: p.rawClassId }));
    const nodeItems = cfgDetections.map((n: any, idx: number) => ({
      index: idx,
      score: n.confidence,
      bbox: [n.pixelBox.x1, n.pixelBox.y1, n.pixelBox.x2, n.pixelBox.y2] as [number, number, number, number],
      rawClassId: n.rawClassId,
    }));

    const classIds = Array.from(new Set([...pyItems.map((p: { rawClassId: number }) => p.rawClassId), ...nodeItems.map((n: { rawClassId: number }) => n.rawClassId)]));
    let matchedCount = 0;
    let missingCount = 0;
    let extraCount = 0;
    let maxConfDelta = 0;
    let maxBboxDelta = 0;

    for (const cId of classIds) {
      const pGroup = pyItems.filter((p: { rawClassId: number }) => p.rawClassId === cId);
      const nGroup = nodeItems.filter((n: { rawClassId: number }) => n.rawClassId === cId);
      const matchRes = solveGeometricBipartiteMatching(pGroup, nGroup);
      matchedCount += matchRes.matchedPairs.length;
      missingCount += matchRes.unmatchedPyIndices.length;
      extraCount += matchRes.unmatchedNodeIndices.length;

      for (const pair of matchRes.matchedPairs) {
        const pDet = pyRef1600[pair.pyIndex];
        const nDet = cfgDetections[pair.nodeIndex];
        const cDelta = Math.abs(pDet.score - nDet.confidence);
        if (cDelta > maxConfDelta) maxConfDelta = cDelta;
        const bDelta = Math.max(
          Math.abs(pDet.bbox[0] - nDet.pixelBox.x1),
          Math.abs(pDet.bbox[1] - nDet.pixelBox.y1),
          Math.abs(pDet.bbox[2] - nDet.pixelBox.x2),
          Math.abs(pDet.bbox[3] - nDet.pixelBox.y2),
        );
        if (bDelta > maxBboxDelta) maxBboxDelta = bDelta;
      }
    }

    const isStrictPassed = missingCount === 0 && extraCount === 0 && maxConfDelta <= 1e-4 && maxBboxDelta <= 0.5;

    sharpEvaluations.push({
      name: cfg.name,
      kernel: cfg.kernel,
      fastShrinkOnLoad: cfg.fastShrinkOnLoad,
      preprocessTimeMs: tPreprocess,
      resizedStats: cfgResizedStats,
      tensorStats: cfgTensorStats,
      detectionsCount: cfgDetections.length,
      matchedCount,
      missingCount,
      extraCount,
      maxConfDelta,
      maxBboxDelta,
      strictAcceptance: isStrictPassed ? 'PASSED' : 'PARITY_MISMATCH',
    });
  }

  const fullReport = {
    title: 'YOLO v203 Preprocessing & Runtime Parity Diagnostic Report',
    timestamp: new Date().toISOString(),
    environments: {
      python: pyManifest.environment,
      node: nodeManifest.environment,
    },
    resizeOptions: {
      python: pyManifest.resizeOptions,
      node: nodeManifest.resizeOptions,
    },
    stages: {
      decoded: decodedStats,
      resized: resizedStats,
      finalTensor: tensorStats,
      rawOutputOnRespectiveTensors: rawOutputStats,
    },
    runtimeIsolation: {
      stats: isolationStats,
      bboxChannels: {
        maxDelta: bboxMaxDelta,
        meanDelta: bboxSumDelta / (4 * totalCandidates),
      },
      classScoreChannels: {
        maxDelta: scoreMaxDelta,
        meanDelta: scoreSumDelta / (203 * totalCandidates),
      },
      decoderParityOnPyTensor: {
        pythonDetectionsCount: pyRef1600.length,
        nodeDetectionsOnPyTensorCount: isolationDetections.length,
        isBitExact: isolationDetections.length === pyRef1600.length && isolationStats.maxAbsDiff < 1e-4,
      },
    },
    subthresholdAnalysis: {
      candidateCountAbove030: subthresholdCandidates.length,
      topCandidates: subthresholdCandidates.slice(0, 10),
    },
    sharpConfigurationsEvaluation: sharpEvaluations,
  };

  const reportPath = path.join(REPORT_DIR, 'preprocessing-diagnostic-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));

  console.log('\n📊 PREPROCESSING DIAGNOSTIC RESULTS');
  console.log('====================================');
  console.log(`1. Decoded RGB (1600x1001):`);
  console.log(`   - Diff elements : ${decodedStats.differingCount} / ${decodedStats.elementCount} (${decodedStats.differingPercentage.toFixed(2)}%)`);
  console.log(`   - Max Abs Diff  : ${decodedStats.maxAbsDiff}`);
  console.log(`   - Mean Abs Diff : ${decodedStats.meanAbsDiff.toExponential(4)}`);
  console.log(`   - Status        : ${decodedStats.differingCount === 0 ? '✅ BIT-EXACT' : '⚠️ DIVERGENT'}`);

  console.log(`\n2. Resized RGB (1024x641):`);
  console.log(`   - Diff elements : ${resizedStats.differingCount} / ${resizedStats.elementCount} (${resizedStats.differingPercentage.toFixed(2)}%)`);
  console.log(`   - Max Abs Diff  : ${resizedStats.maxAbsDiff}`);
  console.log(`   - Mean Abs Diff : ${resizedStats.meanAbsDiff.toFixed(4)}`);
  console.log(`   - Top Samples   : ${resizedStats.sampleDiffs.map((s) => `${s.coord}: Py=${s.pyValue} Node=${s.nodeValue} Δ=${s.absDiff}`).join('; ')}`);

  console.log(`\n3. Final Float32 Tensor [1, 3, 1024, 1024]:`);
  console.log(`   - Diff elements : ${tensorStats.differingCount} / ${tensorStats.elementCount} (${tensorStats.differingPercentage.toFixed(2)}%)`);
  console.log(`   - Max Abs Diff  : ${tensorStats.maxAbsDiff.toFixed(6)}`);
  console.log(`   - Mean Abs Diff : ${tensorStats.meanAbsDiff.toFixed(6)}`);

  console.log(`\n4. Runtime Isolation (Node CPU vs Python CPU on Identical Py Tensor):`);
  console.log(`   - BBox Channels Max Δ  : ${bboxMaxDelta.toExponential(4)} (mean: ${(bboxSumDelta / (4 * totalCandidates)).toExponential(4)})`);
  console.log(`   - Score Channels Max Δ : ${scoreMaxDelta.toExponential(4)} (mean: ${(scoreSumDelta / (203 * totalCandidates)).toExponential(4)})`);
  console.log(`   - Python Detections    : ${pyRef1600.length}`);
  console.log(`   - Node Dets on PyTensor: ${isolationDetections.length}`);
  console.log(`   - Runtime Isolation    : ${isolationDetections.length === pyRef1600.length && bboxMaxDelta <= 1e-4 ? '✅ BIT-EXACT PARITY PROVEN' : '❌ ISOLATION FAILED'}`);

  console.log(`\n5. Offline Sharp Resize Configurations Evaluation:`);
  for (const s of sharpEvaluations) {
    console.log(`   [${s.name}]`);
    console.log(`     - Time: ${s.preprocessTimeMs.toFixed(2)}ms | Resized Diff: ${s.resizedStats.differingPercentage.toFixed(2)}% (MaxΔ: ${s.resizedStats.maxAbsDiff}, MeanΔ: ${s.resizedStats.meanAbsDiff.toFixed(4)})`);
    console.log(`     - Tensor Diff: ${s.tensorStats.differingPercentage.toFixed(2)}% (MaxΔ: ${s.tensorStats.maxAbsDiff.toFixed(4)}, MeanΔ: ${s.tensorStats.meanAbsDiff.toFixed(6)})`);
    console.log(`     - Detections: Py=${pyRef1600.length}, Node=${s.detectionsCount} (Matched: ${s.matchedCount}, Missing: ${s.missingCount}, Extra: ${s.extraCount})`);
    console.log(`     - Max Conf Δ: ${s.maxConfDelta.toFixed(4)}, Max Bbox Δ: ${s.maxBboxDelta.toFixed(2)}px | Status: ${s.strictAcceptance}`);
  }

  console.log('\n====================================');
  console.log(`Full diagnostic report written to: ${reportPath}`);

  return fullReport;
}

if (require.main === module) {
  runDiagnostics().catch((err) => {
    console.error('Fatal diagnostic error:', err);
    process.exit(1);
  });
}
