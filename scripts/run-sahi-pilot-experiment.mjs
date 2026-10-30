#!/usr/bin/env node
/**
 * Pilot Eksperimen SAHI (Slicing Aided Hyper Inference) — Node.js Implementation
 *
 * SCOPE & CONTRACT:
 *   - Menggunakan render 600 DPI existing: sheet-1-p1_600dpi_original.png (9925x7017 px).
 *   - Model existing: model/yolo-pid-v8n-203.onnx (input fixed [1, 3, 1024, 1024]).
 *   - Konfigurasi SAHI:
 *       slice_width: 1280, slice_height: 1280
 *       overlap_ratio: 0.20 (horizontal & vertikal)
 *       step_x: 1024, step_y: 1024
 *       model input: 1024x1024
 *       confidence_threshold: 0.50
 *       per_slice_nms: IoU 0.70, class-aware, cap 300
 *       cross_slice_postprocess: NMS, metric IOU, match_threshold 0.50, class_agnostic=false
 *       perform_standard_pred: false
 *       CPU execution, sekuensial, batch 1
 *   - Tanpa global merge kedua setelah postprocess SAHI.
 *   - Hitung jumlah slice aktual secara matematis (70 slice).
 *   - Bandingkan dengan GEO-2 asli (87) dan eksperimen 600 DPI existing (Exp B: 150) pada base coordinate space (3573x2526).
 *   - Tampilkan review per-lokasi 19 missing.
 *   - Seluruh keputusan manusia berstatus UNRESOLVED.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SOURCE_600DPI_PNG = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi/sheet-1-p1_600dpi_original.png',
);
const MODEL_PATH = path.join(REPO_ROOT, 'model/yolo-pid-v8n-203.onnx');
const NAMES_JSON_PATH = path.join(REPO_ROOT, 'model/yolo-v203-names.json');
const FULL_PAGE_HTML = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html',
);
const DENSE_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi/dense-600dpi-manifest.json',
);

const OUTPUT_DIR = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/sahi-pilot',
);
const CROPS_DIR = path.join(OUTPUT_DIR, 'crops');
const MISSING_CROPS_DIR = path.join(CROPS_DIR, 'missing-19');

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sampleMemory(stage) {
  const mem = process.memoryUsage();
  return {
    stage,
    timestamp: new Date().toISOString(),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    externalMb: Math.round(mem.external / (1024 * 1024)),
  };
}

function computeIoU(a, b) {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * SAHI Standard Slicing Grid Generator:
 * step = slice_dim * (1 - overlap_ratio)
 * Clamps edge slice to image boundary.
 */
function buildSahiSliceGrid(imageW, imageH, sliceW, sliceH, overlapRatioW = 0.20, overlapRatioH = 0.20) {
  const stepX = Math.floor(sliceW * (1.0 - overlapRatioW));
  const stepY = Math.floor(sliceH * (1.0 - overlapRatioH));

  const xOffsets = [];
  let currX = 0;
  while (currX + sliceW <= imageW) {
    xOffsets.push(currX);
    currX += stepX;
  }
  const lastX = imageW - sliceW;
  if (lastX > 0 && !xOffsets.includes(lastX)) {
    xOffsets.push(lastX);
  }
  xOffsets.sort((a, b) => a - b);

  const yOffsets = [];
  let currY = 0;
  while (currY + sliceH <= imageH) {
    yOffsets.push(currY);
    currY += stepY;
  }
  const lastY = imageH - sliceH;
  if (lastY > 0 && !yOffsets.includes(lastY)) {
    yOffsets.push(lastY);
  }
  yOffsets.sort((a, b) => a - b);

  const slices = [];
  let sliceIndex = 0;
  for (let r = 0; r < yOffsets.length; r++) {
    for (let c = 0; c < xOffsets.length; c++) {
      slices.push({
        sliceIndex,
        col: c,
        row: r,
        x: xOffsets[c],
        y: yOffsets[r],
        width: sliceW,
        height: sliceH,
      });
      sliceIndex++;
    }
  }

  return { sliceW, sliceH, stepX, stepY, xOffsets, yOffsets, slices };
}

/**
 * Extract slice from 600 DPI raw buffer and resize to 1024x1024 NCHW Float32Array
 */
async function extractSliceTensor(pageRgb, pageW, pageH, slice, onnxSize = 1024) {
  const extractW = Math.min(slice.width, pageW - slice.x);
  const extractH = Math.min(slice.height, pageH - slice.y);

  const sliceRgb = await sharp(Buffer.from(pageRgb.buffer, pageRgb.byteOffset, pageRgb.byteLength), {
    raw: { width: pageW, height: pageH, channels: 3 },
  })
    .extract({ left: slice.x, top: slice.y, width: extractW, height: extractH })
    .resize(onnxSize, onnxSize, { fit: 'fill' })
    .raw()
    .toBuffer();

  const planeSize = onnxSize * onnxSize;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = sliceRgb[i * 3] / 255.0;
    tensor[planeSize + i] = sliceRgb[i * 3 + 1] / 255.0;
    tensor[2 * planeSize + i] = sliceRgb[i * 3 + 2] / 255.0;
  }

  const scaleFactor = onnxSize / slice.width; // 1024 / 1280 = 0.8
  return { tensor, scaleFactor, validW: extractW, validH: extractH };
}

function valueAt(output, channel, candidateIndex, candidateCount = 21504) {
  return output[channel * candidateCount + candidateIndex];
}

async function inferSlice(session, tensor, minConf = 0.50) {
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';
  const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, 1024, 1024]) };
  const results = await session.run(feeds);
  const rawOutput = results[outputName].data;

  const candidates = [];
  for (let i = 0; i < 21504; i++) {
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < 203; c++) {
      const s = valueAt(rawOutput, 4 + c, i);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }

    if (bestScore >= minConf) {
      const cx = valueAt(rawOutput, 0, i);
      const cy = valueAt(rawOutput, 1, i);
      const w = valueAt(rawOutput, 2, i);
      const h = valueAt(rawOutput, 3, i);
      const x1 = cx - w / 2;
      const y1 = cy - h / 2;
      const x2 = cx + w / 2;
      const y2 = cy + h / 2;
      if (x2 - x1 >= 1 && y2 - y1 >= 1) {
        candidates.push({ anchor: i, rawClassId: bestClass, score: bestScore, bbox: [x1, y1, x2, y2] });
      }
    }
  }
  return candidates;
}

