#!/usr/bin/env node
/**
 * Eksperimen GEO-2-DENSE: Peningkatan Densitas Tile untuk Baseline GEO-2 (Tile 1280)
 *
 * TUJUAN:
 *   Meningkatkan GEO-2 untuk menemukan simbol yang masih missing, tanpa kehilangan
 *   kualitas hasil yang sudah baik.
 *
 * SCOPE & CONTRACT:
 *   1. Rekonstruksi Konfigurasi Aktual GEO-2:
 *      - Model: model/yolo-pid-v8n-203.onnx (input fixed [1, 3, 1024, 1024], output [1, 207, 21504])
 *      - Sumber gambar: fixtures/pid-eval/sheet-1/page_1.png (3573x2526 px)
 *      - Skala render: Scale 3.0 dari PDF A3 landscape (1191x842 pt), setara 216 DPI (PNG density 96)
 *      - tileSize asli: 1280x1280 px, stride: 1024 px, overlap asli: 20.0%
 *      - Confidence threshold: 0.50
 *      - Per-tile NMS: IoU 0.70, cap 300, class-aware
 *      - Global merge: IoU 0.50, class-aware: true
 *      - Hasil asli: 12 tile, 152 raw candidates, 87 retained detections
 *
 *   2. Konfigurasi GEO-2-DENSE:
 *      - Overlap asli 20.0% (< 50%) -> Uji overlap 50.0%, stride 640 px
 *      - tileSize tetap 1280x1280 px
 *      - Model, input shape, gambar sumber, confidence, NMS per-tile, dan global merge tetap sama
 *      - Grid aktual: 5 kolom x 3 baris = 15 tile (100% tepi tercakup, 0 duplikat)
 *      - Inferensi sekuensial, batch 1, CPU lokal offline
 *
 *   3. Evaluasi & Perbandingan:
 *      - Bandingkan terhadap 87 deteksi asli GEO-2
 *      - Evaluasi terhadap 19 lokasi missing (missed baseline)
 *      - Buat overlay full-page 3573x2526 px
 *      - Buat viewer HTML interaktif offline
 *      - Hasilkan crop konteks kandidat tambahan & 19 lokasi missing
 *      - Catat manifest telemetri lengkap
 *
 *   4. Batasan:
 *      - Output tersimpan terpisah di fixtures/diagnostics/tuning-experiments/review-package/geo2-dense/
 *      - Tanpa overwrite GEO-2, tanpa retrain, export model, API eksternal, perubahan produksi, atau git stage/commit/push.
 *      - Seluruh keputusan manusia berstatus UNRESOLVED.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SOURCE_IMAGE_PATH = path.join(REPO_ROOT, 'fixtures/pid-eval/sheet-1/page_1.png');
const MODEL_PATH = path.join(REPO_ROOT, 'model/yolo-pid-v8n-203.onnx');
const NAMES_JSON_PATH = path.join(REPO_ROOT, 'model/yolo-v203-names.json');
const GEO2_HTML_PATH = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html',
);

const OUTPUT_DIR = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/geo2-dense',
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

function generateAxisOffsets(dimension, tileSize, stride) {
  if (dimension <= tileSize) return [0];
  const offsets = [0];
  let curr = 0;
  while (curr + stride + tileSize <= dimension) {
    curr += stride;
    offsets.push(curr);
  }
  const lastOffset = dimension - tileSize;
  if (lastOffset > 0) offsets.push(lastOffset);
  return Array.from(new Set(offsets)).sort((a, b) => a - b);
}

function buildGrid(pageW, pageH, tileSize, stride) {
  const xOffsets = generateAxisOffsets(pageW, tileSize, stride);
  const yOffsets = generateAxisOffsets(pageH, tileSize, stride);
  const tiles = [];
  let tileIndex = 0;
  for (let r = 0; r < yOffsets.length; r++) {
    for (let c = 0; c < xOffsets.length; c++) {
      tiles.push({
        tileIndex,
        col: c,
        row: r,
        x: xOffsets[c],
        y: yOffsets[r],
        width: tileSize,
        height: tileSize,
      });
      tileIndex++;
    }
  }
  return { tileSize, stride, xOffsets, yOffsets, tiles };
}

/**
 * Extract 1280x1280 tile and resize to 1024x1024 NCHW Float32Array (Sama persis dengan GEO-2 asli)
 */
async function extractTileTensor(pageRgb, pageW, pageH, tile, onnxSize = 1024) {
  const extractW = Math.min(tile.width, pageW - tile.x);
  const extractH = Math.min(tile.height, pageH - tile.y);

  const tileRgb = await sharp(Buffer.from(pageRgb.buffer, pageRgb.byteOffset, pageRgb.byteLength), {
    raw: { width: pageW, height: pageH, channels: 3 },
  })
    .extract({ left: tile.x, top: tile.y, width: extractW, height: extractH })
    .resize(onnxSize, onnxSize, { fit: 'fill' })
    .raw()
    .toBuffer();

  const planeSize = onnxSize * onnxSize;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = tileRgb[i * 3] / 255.0;
    tensor[planeSize + i] = tileRgb[i * 3 + 1] / 255.0;
    tensor[2 * planeSize + i] = tileRgb[i * 3 + 2] / 255.0;
  }

  // Scale factor: onnxSize / tileSize = 1024 / 1280 = 0.8
  const scaleFactor = onnxSize / tile.width;
  return { tensor, scaleFactor, validW: extractW, validH: extractH };
}

function valueAt(output, channel, candidateIndex, candidateCount = 21504) {
  return output[channel * candidateCount + candidateIndex];
}

async function inferTile(session, tensor, minConf = 0.50) {
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

function applyNms(candidates, nmsIou = 0.70, cap = 300) {
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

function mergeGlobal(candidates, globalMergeIou = 0.50, classAware = true) {
  candidates.sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 1e-9) return b.confidence - a.confidence;
    if (a.tileIndex !== b.tileIndex) return a.tileIndex - b.tileIndex;
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
      if (classAware && active.rawClassId !== neighbor.rawClassId) continue;

      const iou = computeIoU(active.pageBox, neighbor.pageBox);
      if (iou >= globalMergeIou) {
        suppressed[j] = true;
      }
    }
  }
  return { kept, suppressedCount: candidates.length - kept.length };
}

async function createCropWithContext(pageRgb, pageW, pageH, box, label, conf, outPath, strokeColor = '#0088ff') {
  const pad = 60; // 60px context at 3573x2526
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
  const badgeW = Math.min(cropW - 12, Math.max(120, Math.round(badgeText.length * 8 + 16)));

  const svg = Buffer.from(
    `<svg width="${cropW}" height="${cropH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${relX}" y="${relY}" width="${boxW}" height="${boxH}" fill="rgba(0, 136, 255, 0.12)" stroke="${strokeColor}" stroke-width="3" />
      <rect x="6" y="6" width="${badgeW}" height="24" fill="rgba(15, 23, 42, 0.90)" rx="3" ry="3"/>
      <text x="10" y="22" fill="#38bdf8" font-family="monospace" font-size="13" font-weight="bold">${escapeXml(badgeText)}</text>
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

// Bipartite greedy matching against reference detections
function evaluateAgainstReference(experimentDets, referenceItems, prefix, matchThreshold = 0.40, shiftThreshold = 0.75) {
  const evaluated = [];
  const refMatched = new Array(referenceItems.length).fill(false);

  for (let i = 0; i < experimentDets.length; i++) {
    const cand = experimentDets[i];
    let bestIoU = 0;
    let bestMatchIdx = -1;

    for (let r = 0; r < referenceItems.length; r++) {
      const iou = computeIoU(cand.pageBox, referenceItems[r].box || referenceItems[r].pageBox);
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
        pageBox: item.box || item.pageBox,
      });
    }
  }

  return { evaluated, unmatchedRef };
}

async function main() {
  console.log('================================================================');
  console.log('  Eksperimen GEO-2-DENSE: Tile 1280x1280, Overlap 50%, Stride 640');
  console.log('================================================================\n');

  // Setup directories
  if (fs.existsSync(OUTPUT_DIR)) {
    console.warn(`[WARN] Cleaning existing target directory: ${OUTPUT_DIR}`);
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CROPS_DIR, { recursive: true });
  fs.mkdirSync(MISSING_CROPS_DIR, { recursive: true });

  // 1. Rekonstruksi Konfigurasi Aktual GEO-2
  console.log('[Step 1] Rekonstruksi Konfigurasi Aktual GEO-2 Asli:');
  const geo2OriginalConfig = {
    model: 'model/yolo-pid-v8n-203.onnx',
    inputShape: '[1, 3, 1024, 1024] (FIXED)',
    sourceImage: 'fixtures/pid-eval/sheet-1/page_1.png',
    sourceDimensions: '3573 x 2526 px',
    renderDpi: 'Scale 3.0 dari PDF A3 landscape (1191x842 pt), setara 216 DPI (PNG density metadata: 96 dpi)',
    tileSize: 1280,
    stride: 1024,
    overlap: '20.0% ((1280 - 1024) / 1280)',
    confidence: 0.50,
    perTileNmsIou: 0.70,
    perTileCap: 300,
    globalMergeIou: 0.50,
    classAware: true,
    preprocessing: 'Crop tile 1280x1280 -> Resize ke 1024x1024 ({ fit: "fill" }) -> NCHW norm -> Scale balik bbox dengan scaleFactor 0.8 (x 1.25)',
    originalTiles: 12,
    originalRawCandidates: 152,
    originalRetainedDetections: 87,
    originalSuppressed: 65,
  };

  for (const [k, v] of Object.entries(geo2OriginalConfig)) {
    console.log(`  - ${k}: ${v}`);
  }

  // 2. Load Source Image (page_1.png)
  console.log('\n[Step 2] Memuat citra sumber 3573x2526 px (zero re-render)...');
  if (!fs.existsSync(SOURCE_IMAGE_PATH)) {
    console.error(`[BLOCKER] File citra sumber tidak ditemukan: ${SOURCE_IMAGE_PATH}`);
    process.exit(1);
  }
  const imgMeta = await sharp(SOURCE_IMAGE_PATH).metadata();
  const pageW = imgMeta.width;
  const pageH = imgMeta.height;
  if (pageW !== 3573 || pageH !== 2526) {
    console.error(`[BLOCKER] Dimensi citra tidak sesuai: ${pageW}x${pageH}. Diharapkan 3573x2526 px.`);
    process.exit(1);
  }
  const sharpRaw = await sharp(SOURCE_IMAGE_PATH).raw().toBuffer();
  const pageRgb = new Uint8Array(sharpRaw);
  console.log(`  Citra sumber dimuat: ${SOURCE_IMAGE_PATH} (${pageW} x ${pageH} px, ${Math.round(sharpRaw.length / 1024)} KB raw)`);

  // 3. Load Model Session & Verify
  console.log('\n[Step 3] Memuat sesi ONNX model...');
  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`[BLOCKER] File model tidak ditemukan: ${MODEL_PATH}`);
    process.exit(1);
  }
  const rawNames = JSON.parse(fs.readFileSync(NAMES_JSON_PATH, 'utf8'));
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  console.log(`  Model terverifikasi: ${MODEL_PATH}`);
  console.log(`  Input Name: ${session.inputNames[0]} | Output Name: ${session.outputNames[0]}`);

  // 4. Hitung Grid Tile Aktual Sebelum Inferensi
  console.log('\n[Step 4] Menghitung grid tile aktual GEO-2-DENSE sebelum inferensi:');
  const TILE_SIZE = 1280;
  const STRIDE = 640;
  const OVERLAP_PERCENT = 50.0;

  const gridDense = buildGrid(pageW, pageH, TILE_SIZE, STRIDE);
  const totalTiles = gridDense.tiles.length;
  const colsCount = gridDense.xOffsets.length;
  const rowsCount = gridDense.yOffsets.length;

  console.log(`  Ukuran Tile: ${TILE_SIZE} x ${TILE_SIZE} px`);
  console.log(`  Stride: ${STRIDE} px (Overlap: ${OVERLAP_PERCENT}%)`);
  console.log(`  Kolom Horizontal: ${colsCount} kolom (Offsets: ${gridDense.xOffsets.join(', ')})`);
  console.log(`  Baris Vertikal: ${rowsCount} baris (Offsets: ${gridDense.yOffsets.join(', ')})`);
  console.log(`  JUMLAH TILE AKTUAL: ${totalTiles} tile (${colsCount} cols x ${rowsCount} rows)`);
  console.log(`  Cakupan Tepi Kanan: X_max + Tile = ${gridDense.xOffsets[colsCount - 1]} + ${TILE_SIZE} = ${gridDense.xOffsets[colsCount - 1] + TILE_SIZE} px (PageW: ${pageW} px -> 100% Tercakup)`);
  console.log(`  Cakupan Tepi Bawah: Y_max + Tile = ${gridDense.yOffsets[rowsCount - 1]} + ${TILE_SIZE} = ${gridDense.yOffsets[rowsCount - 1] + TILE_SIZE} px (PageH: ${pageH} px -> 100% Tercakup)`);
  console.log(`  Tile Duplikat: 0 (Set unik terverifikasi)`);

  // 5. Inferensi Lokal Sekuensial Batch 1
  console.log('\n[Step 5] Menjalankan inferensi lokal sekuensial (Batch 1)...');
  const t0Infer = performance.now();
  const memStart = sampleMemory('start_geo2_dense');

  const rawTileDets = [];
  const allPageDets = [];

  for (let tIdx = 0; tIdx < totalTiles; tIdx++) {
    const tile = gridDense.tiles[tIdx];
    const { tensor, scaleFactor, validW, validH } = await extractTileTensor(pageRgb, pageW, pageH, tile, 1024);
    const tileCands = await inferTile(session, tensor, 0.50);
    const nmsKept = applyNms(tileCands, 0.70, 300);

    const tileRecord = {
      tileIndex: tile.tileIndex,
      col: tile.col,
      row: tile.row,
      offset: { x: tile.x, y: tile.y },
      tileSize: TILE_SIZE,
      candidatesPreNms: tileCands.length,
      candidatesPostNms: nmsKept.length,
      detections: [],
    };

    for (let cIdx = 0; cIdx < nmsKept.length; cIdx++) {
      const cand = nmsKept[cIdx];
      // Scale from ONNX space (1024) back to tile space (1280)
      const tileX1 = cand.bbox[0] / scaleFactor;
      const tileY1 = cand.bbox[1] / scaleFactor;
      const tileX2 = cand.bbox[2] / scaleFactor;
      const tileY2 = cand.bbox[3] / scaleFactor;

      if (tileX1 >= validW || tileY1 >= validH) continue;

      const clampedX1 = Math.max(0, Math.min(validW, tileX1));
      const clampedY1 = Math.max(0, Math.min(validH, tileY1));
      const clampedX2 = Math.max(0, Math.min(validW, tileX2));
      const clampedY2 = Math.max(0, Math.min(validH, tileY2));
      if (clampedX2 - clampedX1 < 1 || clampedY2 - clampedY1 < 1) continue;

      // Translate to page space
      const pageX1 = Math.max(0, Math.min(pageW, clampedX1 + tile.x));
      const pageY1 = Math.max(0, Math.min(pageH, clampedY1 + tile.y));
      const pageX2 = Math.max(0, Math.min(pageW, clampedX2 + tile.x));
      const pageY2 = Math.max(0, Math.min(pageH, clampedY2 + tile.y));
      if (pageX2 - pageX1 < 1 || pageY2 - pageY1 < 1) continue;

      const rawLabel = rawNames[String(cand.rawClassId)] || `class_${cand.rawClassId}`;
      const detItem = {
        tileIndex: tile.tileIndex,
        detectionIndex: cIdx,
        rawClassId: cand.rawClassId,
        rawLabel,
        confidence: cand.score,
        tileBox: { x1: tileX1, y1: tileY1, x2: tileX2, y2: tileY2 },
        pageBox: { x1: pageX1, y1: pageY1, x2: pageX2, y2: pageY2 },
      };

      tileRecord.detections.push(detItem);
      allPageDets.push(detItem);
    }

    rawTileDets.push(tileRecord);
    console.log(`    Tile ${tIdx + 1}/${totalTiles} (Offset: ${tile.x}, ${tile.y}): ${tileCands.length} raw -> ${nmsKept.length} post-NMS -> ${tileRecord.detections.length} mapped`);
  }

  const durInferMs = Math.round(performance.now() - t0Infer);
  const memEnd = sampleMemory('end_geo2_dense');

  // 6. Global Merge (IoU 0.50, class-aware = true)
  console.log('\n[Step 6] Menjalankan Global Merge (IoU 0.50, class-aware: true)...');
  const { kept: retainedDets, suppressedCount: suppCount } = mergeGlobal(allPageDets, 0.50, true);

  console.log(`  Raw Candidates Sebelum Merge: ${allPageDets.length}`);
  console.log(`  Kandidat Tertekan Merge: ${suppCount}`);
  console.log(`  KANDIDAT RETAINED SESUDAH MERGE: ${retainedDets.length}`);
  console.log(`  Durasi Inferensi: ${durInferMs} ms (${(durInferMs / 1000).toFixed(2)} detik)`);
  console.log(`  Memori Puncak RSS: ${memEnd.rssMb} MB | Heap: ${memEnd.heapUsedMb} MB`);

  // 7. Simpan Prediksi Mentah dan Retained JSON
  console.log('\n[Step 7] Menyimpan output JSON prediksi...');
  const rawJsonPath = path.join(OUTPUT_DIR, 'geo2_dense_raw_predictions.json');
  fs.writeFileSync(rawJsonPath, JSON.stringify(rawTileDets, null, 2), 'utf8');

  const retainedJsonPath = path.join(OUTPUT_DIR, 'geo2_dense_retained_detections.json');
  fs.writeFileSync(retainedJsonPath, JSON.stringify(retainedDets, null, 2), 'utf8');
  console.log(`  Disimpan: ${rawJsonPath}`);
  console.log(`  Disimpan: ${retainedJsonPath}`);

  // 8. Komparasi terhadap GEO-2 Asli (87 Deteksi)
  console.log('\n[Step 8] Melakukan komparasi diferensial terhadap GEO-2 Asli (87 Deteksi)...');
  const geo2Html = fs.readFileSync(GEO2_HTML_PATH, 'utf8');
  const geo2Match = geo2Html.match(/const data = (\{.*?\});\n/s);
  const fullPageData = JSON.parse(geo2Match[1]);
  const geo2OriginalItems = fullPageData.configs.geo2.items;
  const missedBaseline19Items = fullPageData.configs.geo2.missedBaseline;

  console.log(`  Loaded ${geo2OriginalItems.length} deteksi asli GEO-2.`);
  console.log(`  Loaded ${missedBaseline19Items.length} lokasi 19 missed baseline.`);

  const compVsGeo2 = evaluateAgainstReference(retainedDets, geo2OriginalItems, 'G2D', 0.40, 0.75);
  const matchedVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'matched').length;
  const addedVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'added').length;
  const shiftVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedGeo2 = compVsGeo2.unmatchedRef.length;

  console.log(`  HASIL KOMPARASI VS GEO-2 ASLI:`);
  console.log(`  - Matched (Tetap ditemukan & konsisten): ${matchedVsGeo2}`);
  console.log(`  - Added (Kandidat tambahan baru): ${addedVsGeo2}`);
  console.log(`  - Shift (BBox Shift / Perubahan Kelas): ${shiftVsGeo2}`);
  console.log(`  - GEO-2 Unmatched (Kandidat GEO-2 asli yang tidak matched): ${unmatchedGeo2}`);

  // 9. Evaluasi Khusus Terhadap 19 Missing Locations
  console.log('\n[Step 9] Mengevaluasi per-lokasi terhadap 19 Simbol Missing (Missed Baseline)...');
  const missingEvalResults = [];

  for (let mIdx = 0; mIdx < missedBaseline19Items.length; mIdx++) {
    const miss = missedBaseline19Items[mIdx];
    let bestOverlap = 0;
    let matchedCand = null;

    for (const cand of retainedDets) {
      const iou = computeIoU(cand.pageBox, miss.box);
      if (iou > bestOverlap) {
        bestOverlap = iou;
        matchedCand = cand;
      }
    }

    let status = 'STILL_MISSED';
    let notes = 'Tidak ada kandidat GEO-2-DENSE yang overlap (IoU < 0.20)';

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
      box: miss.box,
      status,
      overlapIoU: parseFloat(bestOverlap.toFixed(3)),
      matchedCandidate: matchedCand ? {
        label: matchedCand.rawLabel,
        confidence: matchedCand.confidence,
        box: matchedCand.pageBox,
      } : null,
      notes,
      humanReviewDecision: 'UNRESOLVED',
    };

    missingEvalResults.push(evalRecord);

    // Generate Crop for each of the 19 missing locations
    const cropFile = path.join(MISSING_CROPS_DIR, `${miss.id}.png`);
    const stroke = status === 'RECOVERED_MATCHED' ? '#00cc44' : status === 'CLASS_CONFLICT' ? '#ff9900' : '#ff3333';
    await createCropWithContext(pageRgb, pageW, pageH, miss.box, `${miss.id} ${miss.rawLabel}`, miss.confidence, cropFile, stroke);
    evalRecord.cropPath = `crops/missing-19/${miss.id}.png`;
  }

  const recoveredCount = missingEvalResults.filter((x) => x.status === 'RECOVERED_MATCHED').length;
  const conflictCount = missingEvalResults.filter((x) => x.status === 'CLASS_CONFLICT').length;
  const stillMissedCount = missingEvalResults.filter((x) => x.status === 'STILL_MISSED').length;

  console.log(`  EVALUASI 19 SIMBOL MISSING:`);
  console.log(`  - Berhasil Ditemukan (Label Cocok): ${recoveredCount} / 19`);
  console.log(`  - Konflik Kelas (Overlap tapi beda kelas): ${conflictCount} / 19`);
  console.log(`  - Tetap Missing (Tidak terdeteksi): ${stillMissedCount} / 19`);

  // 10. Generate Crops untuk Kandidat Tambahan (Added Candidates)
  console.log('\n[Step 10] Menyimpan crop berkonteks untuk kandidat tambahan...');
  const unifiedItems = compVsGeo2.evaluated.map((item, idx) => ({
    ...item,
    id: `G2D-${String(idx + 1).padStart(3, '0')}`,
  }));

  const addedItems = unifiedItems.filter((x) => x.category === 'added');
  for (const item of addedItems) {
    const cropFile = path.join(CROPS_DIR, `${item.id}.png`);
    await createCropWithContext(pageRgb, pageW, pageH, item.pageBox, item.rawLabel, item.confidence, cropFile, '#0088ff');
    item.cropPath = `crops/${item.id}.png`;
  }
  console.log(`  Disimpan ${addedItems.length} crop kandidat tambahan di ${CROPS_DIR}`);

  // 11. Generate Full-Page Overlays (GEO-2-DENSE & Side-by-side)
  console.log('\n[Step 11] Mengompositkan overlay full-page 3573x2526 px...');

  function buildOverlaySvg(title, candidates, unmatchedRef, missingItems = []) {
    const lines = [
      `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
      `<style>
        .bbox-matched { stroke: #00cc44; stroke-width: 3; fill: rgba(0, 204, 68, 0.08); }
        .bbox-added   { stroke: #0088ff; stroke-width: 3; fill: rgba(0, 136, 255, 0.08); }
        .bbox-shift   { stroke: #ff9900; stroke-width: 3; fill: rgba(255, 153, 0, 0.08); }
        .bbox-unmatched { stroke: #ff3333; stroke-width: 3; stroke-dasharray: 8,6; fill: rgba(255, 51, 51, 0.04); }
        .bbox-missing { stroke: #c084fc; stroke-width: 3; stroke-dasharray: 6,4; fill: rgba(192, 132, 252, 0.05); }

        .lbl-bg { fill: rgba(15, 23, 42, 0.90); rx: 3; ry: 3; }
        .lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 14px; font-weight: bold; }

        .legend-card { fill: rgba(15, 23, 42, 0.94); stroke: rgba(255, 255, 255, 0.2); stroke-width: 2; rx: 8; ry: 8; }
        .leg-title { fill: #ffffff; font-family: sans-serif; font-size: 20px; font-weight: bold; }
        .leg-text { fill: #e2e8f0; font-family: sans-serif; font-size: 15px; }
      </style>`,
    ];

    // Unmatched GEO-2 Asli (Merah Putus-putus)
    for (const m of unmatchedRef) {
      const x1 = Math.round(m.pageBox.x1);
      const y1 = Math.round(m.pageBox.y1);
      const w = Math.max(1, Math.round(m.pageBox.x2 - m.pageBox.x1));
      const h = Math.max(1, Math.round(m.pageBox.y2 - m.pageBox.y1));
      lines.push(`<rect class="bbox-unmatched" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);
      const txt = `[GEO-2 Hilang] ${m.rawLabel}`;
      const lblW = Math.round(txt.length * 9 + 12);
      const lblX = Math.max(4, Math.min(pageW - lblW - 4, x1));
      const lblY = Math.max(4, Math.min(pageH - 24, y1 - 22));
      lines.push(
        `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="20" />`,
        `<text class="lbl-txt" x="${lblX + 6}" y="${lblY + 15}" fill="#ff6666">${escapeXml(txt)}</text>`,
      );
    }

    // Kandidat Aktif GEO-2-DENSE
    for (const c of candidates) {
      const x1 = Math.round(c.pageBox.x1);
      const y1 = Math.round(c.pageBox.y1);
      const w = Math.max(1, Math.round(c.pageBox.x2 - c.pageBox.x1));
      const h = Math.max(1, Math.round(c.pageBox.y2 - c.pageBox.y1));

      let cls = 'bbox-added';
      let textColor = '#88ccff';
      if (c.category === 'matched') {
        cls = 'bbox-matched';
        textColor = '#66ff99';
      } else if (c.category === 'shift') {
        cls = 'bbox-shift';
        textColor = '#ffcc66';
      }

      lines.push(`<rect class="${cls}" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);

      const txt = `${c.id} ${c.rawLabel} ${(c.confidence * 100).toFixed(0)}%`;
      const lblW = Math.round(txt.length * 9 + 14);
      const lblX = Math.max(4, Math.min(pageW - lblW - 4, x1));
      const lblY = Math.max(4, Math.min(pageH - 24, y1 - 22));

      lines.push(
        `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="20" />`,
        `<text class="lbl-txt" x="${lblX + 6}" y="${lblY + 15}" fill="${textColor}">${escapeXml(txt)}</text>`,
      );
    }

    // 19 Missing Locations (Ungu Putus-putus)
    for (const miss of missingItems) {
      const x1 = Math.round(miss.box.x1);
      const y1 = Math.round(miss.box.y1);
      const w = Math.max(1, Math.round(miss.box.x2 - miss.box.x1));
      const h = Math.max(1, Math.round(miss.box.y2 - miss.box.y1));
      lines.push(`<rect class="bbox-missing" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);
    }

    // Legenda Banner
    const legW = 600;
    const legH = 220;
    lines.push(
      `<rect class="legend-card" x="30" y="30" width="${legW}" height="${legH}" />`,
      `<text class="leg-title" x="50" y="65">${escapeXml(title)}</text>`,

      `<rect x="50" y="85" width="22" height="15" fill="#00cc44" rx="3" />`,
      `<text class="leg-text" x="85" y="98">Hijau: Matched dengan GEO-2 Asli</text>`,

      `<rect x="50" y="115" width="22" height="15" fill="#0088ff" rx="3" />`,
      `<text class="leg-text" x="85" y="128">Biru: Kandidat Tambahan Baru</text>`,

      `<rect x="50" y="145" width="22" height="15" fill="#ff9900" rx="3" />`,
      `<text class="leg-text" x="85" y="158">Oranye: Perubahan Kelas / BBox Shift</text>`,

      `<line x1="50" y1="182" x2="72" y2="182" stroke="#ff3333" stroke-width="3" stroke-dasharray="6,4" />`,
      `<text class="leg-text" x="85" y="187">Merah Putus-putus: GEO-2 Asli Tidak Matched</text>`,

      `<line x1="50" y1="208" x2="72" y2="208" stroke="#c084fc" stroke-width="3" stroke-dasharray="6,4" />`,
      `<text class="leg-text" x="85" y="213">Ungu Putus-putus: Lokasi 19 Missing Evaluasi</text>`,
    );

    lines.push('</svg>');
    return lines.join('\n');
  }

  const overlaySvgStr = buildOverlaySvg(
    `GEO-2-DENSE (Tile 1280, Stride 640, Overlap 50%) - Total: ${unifiedItems.length}`,
    unifiedItems,
    compVsGeo2.unmatchedRef,
    missingEvalResults,
  );

  const overlayPngPath = path.join(OUTPUT_DIR, '02_geo2_dense_overlay.png');
  await sharp(SOURCE_IMAGE_PATH)
    .composite([{ input: Buffer.from(overlaySvgStr) }])
    .png()
    .toFile(overlayPngPath);
  console.log(`  Overlay PNG GEO-2-DENSE: ${overlayPngPath}`);

  // Salin overlay GEO-2 Asli untuk perbandingan berdampingan
  const geo2OriginalOverlaySrc = path.join(
    REPO_ROOT,
    'fixtures/diagnostics/tuning-experiments/review-package/full-page/04_geo2_tile1280_overlay.png',
  );
  const geo2OriginalOverlayDst = path.join(OUTPUT_DIR, '01_geo2_original_overlay.png');
  fs.copyFileSync(geo2OriginalOverlaySrc, geo2OriginalOverlayDst);
  console.log(`  Disalin overlay GEO-2 asli: ${geo2OriginalOverlayDst}`);

  // 12. Build Offline Interactive HTML Viewer
  console.log('\n[Step 12] Membangun viewer HTML interaktif lokal dengan side-by-side & evaluasi 19 missing...');

  const htmlPayload = JSON.stringify({
    pageWidth: pageW,
    pageHeight: pageH,
    items: unifiedItems,
    unmatchedGeo2: compVsGeo2.unmatchedRef,
    originalGeo2Items: geo2OriginalItems,
    missingEvaluation: missingEvalResults,
    summary: {
      originalGeo2: {
        totalTiles: 12,
        tileSize: 1280,
        stride: 1024,
        overlapPct: '20.0%',
        rawCandidates: 152,
        retainedCandidates: 87,
        suppressed: 65,
      },
      geo2Dense: {
        totalTiles,
        tileSize: TILE_SIZE,
        stride: STRIDE,
        overlapPct: `${OVERLAP_PERCENT}%`,
        durationMs: durInferMs,
        rawCandidates: allPageDets.length,
        retainedCandidates: retainedDets.length,
        suppressed: suppCount,
      },
      comparison: {
        matched: matchedVsGeo2,
        added: addedVsGeo2,
        shift: shiftVsGeo2,
        unmatchedOriginal: unmatchedGeo2,
      },
      missing19Summary: {
        total: 19,
        recoveredMatched: recoveredCount,
        classConflict: conflictCount,
        stillMissed: stillMissedCount,
      },
    },
  });

  const htmlSource = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>P&ID Tuning — Eksperimen GEO-2-DENSE (Tile 1280, Overlap 50%)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; z-index: 20; flex-wrap: wrap; gap: 8px; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo-badge { font-weight: bold; font-size: 13px; background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; }
    .page-title { font-size: 14px; font-weight: 600; color: #e2e8f0; }

    .nav-tabs { display: flex; gap: 4px; background: #0f172a; padding: 3px; border-radius: 6px; border: 1px solid #334155; }
    .tab-btn { background: transparent; color: #94a3b8; border: none; padding: 5px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .tab-btn.active { background: #3b82f6; color: white; font-weight: 600; }

    .ctrl-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ctrl-group { display: flex; align-items: center; gap: 6px; background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; }
    .ctrl-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
    select, button { background: #1e293b; color: #f8fafc; border: 1px solid #475569; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; outline: none; }
    select:hover, button:hover { background: #334155; }

    .workspace { display: flex; flex: 1; height: calc(100vh - 54px); overflow: hidden; position: relative; }
    .main-view { flex: 1; display: flex; height: 100%; position: relative; overflow: hidden; }
    .viewport { flex: 1; background: #020617; overflow: hidden; position: relative; cursor: grab; user-select: none; }
    .viewport:active { cursor: grabbing; }

    .canvas-stage { position: absolute; transform-origin: 0 0; will-change: transform; }
    .stage-img { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; display: block; pointer-events: none; }
    .stage-svg { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; pointer-events: none; }

    .svg-bbox { stroke-width: 3; fill-opacity: 0.08; }
    .svg-bbox-matched { stroke: #00cc44; fill: #00cc44; }
    .svg-bbox-added   { stroke: #0088ff; fill: #0088ff; }
    .svg-bbox-shift   { stroke: #ff9900; fill: #ff9900; }
    .svg-bbox-unmatched { stroke: #ff3333; stroke-dasharray: 8,6; fill: #ff3333; fill-opacity: 0.04; }
    .svg-bbox-missing { stroke: #c084fc; stroke-width: 3; stroke-dasharray: 6,4; fill: #c084fc; fill-opacity: 0.05; }

    .svg-lbl-bg { fill: rgba(15, 23, 42, 0.90); rx: 3; ry: 3; }
    .svg-lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 14px; font-weight: bold; }

    .sidebar { width: 380px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; z-index: 10; }
    .sidebar-header { padding: 12px; border-bottom: 1px solid #334155; }
    .sidebar-title { font-size: 13px; font-weight: 600; color: #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .sidebar-content { flex: 1; overflow-y: auto; padding: 12px; }

    .summary-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 12px; }
    .sum-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
    .sum-val { font-size: 16px; font-weight: bold; }

    .item-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px; font-size: 12px; cursor: pointer; transition: border-color 0.15s; }
    .item-card:hover { border-color: #3b82f6; }
    .item-card.active { border-color: #60a5fa; background: #172554; }

    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
    .badge-matched { background: rgba(0, 204, 68, 0.2); color: #4ade80; border: 1px solid #22c55e; }
    .badge-added { background: rgba(0, 136, 255, 0.2); color: #60a5fa; border: 1px solid #3b82f6; }
    .badge-shift { background: rgba(255, 153, 0, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .badge-unmatched { background: rgba(255, 51, 51, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .badge-missing { background: rgba(192, 132, 252, 0.2); color: #c084fc; border: 1px solid #a855f7; }

    .missing-row { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: #0f172a; border-radius: 6px; border: 1px solid #334155; margin-bottom: 8px; font-size: 12px; cursor: pointer; }
    .missing-row:hover { border-color: #a855f7; }

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
      <span class="logo-badge">GEO-2-DENSE</span>
      <span class="page-title">P&ID Tuning — Eksperimen GEO-2-DENSE (Tile 1280, Overlap 50%)</span>
      <div class="nav-tabs">
        <button class="tab-btn active" id="tabFullView">Full View</button>
        <button class="tab-btn" id="tabMissing19">19 Missing Review</button>
      </div>
    </div>

    <div class="ctrl-bar">
      <div class="ctrl-group">
        <span class="ctrl-label">Mode:</span>
        <select id="modeSelect">
          <option value="dense" selected>GEO-2-DENSE (15 Tiles, Overlap 50%)</option>
          <option value="original">GEO-2 Asli (12 Tiles, Overlap 20%)</option>
        </select>
      </div>

      <div class="ctrl-group">
        <label class="ctrl-label"><input type="checkbox" id="chkBbox" checked> BBoxes</label>
        <label class="ctrl-label"><input type="checkbox" id="chkLabels" checked> Labels</label>
        <label class="ctrl-label"><input type="checkbox" id="chkMissingRef" checked> 19 Missing</label>
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
    <div class="main-view">
      <div class="viewport" id="viewport">
        <div class="canvas-stage" id="stage">
          <img class="stage-img" id="pageImg" src="02_geo2_dense_overlay.png" alt="Overlay">
          <svg class="stage-svg" id="stageSvg" viewBox="0 0 ${pageW} ${pageH}"></svg>
        </div>
      </div>
    </div>

    <div class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <span id="sidebarHeaderTitle">Ringkasan GEO-2-DENSE</span>
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
    let currentTab = 'full'; // 'full' | 'missing'
    let currentMode = 'dense'; // 'dense' | 'original'

    const viewport = document.getElementById('viewport');
    const stage = document.getElementById('stage');
    const stageSvg = document.getElementById('stageSvg');
    const pageImg = document.getElementById('pageImg');
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

    // Panning & Zooming
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
      const newScale = Math.max(0.08, Math.min(6.0, scale * zoomFactor));

      panX = mouseX - (mouseX - panX) * (newScale / scale);
      panY = mouseY - (mouseY - panY) * (newScale / scale);
      scale = newScale;
      updateTransform();
    }, { passive: false });

    document.getElementById('btnZoomIn').onclick = () => { scale = Math.min(6.0, scale * 1.25); updateTransform(); };
    document.getElementById('btnZoomOut').onclick = () => { scale = Math.max(0.08, scale / 1.25); updateTransform(); };
    document.getElementById('btnFit').onclick = fitToScreen;

    function renderView() {
      const showBbox = document.getElementById('chkBbox').checked;
      const showLabels = document.getElementById('chkLabels').checked;
      const showMissingRef = document.getElementById('chkMissingRef').checked;

      stageSvg.innerHTML = '';

      if (currentMode === 'original') {
        pageImg.src = '01_geo2_original_overlay.png';
        sidebarHeaderTitle.textContent = 'GEO-2 Asli (Tile 1280, Overlap 20%)';
        itemCountBadge.textContent = \`\${data.summary.originalGeo2.retainedCandidates} Detections\`;
        renderOriginalSidebar();
        return;
      }

      pageImg.src = '02_geo2_dense_overlay.png';

      if (currentTab === 'full') {
        sidebarHeaderTitle.textContent = 'GEO-2-DENSE (Overlap 50%)';
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
      let html = \`
        <div class="summary-card">
          <div style="font-weight:bold; color:#60a5fa;">Komparasi Diferensial vs GEO-2 Asli:</div>
          <div class="sum-grid">
            <div>Matched (Tetap): <span class="sum-val" style="color:#4ade80;">\${s.comparison.matched}</span></div>
            <div>Added (Baru): <span class="sum-val" style="color:#60a5fa;">\${s.comparison.added}</span></div>
            <div>Shift: <span class="sum-val" style="color:#fbbf24;">\${s.comparison.shift}</span></div>
            <div>GEO-2 Hilang: <span class="sum-val" style="color:#f87171;">\${s.comparison.unmatchedOriginal}</span></div>
          </div>
          <div style="margin-top:6px; color:#94a3b8; font-size:11px;">
            Tiles: \${s.geo2Dense.totalTiles} (asli: \${s.originalGeo2.totalTiles}) | Waktu: \${(s.geo2Dense.durationMs/1000).toFixed(1)}s
          </div>
        </div>
      \`;

      data.items.forEach((item) => {
        let bClass = 'badge-added';
        if (item.category === 'matched') bClass = 'badge-matched';
        else if (item.category === 'shift') bClass = 'badge-shift';

        html += \`
          <div class="item-card" onclick="focusOnBox(\${item.pageBox.x1}, \${item.pageBox.y1}, \${item.pageBox.x2}, \${item.pageBox.y2})">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>\${item.id} \${item.rawLabel}</strong>
              <span class="badge \${bClass}">\${item.category}</span>
            </div>
            <div style="color:#94a3b8; font-size:11px; margin-top:4px;">
              Confidence: \${(item.confidence * 100).toFixed(1)}% | Tile: \${item.tileIndex}
            </div>
            \${item.cropPath ? \`<button style="margin-top:4px; font-size:10px; padding:2px 6px;" onclick="event.stopPropagation(); openCrop('\${item.cropPath}', '\${item.id} \${item.rawLabel}', 'Confidence: \${(item.confidence*100).toFixed(1)}% | Status: \${item.category}', 'Kandidat Tambahan Baru')">Lihat Crop</button>\` : ''}
          </div>
        \`;
      });

      sidebarContent.innerHTML = html;
    }

    function renderMissingSidebar() {
      const s = data.summary.missing19Summary;
      let html = \`
        <div class="summary-card">
          <div style="font-weight:bold; color:#c084fc;">Hasil Evaluasi 19 Missing (Missed Baseline):</div>
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
          <div class="missing-row" onclick="focusOnBox(\${m.box.x1}, \${m.box.y1}, \${m.box.x2}, \${m.box.y2})">
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

    function renderOriginalSidebar() {
      let html = \`
        <div class="summary-card">
          <div style="font-weight:bold; color:#94a3b8;">Metadata GEO-2 Asli:</div>
          <div style="margin-top:6px; font-size:11px; color:#cbd5e1;">
            Tile Size: 1280x1280 px<br>
            Stride: 1024 px (Overlap 20%)<br>
            Jumlah Tile: 12 tile<br>
            Retained Candidates: 87
          </div>
        </div>
      \`;

      data.originalGeo2Items.forEach((item) => {
        html += \`
          <div class="item-card" onclick="focusOnBox(\${item.box.x1}, \${item.box.y1}, \${item.box.x2}, \${item.box.y2})">
            <div style="display:flex; justify-content:space-between;">
              <strong>\${item.id} \${item.rawLabel}</strong>
              <span class="badge badge-matched">GEO-2 Asli</span>
            </div>
            <div style="color:#94a3b8; font-size:11px; margin-top:4px;">
              Confidence: \${(item.confidence * 100).toFixed(1)}%
            </div>
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

      scale = 2.0;
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

    document.getElementById('modeSelect').onchange = (e) => {
      currentMode = e.target.value;
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

  // 13. Tulis Manifest Telemetri Lengkap
  console.log('\n[Step 13] Menulis manifest telemetri lengkap...');
  const manifestData = {
    schemaVersion: 'geo2-dense-v1',
    generatedAt: new Date().toISOString(),
    reconstructionGEO2: geo2OriginalConfig,
    experimentGEO2Dense: {
      id: 'GEO-2-DENSE',
      name: 'GEO-2-DENSE (Tile 1280x1280, Stride 640, Overlap 50%)',
      tileSize: TILE_SIZE,
      stride: STRIDE,
      overlapPercent: OVERLAP_PERCENT,
      grid: {
        colsCount,
        rowsCount,
        totalTiles,
        xOffsets: gridDense.xOffsets,
        yOffsets: gridDense.yOffsets,
      },
      durationMs: durInferMs,
      memoryUsage: { start: memStart, end: memEnd },
      rawCandidatesTotal: allPageDets.length,
      retainedCandidatesTotal: retainedDets.length,
      suppressedByMerge: suppCount,
      comparisonVsOriginalGEO2: {
        originalTotal: geo2OriginalItems.length,
        matched: matchedVsGeo2,
        added: addedVsGeo2,
        shift: shiftVsGeo2,
        unmatchedOriginal: unmatchedGeo2,
      },
      missing19Evaluation: {
        total: 19,
        recoveredMatched: recoveredCount,
        classConflict: conflictCount,
        stillMissed: stillMissedCount,
        details: missingEvalResults,
      },
      files: {
        rawPredictions: 'geo2_dense_raw_predictions.json',
        retainedDetections: 'geo2_dense_retained_detections.json',
        overlayDense: '02_geo2_dense_overlay.png',
        overlayOriginal: '01_geo2_original_overlay.png',
        htmlViewer: 'index.html',
        cropsDir: 'crops',
        missing19CropsDir: 'crops/missing-19',
      },
    },
    humanDecisionStatus: 'ALL_UNRESOLVED',
    note: 'Seluruh kandidat tambahan disajikan untuk review manusia. Tambahan deteksi belum dapat diasumsikan benar tanpa konfirmasi visual.',
  };

  const manifestPath = path.join(OUTPUT_DIR, 'geo2-dense-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
  console.log(`  Telemetry Manifest: ${manifestPath}`);
  console.log('\n[SUCCESS] Eksperimen GEO-2-DENSE Selesai!');
}

main().catch((err) => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