function applyPerSliceNms(candidates, nmsIou = 0.70, cap = 300) {
  candidates.sort((a, b) => b.score - a.score || a.anchor - b.anchor);
  const kept = [];
  const classes = Array.from(new Set(candidates.map((c) => c.rawClassId))).sort((a, b) => a - b);
  for (const cls of classes) {
    const clsCands = candidates.filter((c) => c.rawClassId === cls);
    const suppressed = new Array(clsCands.length).fill(false);
    for (let i = 0; i < clsCands.length; i++) {
      if (suppressed[i]) continue;
      const active = clsCands[i];
      kept.push(active);
      for (let j = i + 1; j < clsCands.length; j++) {
        if (suppressed[j]) continue;
        const iou = computeIoU(
          { x1: active.bbox[0], y1: active.bbox[1], x2: active.bbox[2], y2: active.bbox[3] },
          { x1: clsCands[j].bbox[0], y1: clsCands[j].bbox[1], x2: clsCands[j].bbox[2], y2: clsCands[j].bbox[3] },
        );
        if (iou >= nmsIou) suppressed[j] = true;
      }
    }
  }
  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, cap);
}

/**
 * SAHI Cross-Slice NMS Postprocess:
 * metric: IOU, match_threshold: 0.50, class_agnostic: false
 */
function sahiPostprocessNms(candidates, matchThreshold = 0.50, classAgnostic = false) {
  candidates.sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 1e-9) return b.confidence - a.confidence;
    if (a.sliceIndex !== b.sliceIndex) return a.sliceIndex - b.sliceIndex;
    return a.detectionIndex - b.detectionIndex;
  });

  const suppressed = new Array(candidates.length).fill(false);
  const kept = [];

  for (let i = 0; i < candidates.length; i++) {
    if (suppressed[i]) continue;
    const active = candidates[i];
    kept.push(active);

    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed[j]) continue;
      const neighbor = candidates[j];

      if (!classAgnostic && active.rawClassId !== neighbor.rawClassId) continue;

      const iou = computeIoU(active.box600, neighbor.box600);
      if (iou >= matchThreshold) {
        suppressed[j] = true;
      }
    }
  }
  return { kept, suppressedCount: candidates.length - kept.length };
}

async function createCropWithContext(pageRgb, pageW, pageH, box, label, conf, outPath, strokeColor = '#0088ff') {
  const pad = 120; // 120px context at 600 DPI
  const cX1 = Math.max(0, Math.floor(box.x1 - pad));
  const cY1 = Math.max(0, Math.floor(box.y1 - pad));
  const cX2 = Math.min(pageW, Math.ceil(box.x2 + pad));
  const cY2 = Math.min(pageH, Math.ceil(box.y2 + pad));
  const cropW = Math.round(cX2 - cX1);
  const cropH = Math.round(cY2 - cY1);

  const relX = Math.round(box.x1 - cX1);
  const relY = Math.round(box.y1 - cY1);
  const boxW = Math.max(1, Math.round(box.x2 - box.x1));
  const boxH = Math.max(1, Math.round(box.y2 - box.y1));

  const badgeText = `${label} ${(conf * 100).toFixed(0)}%`;
  const badgeW = Math.min(cropW - 16, Math.max(140, Math.round(badgeText.length * 10 + 20)));

  const svg = Buffer.from(
    `<svg width="${cropW}" height="${cropH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${relX}" y="${relY}" width="${boxW}" height="${boxH}" fill="rgba(0, 136, 255, 0.15)" stroke="${strokeColor}" stroke-width="4" />
      <rect x="8" y="8" width="${badgeW}" height="30" fill="rgba(15, 23, 42, 0.90)" rx="4" ry="4"/>
      <text x="14" y="28" fill="#38bdf8" font-family="monospace" font-size="16" font-weight="bold">${escapeXml(badgeText)}</text>
    </svg>`,
  );

  await sharp(Buffer.from(pageRgb.buffer, pageRgb.byteOffset, pageRgb.byteLength), {
    raw: { width: pageW, height: pageH, channels: 3 },
  })
    .extract({ left: cX1, top: cY1, width: cropW, height: cropH })
    .composite([{ input: svg }])
    .png()
    .toFile(outPath);
}

function evaluateAgainstReference(experimentDets, referenceItems, prefix, matchThreshold = 0.40, shiftThreshold = 0.75) {
  const evaluated = [];
  const refMatched = new Array(referenceItems.length).fill(false);

  for (let i = 0; i < experimentDets.length; i++) {
    const cand = experimentDets[i];
    let bestIoU = 0;
    let bestMatchIdx = -1;

    for (let r = 0; r < referenceItems.length; r++) {
      const refBox = referenceItems[r].box || referenceItems[r].baseBox || referenceItems[r].box600;
      const candBox = cand.baseBox || cand.box600;
      const iou = computeIoU(candBox, refBox);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestMatchIdx = r;
      }
    }

    const id = `${prefix}-${String(i + 1).padStart(3, '0')}`;
    if (bestIoU >= matchThreshold && bestMatchIdx >= 0) {
      refMatched[bestMatchIdx] = true;
      const rMatch = referenceItems[bestMatchIdx];
      const isSameClass = cand.rawClassId === rMatch.rawClassId;
      const isShift = !isSameClass || bestIoU < shiftThreshold;
      evaluated.push({
        ...cand,
        id,
        category: isShift ? 'shift' : 'matched',
        refMatchId: rMatch.id,
        refLabel: rMatch.rawLabel,
        iou: parseFloat(bestIoU.toFixed(3)),
      });
    } else {
      evaluated.push({
        ...cand,
        id,
        category: 'added',
        iou: bestIoU > 0 ? parseFloat(bestIoU.toFixed(3)) : 0,
      });
    }
  }

  const unmatchedRef = [];
  for (let r = 0; r < referenceItems.length; r++) {
    if (!refMatched[r]) {
      const item = referenceItems[r];
      unmatchedRef.push({
        id: `REF-UNMATCHED-${item.id}`,
        rawLabel: item.rawLabel,
        rawClassId: item.rawClassId,
        confidence: item.confidence,
        category: 'unmatched_ref',
        baseBox: item.box || item.baseBox,
        box600: item.box600,
      });
    }
  }

  return { evaluated, unmatchedRef };
}

async function main() {
  console.log('================================================================');
  console.log('  Pilot Eksperimen SAHI (600 DPI, Slice 1280x1280, Overlap 20%)');
  console.log('================================================================\n');

  // Setup directories
  if (fs.existsSync(OUTPUT_DIR)) {
    console.warn(`[WARN] Cleaning existing target directory: ${OUTPUT_DIR}`);
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CROPS_DIR, { recursive: true });
  fs.mkdirSync(MISSING_CROPS_DIR, { recursive: true });

  // 1. Verifikasi Environment & Model
  console.log('[Tahap 1] Verifikasi Environment & Dependency:');
  console.log(`  - Runtime: Node.js ${process.version} (${process.platform} ${process.arch})`);
  console.log(`  - Engine Inferensi: onnxruntime-node (lokal CPU offline, batch 1 sekuensial)`);
  console.log(`  - Engine Image: sharp (zero-copy buffer slicing & resizing)`);
  console.log(`  - Model Path: ${MODEL_PATH}`);
  console.log(`  - Input Shape: [1, 3, 1024, 1024] (FIXED)`);
  console.log(`  - Output Shape: [1, 207, 21504]`);
  console.log(`  - Mapping Kelas: 203 kelas P&ID (model/yolo-v203-names.json)`);

  const rawNames = JSON.parse(fs.readFileSync(NAMES_JSON_PATH, 'utf8'));
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  // 2. Load 600 DPI Image Buffer
  console.log('\n[Tahap 2] Memuat citra sumber 600 DPI (zero re-render):');
  if (!fs.existsSync(SOURCE_600DPI_PNG)) {
    console.error(`[BLOCKER] File render 600 DPI tidak ditemukan: ${SOURCE_600DPI_PNG}`);
    process.exit(1);
  }
  const imgMeta = await sharp(SOURCE_600DPI_PNG).metadata();
  const pageW = imgMeta.width;
  const pageH = imgMeta.height;
  if (pageW !== 9925 || pageH !== 7017) {
    console.error(`[BLOCKER] Dimensi citra tidak sesuai: ${pageW}x${pageH}. Diharapkan 9925x7017 px.`);
    process.exit(1);
  }
  const sharpRaw = await sharp(SOURCE_600DPI_PNG).raw().toBuffer();
  const pageRgb = new Uint8Array(sharpRaw);
  console.log(`  Citra 600 DPI dimuat: ${SOURCE_600DPI_PNG} (${pageW} x ${pageH} px, ${Math.round(sharpRaw.length / (1024 * 1024))} MB)`);

  // 3. Hitung Grid Slice SAHI Aktual
  console.log('\n[Tahap 3] Menghitung Grid Slice SAHI Aktual:');
  const SLICE_SIZE = 1280;
  const OVERLAP_RATIO = 0.20; // 20%
  const STEP_SIZE = Math.floor(SLICE_SIZE * (1.0 - OVERLAP_RATIO)); // 1024 px

  const gridSahi = buildSahiSliceGrid(pageW, pageH, SLICE_SIZE, SLICE_SIZE, OVERLAP_RATIO, OVERLAP_RATIO);
  const totalSlices = gridSahi.slices.length;
  const colsCount = gridSahi.xOffsets.length;
  const rowsCount = gridSahi.yOffsets.length;

  console.log(`  Ukuran Slice: ${SLICE_SIZE} x ${SLICE_SIZE} px`);
  console.log(`  Overlap Ratio: ${(OVERLAP_RATIO * 100).toFixed(0)}% (Step / Stride: ${STEP_SIZE} px)`);
  console.log(`  Kolom Horizontal: ${colsCount} kolom (Offsets: ${gridSahi.xOffsets.join(', ')})`);
  console.log(`  Baris Vertikal: ${rowsCount} baris (Offsets: ${gridSahi.yOffsets.join(', ')})`);
  console.log(`  JUMLAH SLICE AKTUAL: ${totalSlices} slice (${colsCount} cols x ${rowsCount} rows)`);
  console.log(`  Cakupan Tepi Kanan: X_max + Slice = ${gridSahi.xOffsets[colsCount - 1]} + ${SLICE_SIZE} = ${gridSahi.xOffsets[colsCount - 1] + SLICE_SIZE} px (PageW: ${pageW} px -> 100% Tercakup)`);
  console.log(`  Cakupan Tepi Bawah: Y_max + Slice = ${gridSahi.yOffsets[rowsCount - 1]} + ${SLICE_SIZE} = ${gridSahi.yOffsets[rowsCount - 1] + SLICE_SIZE} px (PageH: ${pageH} px -> 100% Tercakup)`);
  console.log(`  Slice Duplikat: 0 (Set unik terverifikasi)`);

  // 4. Inferensi Sekuensial Batch 1
  console.log('\n[Tahap 4] Menjalankan inferensi per-slice sekuensial (Batch 1)...');
  const t0Infer = performance.now();
  const memStart = sampleMemory('start_sahi_pilot');

  const normScaleX = 3573 / pageW;
  const normScaleY = 2526 / pageH;

  const rawSliceDets = [];
  const allPageDets = [];

  for (let sIdx = 0; sIdx < totalSlices; sIdx++) {
    const slice = gridSahi.slices[sIdx];
    const { tensor, scaleFactor, validW, validH } = await extractSliceTensor(pageRgb, pageW, pageH, slice, 1024);
    const sliceCands = await inferSlice(session, tensor, 0.50);
    const nmsKept = applyPerSliceNms(sliceCands, 0.70, 300);

    const sliceRecord = {
      sliceIndex: slice.sliceIndex,
      col: slice.col,
      row: slice.row,
      offset: { x: slice.x, y: slice.y },
      sliceSize: SLICE_SIZE,
      candidatesPreNms: sliceCands.length,
      candidatesPostNms: nmsKept.length,
      detections: [],
    };

    for (let cIdx = 0; cIdx < nmsKept.length; cIdx++) {
      const cand = nmsKept[cIdx];
      // Scale from 1024 space back to 1280 slice space
      const sliceX1 = cand.bbox[0] / scaleFactor;
      const sliceY1 = cand.bbox[1] / scaleFactor;
      const sliceX2 = cand.bbox[2] / scaleFactor;
      const sliceY2 = cand.bbox[3] / scaleFactor;

      if (sliceX1 >= validW || sliceY1 >= validH) continue;

      const clampedX1 = Math.max(0, Math.min(validW, sliceX1));
      const clampedY1 = Math.max(0, Math.min(validH, sliceY1));
      const clampedX2 = Math.max(0, Math.min(validW, sliceX2));
      const clampedY2 = Math.max(0, Math.min(validH, sliceY2));
      if (clampedX2 - clampedX1 < 1 || clampedY2 - clampedY1 < 1) continue;

      const page600X1 = clampedX1 + slice.x;
      const page600Y1 = clampedY1 + slice.y;
      const page600X2 = clampedX2 + slice.x;
      const page600Y2 = clampedY2 + slice.y;

      const baseCoordBox = {
        x1: page600X1 * normScaleX,
        y1: page600Y1 * normScaleY,
        x2: page600X2 * normScaleX,
        y2: page600Y2 * normScaleY,
      };

      const rawLabel = rawNames[String(cand.rawClassId)] || `class_${cand.rawClassId}`;
      const detItem = {
        sliceIndex: slice.sliceIndex,
        detectionIndex: cIdx,
        rawClassId: cand.rawClassId,
        rawLabel,
        confidence: cand.score,
        sliceBox: { x1: sliceX1, y1: sliceY1, x2: sliceX2, y2: sliceY2 },
        box600: { x1: page600X1, y1: page600Y1, x2: page600X2, y2: page600Y2 },
        baseBox: baseCoordBox,
      };

      sliceRecord.detections.push(detItem);
      allPageDets.push(detItem);
    }

    rawSliceDets.push(sliceRecord);
    if ((sIdx + 1) % 10 === 0 || sIdx === totalSlices - 1) {
      process.stdout.write(`    Slices processed: ${sIdx + 1}/${totalSlices} (${((sIdx + 1) / totalSlices * 100).toFixed(1)}%)\r`);
    }
  }

  const durInferMs = Math.round(performance.now() - t0Infer);
  const memEnd = sampleMemory('end_sahi_pilot');

  // 5. Postprocess Antar-Slice SAHI (NMS, metric IOU, threshold 0.50, class_agnostic=false)
  console.log('\n\n[Tahap 5] Menjalankan Postprocess Antar-Slice SAHI (NMS, IoU 0.50, class-aware)...');
  const { kept: retainedDets, suppressedCount: suppCount } = sahiPostprocessNms(allPageDets, 0.50, false);

  console.log(`  Raw Candidates Sebelum Postprocess: ${allPageDets.length}`);
  console.log(`  Kandidat Tertekan Postprocess SAHI: ${suppCount}`);
  console.log(`  KANDIDAT RETAINED SESUDAH POSTPROCESS SAHI: ${retainedDets.length}`);
  console.log(`  Durasi Inferensi: ${durInferMs} ms (${(durInferMs / 1000).toFixed(2)} detik)`);
  console.log(`  Memori Puncak RSS: ${memEnd.rssMb} MB | Heap: ${memEnd.heapUsedMb} MB`);

  // 6. Simpan Prediksi Mentah dan Retained JSON
  console.log('\n[Tahap 6] Menyimpan output JSON prediksi SAHI...');
  const rawJsonPath = path.join(OUTPUT_DIR, 'sahi_raw_slice_predictions.json');
  fs.writeFileSync(rawJsonPath, JSON.stringify(rawSliceDets, null, 2), 'utf8');

  const retainedJsonPath = path.join(OUTPUT_DIR, 'sahi_retained_detections.json');
  fs.writeFileSync(retainedJsonPath, JSON.stringify(retainedDets, null, 2), 'utf8');
  console.log(`  Disimpan: ${rawJsonPath}`);
  console.log(`  Disimpan: ${retainedJsonPath}`);

  // 7. Komparasi terhadap GEO-2 Asli (87 Deteksi) & Exp B 600 DPI (150 Deteksi)
  console.log('\n[Tahap 7] Melakukan Komparasi Diferensial terhadap GEO-2 Asli & Exp B 600 DPI...');
  const fullPageHtml = fs.readFileSync(FULL_PAGE_HTML, 'utf8');
  const fpMatch = fullPageHtml.match(/const data = (\{.*?\});\n/s);
  const fullPageData = JSON.parse(fpMatch[1]);
  const geo2OriginalItems = fullPageData.configs.geo2.items;
  const missedBaseline19Items = fullPageData.configs.geo2.missedBaseline;

  const denseManifest = JSON.parse(fs.readFileSync(DENSE_MANIFEST_PATH, 'utf8'));
  const denseHtml = fs.readFileSync(path.join(path.dirname(DENSE_MANIFEST_PATH), 'index.html'), 'utf8');
  const dhMatch = denseHtml.match(/const data = (\{.*?\});\n/s);
  const denseData = JSON.parse(dhMatch[1]);
  const expBItems = denseData.configs.expB.items;

  // Komparasi vs GEO-2 Asli (dalam base coordinate space 3573x2526)
  const compVsGeo2 = evaluateAgainstReference(retainedDets, geo2OriginalItems, 'SAHI_vs_G2', 0.40, 0.75);
  const matchedVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'matched').length;
  const addedVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'added').length;
  const shiftVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedGeo2 = compVsGeo2.unmatchedRef.length;

  // Komparasi vs Exp B (dalam 600 DPI coordinate space)
  const compVsExpB = evaluateAgainstReference(retainedDets, expBItems, 'SAHI_vs_B', 0.40, 0.75);
  const matchedVsB = compVsExpB.evaluated.filter((x) => x.category === 'matched').length;
  const addedVsB = compVsExpB.evaluated.filter((x) => x.category === 'added').length;
  const shiftVsB = compVsExpB.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedB = compVsExpB.unmatchedRef.length;

  console.log(`  KOMPARASI SAHI vs GEO-2 ASLI (87 Deteksi):`);
  console.log(`  - Matched: ${matchedVsGeo2} | Added: ${addedVsGeo2} | Shift: ${shiftVsGeo2} | GEO-2 Unmatched: ${unmatchedGeo2}`);
  console.log(`  KOMPARASI SAHI vs EXP B 600 DPI (150 Deteksi):`);
  console.log(`  - Matched: ${matchedVsB} | Added: ${addedVsB} | Shift: ${shiftVsB} | Exp B Unmatched: ${unmatchedB}`);

  // 8. Evaluasi terhadap 19 Lokasi Missing (Missed Baseline)
  console.log('\n[Tahap 8] Mengevaluasi per-lokasi terhadap 19 Simbol Missing...');
  const missingEvalResults = [];

  for (let mIdx = 0; mIdx < missedBaseline19Items.length; mIdx++) {
    const miss = missedBaseline19Items[mIdx];
    // Project 3573x2526 box to 600 DPI box
    const missBox600 = {
      x1: miss.box.x1 / normScaleX,
      y1: miss.box.y1 / normScaleY,
      x2: miss.box.x2 / normScaleX,
      y2: miss.box.y2 / normScaleY,
    };

    let bestOverlap = 0;
    let matchedCand = null;

    for (const cand of retainedDets) {
      const iou = computeIoU(cand.box600, missBox600);
      if (iou > bestOverlap) {
        bestOverlap = iou;
        matchedCand = cand;
      }
    }

    let status = 'STILL_MISSED';
    let notes = 'Tidak ada kandidat SAHI yang overlap (IoU < 0.20)';

    if (bestOverlap >= 0.20 && matchedCand) {
      if (matchedCand.rawClassId === miss.rawClassId) {
        status = 'RECOVERED_MATCHED';
        notes = `Berhasil ditemukan! Label sama: ${matchedCand.rawLabel} (${(matchedCand.confidence * 100).toFixed(0)}%, IoU: ${bestOverlap.toFixed(2)})`;
      } else {
        status = 'CLASS_CONFLICT';
        notes = `Overlap ditemukan tetapi kelas berbeda: Prediksi ${matchedCand.rawLabel} vs Ground-Truth ${miss.rawLabel} (IoU: ${bestOverlap.toFixed(2)})`;
      }
    }

    const evalRecord = {
      index: mIdx + 1,
      id: miss.id,
      groundTruthLabel: miss.rawLabel,
      groundTruthClassId: miss.rawClassId,
      groundTruthConfidence: miss.confidence,
      boxBase: miss.box,
      box600: missBox600,
      status,
      overlapIoU: parseFloat(bestOverlap.toFixed(3)),
      matchedCandidate: matchedCand ? {
        label: matchedCand.rawLabel,
        confidence: matchedCand.confidence,
        box600: matchedCand.box600,
      } : null,
      notes,
      humanReviewDecision: 'UNRESOLVED',
    };

    missingEvalResults.push(evalRecord);

    // Generate Crop for each missing location
    const cropFile = path.join(MISSING_CROPS_DIR, `${miss.id}.png`);
    const stroke = status === 'RECOVERED_MATCHED' ? '#00cc44' : status === 'CLASS_CONFLICT' ? '#ff9900' : '#ff3333';
    await createCropWithContext(pageRgb, pageW, pageH, missBox600, `${miss.id} ${miss.rawLabel}`, miss.confidence, cropFile, stroke);
    evalRecord.cropPath = `crops/missing-19/${miss.id}.png`;
  }

  const recCount = missingEvalResults.filter((x) => x.status === 'RECOVERED_MATCHED').length;
  const confCount = missingEvalResults.filter((x) => x.status === 'CLASS_CONFLICT').length;
  const missCount = missingEvalResults.filter((x) => x.status === 'STILL_MISSED').length;

  console.log(`  EVALUASI 19 SIMBOL MISSING:`);
  console.log(`  - Berhasil Ditemukan (Label Cocok): ${recCount} / 19`);
  console.log(`  - Konflik Kelas (Overlap tapi beda kelas): ${confCount} / 19`);
  console.log(`  - Tetap Missing: ${missCount} / 19`);

  // 9. Generate Crops untuk Kandidat Tambahan
  console.log('\n[Tahap 9] Menyimpan crop berkonteks untuk kandidat tambahan...');
  const unifiedItems = compVsGeo2.evaluated.map((item, idx) => ({
    ...item,
    id: `SAHI-${String(idx + 1).padStart(3, '0')}`,
    categoryVsGeo2: item.category,
    categoryVsB: compVsExpB.evaluated[idx] ? compVsExpB.evaluated[idx].category : 'added',
  }));

  const addedItems = unifiedItems.filter((x) => x.categoryVsGeo2 === 'added');
  for (const item of addedItems) {
    const cropFile = path.join(CROPS_DIR, `${item.id}.png`);
    await createCropWithContext(pageRgb, pageW, pageH, item.box600, item.rawLabel, item.confidence, cropFile, '#0088ff');
    item.cropPath = `crops/${item.id}.png`;
  }
  console.log(`  Disimpan ${addedItems.length} crop kandidat tambahan di ${CROPS_DIR}`);

  // 10. Generate Full-Page 600 DPI Overlay
  console.log('\n[Tahap 10] Mengompositkan overlay full-page 600 DPI...');

  function buildOverlaySvg(title, candidates, unmatchedRef, missingItems = []) {
    const lines = [
      `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
      `<style>
        .bbox-matched { stroke: #00cc44; stroke-width: 4; fill: rgba(0, 204, 68, 0.08); }
        .bbox-added   { stroke: #0088ff; stroke-width: 4; fill: rgba(0, 136, 255, 0.08); }
        .bbox-shift   { stroke: #ff9900; stroke-width: 4; fill: rgba(255, 153, 0, 0.08); }
        .bbox-unmatched { stroke: #ff3333; stroke-width: 4; stroke-dasharray: 12,8; fill: rgba(255, 51, 51, 0.04); }
        .bbox-missing { stroke: #c084fc; stroke-width: 4; stroke-dasharray: 8,6; fill: rgba(192, 132, 252, 0.05); }

        .lbl-bg { fill: rgba(15, 23, 42, 0.90); rx: 4; ry: 4; }
        .lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 20px; font-weight: bold; }

        .legend-card { fill: rgba(15, 23, 42, 0.94); stroke: rgba(255, 255, 255, 0.2); stroke-width: 3; rx: 10; ry: 10; }
        .leg-title { fill: #ffffff; font-family: sans-serif; font-size: 30px; font-weight: bold; }
        .leg-text { fill: #e2e8f0; font-family: sans-serif; font-size: 22px; }
      </style>`,
    ];

    // Unmatched GEO-2 Asli (Merah Putus-putus)
    for (const m of unmatchedRef) {
      const b600 = m.box600 || { x1: m.baseBox.x1 / normScaleX, y1: m.baseBox.y1 / normScaleY, x2: m.baseBox.x2 / normScaleX, y2: m.baseBox.y2 / normScaleY };
      const x1 = Math.round(b600.x1);
      const y1 = Math.round(b600.y1);
      const w = Math.max(1, Math.round(b600.x2 - b600.x1));
      const h = Math.max(1, Math.round(b600.y2 - b600.y1));
      lines.push(`<rect class="bbox-unmatched" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);
      const txt = `[GEO-2 Hilang] ${m.rawLabel}`;
      const lblW = Math.round(txt.length * 12 + 16);
      const lblX = Math.max(8, Math.min(pageW - lblW - 8, x1));
      const lblY = Math.max(8, Math.min(pageH - 36, y1 - 32));
      lines.push(
        `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="30" />`,
        `<text class="lbl-txt" x="${lblX + 8}" y="${lblY + 22}" fill="#ff6666">${escapeXml(txt)}</text>`,
      );
    }

    // Kandidat Aktif SAHI
    for (const c of candidates) {
      const x1 = Math.round(c.box600.x1);
      const y1 = Math.round(c.box600.y1);
      const w = Math.max(1, Math.round(c.box600.x2 - c.box600.x1));
      const h = Math.max(1, Math.round(c.box600.y2 - c.box600.y1));

      let cls = 'bbox-added';
      let textColor = '#88ccff';
      if (c.categoryVsGeo2 === 'matched') {
        cls = 'bbox-matched';
        textColor = '#66ff99';
      } else if (c.categoryVsGeo2 === 'shift') {
        cls = 'bbox-shift';
        textColor = '#ffcc66';
      }

      lines.push(`<rect class="${cls}" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);

      const txt = `${c.id} ${c.rawLabel} ${(c.confidence * 100).toFixed(0)}%`;
      const lblW = Math.round(txt.length * 12 + 18);
      const lblX = Math.max(8, Math.min(pageW - lblW - 8, x1));
      const lblY = Math.max(8, Math.min(pageH - 36, y1 - 32));

      lines.push(
        `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="30" />`,
        `<text class="lbl-txt" x="${lblX + 8}" y="${lblY + 22}" fill="${textColor}">${escapeXml(txt)}</text>`,
      );
    }

    // 19 Missing Locations
    for (const miss of missingItems) {
      const x1 = Math.round(miss.box600.x1);
      const y1 = Math.round(miss.box600.y1);
      const w = Math.max(1, Math.round(miss.box600.x2 - miss.box600.x1));
      const h = Math.max(1, Math.round(miss.box600.y2 - miss.box600.y1));
      lines.push(`<rect class="bbox-missing" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);
    }

    // Legenda Banner
    const legW = 780;
    const legH = 280;
    lines.push(
      `<rect class="legend-card" x="40" y="40" width="${legW}" height="${legH}" />`,
      `<text class="leg-title" x="70" y="90">${escapeXml(title)}</text>`,

      `<rect x="70" y="115" width="28" height="20" fill="#00cc44" rx="4" />`,
      `<text class="leg-text" x="115" y="133">Hijau: Matched dengan GEO-2 Asli</text>`,

      `<rect x="70" y="150" width="28" height="20" fill="#0088ff" rx="4" />`,
      `<text class="leg-text" x="115" y="168">Biru: Kandidat Tambahan Baru</text>`,

      `<rect x="70" y="185" width="28" height="20" fill="#ff9900" rx="4" />`,
      `<text class="leg-text" x="115" y="203">Oranye: Perubahan Kelas / BBox Shift</text>`,

      `<line x1="70" y1="230" x2="100" y2="230" stroke="#ff3333" stroke-width="4" stroke-dasharray="8,6" />`,
      `<text class="leg-text" x="115" y="238">Merah Putus-putus: GEO-2 Asli Tidak Matched</text>`,

      `<line x1="70" y1="262" x2="100" y2="262" stroke="#c084fc" stroke-width="4" stroke-dasharray="8,6" />`,
      `<text class="leg-text" x="115" y="270">Ungu Putus-putus: Lokasi 19 Missing Evaluasi</text>`,
    );

    lines.push('</svg>');
    return lines.join('\n');
  }

  const overlaySvgStr = buildOverlaySvg(
    `Pilot SAHI (600 DPI, Slice 1280, Overlap 20%) - Total: ${unifiedItems.length}`,
    unifiedItems,
    compVsGeo2.unmatchedRef,
    missingEvalResults,
  );

  const overlayPngPath = path.join(OUTPUT_DIR, '01_sahi_pilot_overlay.png');
  await sharp(SOURCE_600DPI_PNG, { limitInputPixels: false })
    .composite([{ input: Buffer.from(overlaySvgStr) }])
    .png()
    .toFile(overlayPngPath);
  console.log(`  Overlay PNG SAHI 600 DPI: ${overlayPngPath}`);

  // 11. Build Interactive Offline HTML Viewer
  console.log('\n[Tahap 11] Membangun viewer HTML interaktif lokal...');

  const htmlPayload = JSON.stringify({
    pageWidth: pageW,
    pageHeight: pageH,
    items: unifiedItems,
    unmatchedGeo2: compVsGeo2.unmatchedRef,
    unmatchedExpB: compVsExpB.unmatchedRef,
    missingEvaluation: missingEvalResults,
    summary: {
      sahiPilot: {
        totalSlices,
        sliceSize: SLICE_SIZE,
        stepSize: STEP_SIZE,
        overlapRatio: OVERLAP_RATIO,
        durationMs: durInferMs,
        rawCandidates: allPageDets.length,
        retainedCandidates: retainedDets.length,
        suppressed: suppCount,
      },
      vsGeo2: {
        referenceTotal: geo2OriginalItems.length,
        matched: matchedVsGeo2,
        added: addedVsGeo2,
        shift: shiftVsGeo2,
        unmatched: unmatchedGeo2,
      },
      vsExpB: {
        referenceTotal: expBItems.length,
        matched: matchedVsB,
        added: addedVsB,
        shift: shiftVsB,
        unmatched: unmatchedB,
      },
      missing19Summary: {
        total: 19,
        recoveredMatched: recCount,
        classConflict: confCount,
        stillMissed: missCount,
      },
    },
  });

  const htmlSource = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>P&ID Tuning — Pilot Eksperimen SAHI (600 DPI, Slice 1280, Overlap 20%)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; z-index: 20; flex-wrap: wrap; gap: 8px; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo-badge { font-weight: bold; font-size: 13px; background: #ec4899; color: white; padding: 4px 8px; border-radius: 4px; }
    .page-title { font-size: 14px; font-weight: 600; color: #e2e8f0; }

    .nav-tabs { display: flex; gap: 4px; background: #0f172a; padding: 3px; border-radius: 6px; border: 1px solid #334155; }
    .tab-btn { background: transparent; color: #94a3b8; border: none; padding: 5px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .tab-btn.active { background: #ec4899; color: white; font-weight: 600; }

    .ctrl-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ctrl-group { display: flex; align-items: center; gap: 6px; background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; }
    .ctrl-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
    select, button { background: #1e293b; color: #f8fafc; border: 1px solid #475569; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; outline: none; }
    select:hover, button:hover { background: #334155; }

    .workspace { display: flex; flex: 1; height: calc(100vh - 54px); overflow: hidden; position: relative; }
    .viewport { flex: 1; background: #020617; overflow: hidden; position: relative; cursor: grab; user-select: none; }
    .viewport:active { cursor: grabbing; }

    .canvas-stage { position: absolute; transform-origin: 0 0; will-change: transform; }
    .stage-img { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; display: block; pointer-events: none; }

    .sidebar { width: 380px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; z-index: 10; }
    .sidebar-header { padding: 12px; border-bottom: 1px solid #334155; }
    .sidebar-title { font-size: 13px; font-weight: 600; color: #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .sidebar-content { flex: 1; overflow-y: auto; padding: 12px; }

    .summary-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 12px; }
    .sum-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
    .sum-val { font-size: 16px; font-weight: bold; }

    .item-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px; font-size: 12px; cursor: pointer; transition: border-color 0.15s; }
    .item-card:hover { border-color: #ec4899; }

    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
    .badge-matched { background: rgba(0, 204, 68, 0.2); color: #4ade80; border: 1px solid #22c55e; }
    .badge-added { background: rgba(0, 136, 255, 0.2); color: #60a5fa; border: 1px solid #3b82f6; }
    .badge-shift { background: rgba(255, 153, 0, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .badge-unmatched { background: rgba(255, 51, 51, 0.2); color: #f87171; border: 1px solid #ef4444; }

    .missing-row { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #0f172a; border-radius: 6px; border: 1px solid #334155; margin-bottom: 8px; font-size: 12px; cursor: pointer; }
    .missing-row:hover { border-color: #c084fc; }

    /* Modal Crop */
    .crop-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 100; align-items: center; justify-content: center; }
    .crop-modal.show { display: flex; }
    .crop-card { background: #1e293b; border: 1px solid #475569; border-radius: 8px; max-width: 600px; width: 90%; padding: 16px; position: relative; }
    .crop-img { max-width: 100%; border-radius: 4px; border: 1px solid #334155; display: block; margin: 12px auto; }
    .crop-close { position: absolute; top: 12px; right: 12px; background: #334155; border: none; color: white; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <span class="logo-badge">SAHI PILOT</span>
      <span class="page-title">P&ID Tuning — Pilot SAHI (600 DPI, Slice 1280, Overlap 20%)</span>
      <div class="nav-tabs">
        <button class="tab-btn active" id="tabFullView">Full View</button>
        <button class="tab-btn" id="tabMissing19">19 Missing Review</button>
      </div>
    </div>

    <div class="ctrl-bar">
      <div class="ctrl-group">
        <span class="ctrl-label">Komparasi:</span>
        <select id="refSelect">
          <option value="geo2" selected>vs GEO-2 Asli (87)</option>
          <option value="expB">vs Exp B 600 DPI (150)</option>
        </select>
      </div>

      <div class="ctrl-group">
        <button id="btnZoomIn">+</button>
        <button id="btnZoomOut">-</button>
        <button id="btnFit">Fit</button>
        <span id="zoomPct" style="font-size:11px; color:#94a3b8;">100%</span>
      </div>
    </div>
  </header>

  <div class="workspace">
    <div class="viewport" id="viewport">
      <div class="canvas-stage" id="stage">
        <img class="stage-img" id="pageImg" src="01_sahi_pilot_overlay.png" alt="Overlay">
      </div>
    </div>

    <div class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <span id="sidebarHeaderTitle">Ringkasan SAHI Pilot</span>
          <span id="itemCountBadge" class="badge badge-added">0 Detections</span>
        </div>
      </div>
      <div class="sidebar-content" id="sidebarContent"></div>
    </div>
  </div>

  <div class="crop-modal" id="cropModal">
    <div class="crop-card">
      <button class="crop-close" id="cropCloseBtn">&times;</button>
      <h3 id="cropTitle" style="font-size:14px; margin-bottom:4px;">Crop Details</h3>
      <p id="cropMeta" style="font-size:11px; color:#94a3b8;"></p>
      <img class="crop-img" id="cropModalImg" src="" alt="Crop Preview">
      <div style="font-size:11px; color:#cbd5e1; background:#0f172a; padding:8px; border-radius:4px;" id="cropNotes"></div>
    </div>
  </div>

  <script>
    const data = ${htmlPayload};

    let scale = 1.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let currentTab = 'full';
    let currentRef = 'geo2';

    const viewport = document.getElementById('viewport');
    const stage = document.getElementById('stage');
    const zoomPct = document.getElementById('zoomPct');
    const sidebarContent = document.getElementById('sidebarContent');
    const sidebarHeaderTitle = document.getElementById('sidebarHeaderTitle');
    const itemCountBadge = document.getElementById('itemCountBadge');

    function updateTransform() {
      stage.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
      zoomPct.textContent = \`\${Math.round(scale * 100)}%\`;
    }

    function fitToScreen() {
      const vW = viewport.clientWidth;
      const vH = viewport.clientHeight;
      scale = Math.min((vW - 40) / data.pageWidth, (vH - 40) / data.pageHeight, 1.0);
      panX = (vW - data.pageWidth * scale) / 2;
      panY = (vH - data.pageHeight * scale) / 2;
      updateTransform();
    }

    viewport.addEventListener('mousedown', (e) => {
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform();
    });

    window.addEventListener('mouseup', () => { isPanning = false; });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const newScale = Math.max(0.04, Math.min(4.0, scale * zoomFactor));

      panX = mouseX - (mouseX - panX) * (newScale / scale);
      panY = mouseY - (mouseY - panY) * (newScale / scale);
      scale = newScale;
      updateTransform();
    }, { passive: false });

    document.getElementById('btnZoomIn').onclick = () => { scale = Math.min(4.0, scale * 1.25); updateTransform(); };
    document.getElementById('btnZoomOut').onclick = () => { scale = Math.max(0.04, scale / 1.25); updateTransform(); };
    document.getElementById('btnFit').onclick = fitToScreen;

    function renderView() {
      if (currentTab === 'full') {
        sidebarHeaderTitle.textContent = currentRef === 'geo2' ? 'SAHI vs GEO-2 Asli' : 'SAHI vs Exp B 600 DPI';
        itemCountBadge.textContent = \`\${data.items.length} Detections\`;
        renderFullSidebar();
      } else {
        sidebarHeaderTitle.textContent = 'Evaluasi 19 Simbol Missing';
        itemCountBadge.textContent = \`\${data.summary.missing19Summary.recoveredMatched}/19 Ditemukan\`;
        renderMissingSidebar();
      }
    }

    function renderFullSidebar() {
      const s = data.summary;
      const comp = currentRef === 'geo2' ? s.vsGeo2 : s.vsExpB;
      const refTitle = currentRef === 'geo2' ? 'GEO-2 Asli (87)' : 'Exp B 600 DPI (150)';

      let html = \`
        <div class="summary-card">
          <div style="font-weight:bold; color:#ec4899;">Komparasi Diferensial vs \${refTitle}:</div>
          <div class="sum-grid">
            <div>Matched: <span class="sum-val" style="color:#4ade80;">\${comp.matched}</span></div>
            <div>Added: <span class="sum-val" style="color:#60a5fa;">\${comp.added}</span></div>
            <div>Shift: <span class="sum-val" style="color:#fbbf24;">\${comp.shift}</span></div>
            <div>Unmatched: <span class="sum-val" style="color:#f87171;">\${comp.unmatched}</span></div>
          </div>
          <div style="margin-top:6px; color:#94a3b8; font-size:11px;">
            Slices: \${s.sahiPilot.totalSlices} | Waktu: \${(s.sahiPilot.durationMs/1000).toFixed(1)}s | Raw: \${s.sahiPilot.rawCandidates}
          </div>
        </div>
      \`;

      data.items.forEach((item) => {
        const cat = currentRef === 'geo2' ? item.categoryVsGeo2 : item.categoryVsB;
        let bClass = 'badge-added';
        if (cat === 'matched') bClass = 'badge-matched';
        else if (cat === 'shift') bClass = 'badge-shift';

        html += \`
          <div class="item-card" onclick="focusOnBox(\${item.box600.x1}, \${item.box600.y1}, \${item.box600.x2}, \${item.box600.y2})">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>\${item.id} \${item.rawLabel}</strong>
              <span class="badge \${bClass}">\${cat}</span>
            </div>
            <div style="color:#94a3b8; font-size:11px; margin-top:4px;">
              Confidence: \${(item.confidence * 100).toFixed(1)}% | Slice: \${item.sliceIndex}
            </div>
            \${item.cropPath ? \`<button style="margin-top:4px; font-size:10px; padding:2px 6px;" onclick="event.stopPropagation(); openCrop('\${item.cropPath}', '\${item.id} \${item.rawLabel}', 'Confidence: \${(item.confidence*100).toFixed(1)}% | Status: \${cat}', 'Kandidat Tambahan Baru')">Lihat Crop</button>\` : ''}
          </div>
        \`;
      });

      sidebarContent.innerHTML = html;
    }

    function renderMissingSidebar() {
      const s = data.summary.missing19Summary;
      let html = \`
        <div class="summary-card">
          <div style="font-weight:bold; color:#c084fc;">Hasil Evaluasi 19 Missing:</div>
          <div class="sum-grid">
            <div>Ditemukan: <span class="sum-val" style="color:#4ade80;">\${s.recoveredMatched}</span></div>
            <div>Konflik Kelas: <span class="sum-val" style="color:#fbbf24;">\${s.classConflict}</span></div>
            <div>Tetap Hilang: <span class="sum-val" style="color:#f87171;">\${s.stillMissed}</span></div>
            <div>Total Missing: <span class="sum-val" style="color:#e2e8f0;">19</span></div>
          </div>
        </div>
      \`;

      data.missingEvaluation.forEach((m) => {
        let bClass = 'badge-unmatched';
        let bText = 'Tetap Hilang';
        if (m.status === 'RECOVERED_MATCHED') { bClass = 'badge-matched'; bText = 'Ditemukan'; }
        else if (m.status === 'CLASS_CONFLICT') { bClass = 'badge-shift'; bText = 'Konflik Kelas'; }

        html += \`
          <div class="missing-row" onclick="focusOnBox(\${m.box600.x1}, \${m.box600.y1}, \${m.box600.x2}, \${m.box600.y2})">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>#\${m.index} \${m.id}</strong>
              <span class="badge \${bClass}">\${bText}</span>
            </div>
            <div style="color:#cbd5e1; font-weight:500;">\${m.groundTruthLabel}</div>
            <div style="color:#94a3b8; font-size:11px;">\${m.notes}</div>
            <button style="align-self:flex-start; margin-top:4px; font-size:10px; padding:2px 6px;" onclick="event.stopPropagation(); openCrop('\${m.cropPath}', '#\${m.index} \${m.id} - \${m.groundTruthLabel}', 'Status: \${m.status} | Overlap: \${m.overlapIoU}', '\${m.notes}')">Lihat Crop Konteks</button>
          </div>
        \`;
      });

      sidebarContent.innerHTML = html;
    }

    function focusOnBox(x1, y1, x2, y2) {
      const bW = x2 - x1;
      const bH = y2 - y1;
      const cX = x1 + bW / 2;
      const cY = y1 + bH / 2;

      scale = 1.0;
      panX = viewport.clientWidth / 2 - cX * scale;
      panY = viewport.clientHeight / 2 - cY * scale;
      updateTransform();
    }

    function openCrop(src, title, meta, notes) {
      document.getElementById('cropModalImg').src = src;
      document.getElementById('cropTitle').textContent = title;
      document.getElementById('cropMeta').textContent = meta;
      document.getElementById('cropNotes').textContent = notes;
      document.getElementById('cropModal').classList.add('show');
    }

    document.getElementById('cropCloseBtn').onclick = () => {
      document.getElementById('cropModal').classList.remove('show');
    };
    document.getElementById('cropModal').onclick = (e) => {
      if (e.target.id === 'cropModal') document.getElementById('cropModal').classList.remove('show');
    };

    document.getElementById('refSelect').onchange = (e) => {
      currentRef = e.target.value;
      renderView();
    };

    document.getElementById('tabFullView').onclick = () => {
      currentTab = 'full';
      document.getElementById('tabFullView').classList.add('active');
      document.getElementById('tabMissing19').classList.remove('active');
      renderView();
    };

    document.getElementById('tabMissing19').onclick = () => {
      currentTab = 'missing';
      document.getElementById('tabMissing19').classList.add('active');
      document.getElementById('tabFullView').classList.remove('active');
      renderView();
    };

    window.onload = () => {
      fitToScreen();
      renderView();
    };
  </script>
</body>
</html>`;

  const htmlOutPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(htmlOutPath, htmlSource, 'utf8');
  console.log(`  Viewer HTML Interaktif: ${htmlOutPath}`);

  // 12. Write Telemetry Manifest
  console.log('\n[Tahap 12] Menulis manifest telemetri SAHI Pilot...');
  const manifestData = {
    schemaVersion: 'sahi-pilot-v1',
    generatedAt: new Date().toISOString(),
    environment: {
      runtime: `Node.js ${process.version}`,
      platform: process.platform,
      arch: process.arch,
      inferenceEngine: 'onnxruntime-node',
      imageEngine: 'sharp',
      noExternalPythonVenv: true,
    },
    sahiConfiguration: {
      sliceWidth: SLICE_SIZE,
      sliceHeight: SLICE_SIZE,
      overlapRatio: OVERLAP_RATIO,
      stepX: STEP_SIZE,
      stepY: STEP_SIZE,
      modelInputWidth: 1024,
      modelInputHeight: 1024,
      confidenceThreshold: 0.50,
      perSliceNmsIou: 0.70,
      perSliceMaxCap: 300,
      crossSlicePostprocess: {
        type: 'NMS',
        metric: 'IOU',
        matchThreshold: 0.50,
        classAgnostic: false,
      },
      performStandardPred: false,
      totalSlices,
      grid: {
        colsCount,
        rowsCount,
        xOffsets: gridSahi.xOffsets,
        yOffsets: gridSahi.yOffsets,
      },
      durationMs: durInferMs,
      memoryUsage: { start: memStart, end: memEnd },
      candidatesAfterConfidenceAndPerSliceNms: allPageDets.length,
      retainedCandidatesAfterGlobalMerge: retainedDets.length,
      suppressedByGlobalMerge: suppCount,
    },
    comparisons: {
      vsGeo2Baseline: {
        referenceTotal: geo2OriginalItems.length,
        matched: matchedVsGeo2,
        added: addedVsGeo2,
        shift: shiftVsGeo2,
        unmatched: unmatchedGeo2,
      },
      vsExpB600Dpi: {
        referenceTotal: expBItems.length,
        matched: matchedVsB,
        added: addedVsB,
        shift: shiftVsB,
        unmatched: unmatchedB,
      },
    },
    missing19Evaluation: {
      total: 19,
      recoveredMatched: recCount,
      classConflict: confCount,
      stillMissed: missCount,
      details: missingEvalResults,
    },
    files: {
      rawSlicePredictions: 'sahi_raw_slice_predictions.json',
      retainedDetections: 'sahi_retained_detections.json',
      overlayPng: '01_sahi_pilot_overlay.png',
      htmlViewer: 'index.html',
      cropsDir: 'crops',
      missing19CropsDir: 'crops/missing-19',
    },
    humanDecisionStatus: 'ALL_UNRESOLVED',
    note: 'Referensi baseline bukan ground truth final sebelum review manusia. Seluruh keputusan manusia berstatus UNRESOLVED.',
  };

  const manifestPath = path.join(OUTPUT_DIR, 'sahi-pilot-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
  console.log(`  Telemetry Manifest: ${manifestPath}`);
  console.log('\n[SUCCESS] Pilot Eksperimen SAHI Selesai!');
}

main().catch((err) => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
