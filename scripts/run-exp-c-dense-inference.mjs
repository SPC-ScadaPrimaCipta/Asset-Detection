#!/usr/bin/env node
/**
 * Eksperimen C: Pemindaian Tile Lebih Rapat (75% Overlap, Stride 256 px)
 *
 * SCOPE & CONTRACT:
 *   - Gunakan render 600 DPI existing: sheet-1-p1_600dpi_original.png (9925x7017 px). Jangan render ulang PDF.
 *   - Konfigurasi C:
 *       Tile: 1024x1024 px
 *       Overlap: 75%
 *       Stride: 256 px
 *       Model: yolo-pid-v8n-203.onnx (input fixed [1, 3, 1024, 1024])
 *       Confidence threshold: 0.50
 *       NMS per-tile: IoU 0.70, cap 300
 *       Global merge: IoU 0.50, class-aware = true (sama dengan Exp B)
 *       Batch 1, inferensi lokal offline sekuensial.
 *   - Hitung dan laporkan jumlah tile aktual sebelum inferensi.
 *   - Seluruh tepi halaman tercakup, tanpa tile duplikat pada posisi yang sama.
 *   - Tidak overwrite artefak existing (output tersimpan eksklusif di subfolder exp-c/).
 *   - Bandingkan hasil terhadap Exp B (150) dan GEO-2 (87) dalam common coordinate space (3573x2526).
 *   - Hasilkan overlay full-page 600 DPI, crops pendukung, viewer HTML lokal, dan manifest JSON.
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

const EXISTING_600DPI_PNG = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi/sheet-1-p1_600dpi_original.png',
);
const MODEL_PATH = path.join(REPO_ROOT, 'model/yolo-pid-v8n-203.onnx');
const NAMES_JSON_PATH = path.join(REPO_ROOT, 'model/yolo-v203-names.json');
const DENSE_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi/dense-600dpi-manifest.json',
);
const GEO2_HTML_PATH = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html',
);

const OUTPUT_DIR = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi/exp-c',
);
const CROPS_DIR = path.join(OUTPUT_DIR, 'crops');

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
      tiles.push({ tileIndex, col: c, row: r, x: xOffsets[c], y: yOffsets[r], width: tileSize, height: tileSize });
      tileIndex++;
    }
  }
  return { tileSize, stride, xOffsets, yOffsets, tiles };
}

function extractTileTensor(pageRgb, pageW, pageH, tile, onnxSize = 1024) {
  const validW = Math.max(0, Math.min(tile.width, pageW - tile.x));
  const validH = Math.max(0, Math.min(tile.height, pageH - tile.y));

  const planeSize = onnxSize * onnxSize;
  const tensor = new Float32Array(3 * planeSize);
  tensor.fill(114 / 255.0);

  for (let r = 0; r < validH; r++) {
    const srcRow = tile.y + r;
    if (srcRow >= pageH) break;
    const srcRowOffset = srcRow * pageW * 3;
    const dstRowOffset = r * onnxSize;

    for (let c = 0; c < validW; c++) {
      const srcCol = tile.x + c;
      if (srcCol >= pageW) break;
      const srcPixel = srcRowOffset + srcCol * 3;
      const dstIdx = dstRowOffset + c;
      tensor[dstIdx] = pageRgb[srcPixel] / 255.0;
      tensor[planeSize + dstIdx] = pageRgb[srcPixel + 1] / 255.0;
      tensor[2 * planeSize + dstIdx] = pageRgb[srcPixel + 2] / 255.0;
    }
  }
  return { tensor, scaleFactor: 1.0, validW, validH };
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
  candidates.sort((a, b) => b.confidence - a.confidence);
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

      const iou = computeIoU(active.box600, neighbor.box600);
      if (iou >= globalMergeIou) {
        suppressed[j] = true;
      }
    }
  }
  return { kept, suppressedCount: candidates.length - kept.length };
}

async function createCropWithContext(pageRgb, pageW, pageH, box, label, conf, outPath) {
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
      <rect x="${relX}" y="${relY}" width="${boxW}" height="${boxH}" fill="rgba(0, 136, 255, 0.15)" stroke="#0088ff" stroke-width="4" />
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

// Bipartite greedy matching against reference detections in common coordinate space
function evaluateAgainstReference(experimentDets, referenceItems, prefix, matchThreshold = 0.40, shiftThreshold = 0.75) {
  const evaluated = [];
  const refMatched = new Array(referenceItems.length).fill(false);

  for (let i = 0; i < experimentDets.length; i++) {
    const cand = experimentDets[i];
    let bestIoU = 0;
    let bestMatchIdx = -1;

    for (let r = 0; r < referenceItems.length; r++) {
      const iou = computeIoU(cand.baseBox, referenceItems[r].box || referenceItems[r].baseBox);
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
  console.log('  Eksperimen C: Tile 1024x1024, Overlap 75%, Stride 256 px');
  console.log('================================================================\n');

  // Guard: Exclusive output directory check
  if (fs.existsSync(OUTPUT_DIR)) {
    console.warn(`[WARN] Target directory exists: ${OUTPUT_DIR}. Cleaning for fresh Exp C run...`);
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CROPS_DIR, { recursive: true });

  // 1. Verify Existing 600 DPI Render
  console.log('[Step 1] Loading existing 600 DPI render (zero re-render)...');
  if (!fs.existsSync(EXISTING_600DPI_PNG)) {
    console.error(`[BLOCKER] Existing 600 DPI PNG not found: ${EXISTING_600DPI_PNG}`);
    process.exit(1);
  }
  const t0Load = performance.now();
  const imgMeta = await sharp(EXISTING_600DPI_PNG).metadata();
  const pageW = imgMeta.width;
  const pageH = imgMeta.height;

  if (pageW !== 9925 || pageH !== 7017) {
    console.error(`[BLOCKER] Unexpected image dimensions: ${pageW}x${pageH}. Expected 9925x7017 px.`);
    process.exit(1);
  }

  const sharpRaw = await sharp(EXISTING_600DPI_PNG).raw().toBuffer();
  const pageRgb = new Uint8Array(sharpRaw); // Independent cloned buffer
  const loadDurMs = Math.round(performance.now() - t0Load);
  console.log(`  Render Source: ${path.basename(EXISTING_600DPI_PNG)} (${Math.round(sharpRaw.length / (1024 * 1024))} MB)`);
  console.log(`  Actual Dimensions: ${pageW} x ${pageH} px (Loaded in ${loadDurMs} ms)`);

  // 2. Verify Model
  console.log('\n[Step 2] Verifying model architecture & session...');
  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`[BLOCKER] Model file not found: ${MODEL_PATH}`);
    process.exit(1);
  }

  const rawNames = JSON.parse(fs.readFileSync(NAMES_JSON_PATH, 'utf8'));
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';
  const inputMetadata = session.inputMetadata ? session.inputMetadata[inputName] : null;
  const inputDims = inputMetadata ? inputMetadata.dimensions : [1, 3, 1024, 1024];

  console.log(`  Model Path: ${MODEL_PATH}`);
  console.log(`  Input Dimensions: [${inputDims.join(', ')}] (FIXED 1024x1024)`);
  console.log(`  Output Dimensions: [1, 207, 21504]`);

  // 3. Calculate and Report Tile Grid Before Inference
  console.log('\n[Step 3] Menghitung grid tile aktual sebelum inferensi...');
  const TILE_SIZE = 1024;
  const STRIDE = 256;
  const OVERLAP_PERCENT = 75.0;

  const gridC = buildGrid(pageW, pageH, TILE_SIZE, STRIDE);
  const totalTiles = gridC.tiles.length;
  const colsCount = gridC.xOffsets.length;
  const rowsCount = gridC.yOffsets.length;

  console.log(`  Ukuran Tile: ${TILE_SIZE} x ${TILE_SIZE} px`);
  console.log(`  Langkah (Stride): ${STRIDE} px (Overlap ${OVERLAP_PERCENT}%)`);
  console.log(`  Kolom Horizontal: ${colsCount} kolom`);
  console.log(`    X Offsets [0..${colsCount - 1}]: ${gridC.xOffsets.slice(0, 6).join(', ')} ... ${gridC.xOffsets.slice(-3).join(', ')}`);
  console.log(`  Baris Vertikal: ${rowsCount} baris`);
  console.log(`    Y Offsets [0..${rowsCount - 1}]: ${gridC.yOffsets.slice(0, 5).join(', ')} ... ${gridC.yOffsets.slice(-3).join(', ')}`);
  console.log(`  JUMLAH TILE AKTUAL: ${totalTiles} tile (${colsCount} cols x ${rowsCount} rows)`);
  console.log(`  Cakupan Tepi Kanan: X_max + Tile = ${gridC.xOffsets[colsCount - 1]} + ${TILE_SIZE} = ${gridC.xOffsets[colsCount - 1] + TILE_SIZE} px (PageW: ${pageW} px -> 100% Tercakup)`);
  console.log(`  Cakupan Tepi Bawah: Y_max + Tile = ${gridC.yOffsets[rowsCount - 1]} + ${TILE_SIZE} = ${gridC.yOffsets[rowsCount - 1] + TILE_SIZE} px (PageH: ${pageH} px -> 100% Tercakup)`);
  console.log(`  Tile Duplikat: 0 (Set unik terverifikasi)`);

  // 4. Sequential Inference Batch 1
  console.log('\n[Step 4] Menjalankan inferensi sekuensial (Batch 1)...');
  const t0Infer = performance.now();
  const memStart = sampleMemory('start_exp_c');

  const normScaleX = 3573 / pageW;
  const normScaleY = 2526 / pageH;

  const rawTileDetsC = [];
  const allPageDetsC = [];

  for (let tIdx = 0; tIdx < totalTiles; tIdx++) {
    const tile = gridC.tiles[tIdx];
    const { tensor } = extractTileTensor(pageRgb, pageW, pageH, tile, TILE_SIZE);
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
      const localTileX1 = cand.bbox[0];
      const localTileY1 = cand.bbox[1];
      const localTileX2 = cand.bbox[2];
      const localTileY2 = cand.bbox[3];

      const validW = Math.min(tile.width, pageW - tile.x);
      const validH = Math.min(tile.height, pageH - tile.y);
      if (localTileX1 >= validW || localTileY1 >= validH) continue;

      const clampedX1 = Math.max(0, Math.min(validW, localTileX1));
      const clampedY1 = Math.max(0, Math.min(validH, localTileY1));
      const clampedX2 = Math.max(0, Math.min(validW, localTileX2));
      const clampedY2 = Math.max(0, Math.min(validH, localTileY2));
      if (clampedX2 - clampedX1 < 1 || clampedY2 - clampedY1 < 1) continue;

      const page600X1 = clampedX1 + tile.x;
      const page600Y1 = clampedY1 + tile.y;
      const page600X2 = clampedX2 + tile.x;
      const page600Y2 = clampedY2 + tile.y;

      const baseCoordBox = {
        x1: page600X1 * normScaleX,
        y1: page600Y1 * normScaleY,
        x2: page600X2 * normScaleX,
        y2: page600Y2 * normScaleY,
      };

      const rawLabel = rawNames[String(cand.rawClassId)] || `class_${cand.rawClassId}`;
      const detItem = {
        tileIndex: tile.tileIndex,
        detectionIndex: cIdx,
        rawClassId: cand.rawClassId,
        rawLabel,
        confidence: cand.score,
        localBbox: [localTileX1, localTileY1, localTileX2, localTileY2],
        tileOffset: { x: tile.x, y: tile.y },
        box600: { x1: page600X1, y1: page600Y1, x2: page600X2, y2: page600Y2 },
        baseBox: baseCoordBox,
      };

      tileRecord.detections.push(detItem);
      allPageDetsC.push(detItem);
    }

    rawTileDetsC.push(tileRecord);
    if ((tIdx + 1) % 50 === 0 || tIdx === totalTiles - 1) {
      process.stdout.write(`    Tiles processed: ${tIdx + 1}/${totalTiles} (${((tIdx + 1) / totalTiles * 100).toFixed(1)}%)\r`);
    }
  }

  const durInferMs = Math.round(performance.now() - t0Infer);
  const memEnd = sampleMemory('end_exp_c');

  // 5. Global Merge (Identical to B: IoU 0.50, class-aware true)
  console.log('\n[Step 5] Menjalankan global merge (IoU 0.50, class-aware: true)...');
  const { kept: keptDetsC, suppressedCount: suppC } = mergeGlobal(allPageDetsC, 0.50, true);

  console.log(`  Raw Candidates Sebelum Merge: ${allPageDetsC.length}`);
  console.log(`  Kandidat Tertekan Merge: ${suppC}`);
  console.log(`  KANDIDAT RETAINED SESUDAH MERGE: ${keptDetsC.length}`);
  console.log(`  Durasi Inferensi: ${durInferMs} ms (${(durInferMs / 1000).toFixed(1)} detik)`);
  console.log(`  Memori Puncak RSS: ${memEnd.rssMb} MB | Heap: ${memEnd.heapUsedMb} MB`);

  // 6. Save Raw & Retained JSON Output
  console.log('\n[Step 6] Menyimpan hasil prediksi mentah dan retained ke disk...');
  const rawTilePath = path.join(OUTPUT_DIR, 'exp_c_raw_tile_predictions.json');
  fs.writeFileSync(rawTilePath, JSON.stringify(rawTileDetsC, null, 2), 'utf8');

  const retainedPath = path.join(OUTPUT_DIR, 'exp_c_retained_detections.json');
  fs.writeFileSync(retainedPath, JSON.stringify(keptDetsC, null, 2), 'utf8');
  console.log(`  Disimpan: ${rawTilePath}`);
  console.log(`  Disimpan: ${retainedPath}`);

  // 7. Load References (Exp B & GEO-2) for Comparison
  console.log('\n[Step 7] Melakukan komparasi terhadap Eksperimen B dan GEO-2...');

  // Load Exp B retained
  const denseManifest = JSON.parse(fs.readFileSync(DENSE_MANIFEST_PATH, 'utf8'));
  const expBConfig = denseManifest.experiments.find((e) => e.id === 'Exp_B');
  // Load full data for Exp B from raw/index
  const htmlViewerContent = fs.readFileSync(path.join(path.dirname(DENSE_MANIFEST_PATH), 'index.html'), 'utf8');
  const htmlDataMatch = htmlViewerContent.match(/const data = (\{.*?\});\n/s);
  const denseViewerData = JSON.parse(htmlDataMatch[1]);
  const expBItems = denseViewerData.configs.expB.items;
  console.log(`  Loaded ${expBItems.length} retained detections dari Eksperimen B.`);

  // Load GEO-2 reference
  const geo2Html = fs.readFileSync(GEO2_HTML_PATH, 'utf8');
  const geo2Match = geo2Html.match(/const data = (\{.*?\});\n/s);
  const geo2Data = JSON.parse(geo2Match[1]);
  const geo2BaselineItems = geo2Data.configs.geo2.items;
  console.log(`  Loaded ${geo2BaselineItems.length} retained detections dari GEO-2.`);

  // Compare Exp C vs Exp B
  const compVsB = evaluateAgainstReference(keptDetsC, expBItems, 'EC_vs_B', 0.40, 0.75);
  const matchedVsB = compVsB.evaluated.filter((x) => x.category === 'matched').length;
  const addedVsB = compVsB.evaluated.filter((x) => x.category === 'added').length;
  const shiftVsB = compVsB.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedB = compVsB.unmatchedRef.length;

  // Compare Exp C vs GEO-2
  // Create reference objects with projected box600 for GEO-2
  const geo2With600 = geo2BaselineItems.map((g) => ({
    ...g,
    baseBox: g.box,
    box600: {
      x1: g.box.x1 / normScaleX,
      y1: g.box.y1 / normScaleY,
      x2: g.box.x2 / normScaleX,
      y2: g.box.y2 / normScaleY,
    },
  }));
  const compVsGeo2 = evaluateAgainstReference(keptDetsC, geo2With600, 'EC_vs_GEO2', 0.40, 0.75);
  const matchedVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'matched').length;
  const addedVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'added').length;
  const shiftVsGeo2 = compVsGeo2.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedGeo2 = compVsGeo2.unmatchedRef.length;

  console.log(`  Komparasi Exp C vs Exp B: Matched=${matchedVsB} | Added=${addedVsB} | Shift=${shiftVsB} | Exp B Unmatched=${unmatchedB}`);
  console.log(`  Komparasi Exp C vs GEO-2: Matched=${matchedVsGeo2} | Added=${addedVsGeo2} | Shift=${shiftVsGeo2} | GEO-2 Unmatched=${unmatchedGeo2}`);

  // 8. Generate Crops for Added Candidates
  console.log('\n[Step 8] Menghasilkan crop berkonteks untuk kandidat tambahan...');
  // Tag items with final unified IDs for review
  const unifiedItems = compVsGeo2.evaluated.map((item, idx) => ({
    ...item,
    id: `EC-${String(idx + 1).padStart(3, '0')}`,
    categoryVsGeo2: item.category,
    categoryVsB: compVsB.evaluated[idx] ? compVsB.evaluated[idx].category : 'added',
  }));

  const addedItems = unifiedItems.filter((x) => x.categoryVsGeo2 === 'added');
  console.log(`  Menyimpan crop untuk ${addedItems.length} kandidat tambahan (vs GEO-2)...`);

  for (const item of addedItems) {
    const cropFile = path.join(CROPS_DIR, `${item.id}.png`);
    await createCropWithContext(pageRgb, pageW, pageH, item.box600, item.rawLabel, item.confidence, cropFile);
    item.cropPath = `crops/${item.id}.png`;
  }

  // 9. Composite Full-Page 600 DPI PNG Overlay
  console.log('\n[Step 9] Mengompositkan overlay full-page 600 DPI...');

  function buildOverlaySvg(title, candidates, unmatchedRef) {
    const lines = [
      `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
      `<style>
        .bbox-matched { stroke: #00cc44; stroke-width: 4; fill: rgba(0, 204, 68, 0.08); }
        .bbox-added   { stroke: #0088ff; stroke-width: 4; fill: rgba(0, 136, 255, 0.08); }
        .bbox-shift   { stroke: #ff9900; stroke-width: 4; fill: rgba(255, 153, 0, 0.08); }
        .bbox-unmatched { stroke: #ff3333; stroke-width: 4; stroke-dasharray: 12,8; fill: rgba(255, 51, 51, 0.05); }

        .lbl-bg { fill: rgba(15, 23, 42, 0.90); rx: 4; ry: 4; }
        .lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 20px; font-weight: bold; }

        .legend-card { fill: rgba(15, 23, 42, 0.94); stroke: rgba(255, 255, 255, 0.2); stroke-width: 3; rx: 10; ry: 10; }
        .leg-title { fill: #ffffff; font-family: sans-serif; font-size: 30px; font-weight: bold; }
        .leg-text { fill: #e2e8f0; font-family: sans-serif; font-size: 22px; }
      </style>`,
    ];

    // 1. Unmatched reference (dashed red)
    for (const m of unmatchedRef) {
      const x1 = Math.round(m.box600.x1);
      const y1 = Math.round(m.box600.y1);
      const w = Math.max(1, Math.round(m.box600.x2 - m.box600.x1));
      const h = Math.max(1, Math.round(m.box600.y2 - m.box600.y1));

      lines.push(`<rect class="bbox-unmatched" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);
      const txt = `[REF GEO-2 Hilang] ${m.rawLabel}`;
      const lblW = Math.round(txt.length * 12 + 16);
      const lblX = Math.max(8, Math.min(pageW - lblW - 8, x1));
      const lblY = Math.max(8, Math.min(pageH - 36, y1 - 32));
      lines.push(
        `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="30" />`,
        `<text class="lbl-txt" x="${lblX + 8}" y="${lblY + 22}" fill="#ff6666">${escapeXml(txt)}</text>`,
      );
    }

    // 2. Active candidates
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

    // 3. Embedded Legend Banner
    const legW = 750;
    const legH = 260;
    lines.push(
      `<rect class="legend-card" x="40" y="40" width="${legW}" height="${legH}" />`,
      `<text class="leg-title" x="70" y="90">${escapeXml(title)}</text>`,

      `<rect x="70" y="115" width="28" height="20" fill="#00cc44" rx="4" />`,
      `<text class="leg-text" x="115" y="133">Hijau: Matched dengan GEO-2</text>`,

      `<rect x="70" y="150" width="28" height="20" fill="#0088ff" rx="4" />`,
      `<text class="leg-text" x="115" y="168">Biru: Kandidat Tambahan (Baru)</text>`,

      `<rect x="70" y="185" width="28" height="20" fill="#ff9900" rx="4" />`,
      `<text class="leg-text" x="115" y="203">Oranye: Perubahan Kelas / BBox Shift</text>`,

      `<line x1="70" y1="230" x2="100" y2="230" stroke="#ff3333" stroke-width="4" stroke-dasharray="8,6" />`,
      `<text class="leg-text" x="115" y="238">Merah Putus-putus: GEO-2 Tidak Matched (Referensi)</text>`,
    );

    lines.push('</svg>');
    return lines.join('\n');
  }

  const overlaySvgStr = buildOverlaySvg(
    `Eksperimen C (600 DPI, Tile 1024, Stride 256, Overlap 75%) - Total: ${unifiedItems.length}`,
    unifiedItems,
    compVsGeo2.unmatchedRef,
  );
  const overlayPngPath = path.join(OUTPUT_DIR, '03_exp_c_tile1024_stride256_overlay.png');
  await sharp(EXISTING_600DPI_PNG, { limitInputPixels: false })
    .composite([{ input: Buffer.from(overlaySvgStr) }])
    .png()
    .toFile(overlayPngPath);
  console.log(`  Overlay PNG 600 DPI: ${overlayPngPath}`);

  // 10. Build Offline Interactive HTML Viewer
  console.log('\n[Step 10] Membangun HTML viewer interaktif lokal dengan toggle...');

  const htmlPayload = JSON.stringify({
    pageWidth: pageW,
    pageHeight: pageH,
    items: unifiedItems,
    unmatchedGeo2: compVsGeo2.unmatchedRef,
    unmatchedExpB: compVsB.unmatchedRef,
    summary: {
      totalTiles,
      tileSize: TILE_SIZE,
      stride: STRIDE,
      overlapPercent: OVERLAP_PERCENT,
      durationMs: durInferMs,
      rawCandidates: allPageDetsC.length,
      retainedCandidates: keptDetsC.length,
      suppressed: suppC,
      vsB: { matched: matchedVsB, added: addedVsB, shift: shiftVsB, unmatchedB },
      vsGeo2: { matched: matchedVsGeo2, added: addedVsGeo2, shift: shiftVsGeo2, unmatchedGeo2 },
    },
  });

  const htmlSource = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>P&ID Tuning — Eksperimen C (Tile 1024, Overlap 75%)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; z-index: 20; flex-wrap: wrap; gap: 8px; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo-badge { font-weight: bold; font-size: 13px; background: #8b5cf6; color: white; padding: 4px 8px; border-radius: 4px; }
    .page-title { font-size: 14px; font-weight: 600; color: #e2e8f0; }

    .ctrl-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ctrl-group { display: flex; align-items: center; gap: 6px; background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; }
    .ctrl-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
    select, button { background: #1e293b; color: #f8fafc; border: 1px solid #475569; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; outline: none; }
    select:hover, button:hover { background: #334155; }

    .toggle-group { display: flex; align-items: center; gap: 10px; background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; }
    .toggle-item { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; user-select: none; }
    .toggle-item input[type="checkbox"] { cursor: pointer; accent-color: #8b5cf6; }

    .workspace { display: flex; flex: 1; height: calc(100vh - 54px); overflow: hidden; position: relative; }
    .viewport { flex: 1; background: #020617; overflow: hidden; position: relative; cursor: grab; user-select: none; }
    .viewport:active { cursor: grabbing; }

    .canvas-stage { position: absolute; transform-origin: 0 0; will-change: transform; }
    .stage-img { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; display: block; pointer-events: none; }
    .stage-svg { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; pointer-events: none; }

    .svg-bbox { stroke-width: 4; fill-opacity: 0.08; }
    .svg-bbox-matched { stroke: #00cc44; fill: #00cc44; }
    .svg-bbox-added   { stroke: #0088ff; fill: #0088ff; }
    .svg-bbox-shift   { stroke: #ff9900; fill: #ff9900; }
    .svg-bbox-unmatched { stroke: #ff3333; stroke-dasharray: 12,8; fill: #ff3333; fill-opacity: 0.04; }

    .svg-lbl-bg { fill: rgba(15, 23, 42, 0.90); rx: 4; ry: 4; }
    .svg-lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 20px; font-weight: bold; }

    body.hide-bboxes .svg-bbox { display: none !important; }
    body.hide-labels .svg-lbl-group { display: none !important; }
    body.hide-cat-matched .cat-matched { display: none !important; }
    body.hide-cat-added .cat-added { display: none !important; }
    body.hide-cat-shift .cat-shift { display: none !important; }
    body.hide-cat-unmatched .cat-unmatched_ref { display: none !important; }

    .legend-panel { position: absolute; bottom: 20px; left: 20px; background: rgba(15, 23, 42, 0.94); border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; font-size: 12px; z-index: 10; pointer-events: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 320px; }
    .leg-head { font-weight: 700; margin-bottom: 8px; font-size: 13px; color: #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
    .leg-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer; user-select: none; }
    .leg-color { width: 14px; height: 14px; border-radius: 3px; display: inline-block; flex-shrink: 0; }
    .item-counter { background: #3b82f6; font-size: 11px; padding: 2px 6px; border-radius: 10px; margin-left: auto; }
    .leg-note { font-size: 10px; color: #94a3b8; margin-top: 8px; line-height: 1.3; border-top: 1px solid #334155; padding-top: 6px; }

    .sidebar { width: 380px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; z-index: 15; }
    .sidebar-head { padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 13px; font-weight: 600; display: flex; flex-direction: column; gap: 8px; }
    .metrics-box { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .metrics-item { display: flex; justify-content: space-between; color: #94a3b8; }
    .metrics-val { color: #f8fafc; font-weight: bold; }

    .sidebar-filter-tabs { display: flex; gap: 4px; overflow-x: auto; }
    .filter-btn { padding: 3px 8px; font-size: 11px; border: 1px solid #475569; background: #0f172a; color: #94a3b8; border-radius: 4px; }
    .filter-btn.active { background: #8b5cf6; color: white; border-color: #a78bfa; }

    .candidate-list { flex: 1; overflow-y: auto; padding: 8px; }
    .cand-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s ease; border-left: 4px solid #8b5cf6; }
    .cand-card:hover { background: #1e293b; border-color: #64748b; }
    .cand-card.active { background: #2e1065; border-color: #c084fc; }
    .card-top { display: flex; justify-content: space-between; margin-bottom: 4px; font-weight: 600; }
    .card-label { font-family: monospace; color: #38bdf8; font-size: 11px; word-break: break-all; }
    .card-coords { color: #64748b; font-size: 10px; font-family: monospace; margin-top: 2px; }
    .crop-preview-thumb { margin-top: 6px; border: 1px solid #334155; border-radius: 4px; overflow: hidden; max-height: 80px; background: #000; }
    .crop-preview-thumb img { width: 100%; height: auto; display: block; object-fit: contain; }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <span class="logo-badge">EXP C (OVERLAP 75%)</span>
      <span class="page-title">P&ID 600 DPI Tuning &bull; Stride 256 px &bull; 900 Tile</span>
    </div>

    <div class="ctrl-bar">
      <div class="ctrl-group">
        <span class="ctrl-label">Ref Komparasi:</span>
        <select id="refSelect">
          <option value="geo2" selected>Komparasi vs GEO-2 (87)</option>
          <option value="expB">Komparasi vs Exp B (150)</option>
        </select>
      </div>

      <div class="ctrl-group">
        <span class="ctrl-label">Mode Tampilan:</span>
        <select id="viewModeSelect">
          <option value="interactive" selected>Vektor Interaktif (Toggle)</option>
          <option value="static">PNG Raster 600 DPI</option>
          <option value="original">Clean Original 600 DPI</option>
        </select>
      </div>

      <div class="toggle-group" id="togglesContainer">
        <label class="toggle-item"><input type="checkbox" id="chkShowBbox" checked /> BBox</label>
        <label class="toggle-item"><input type="checkbox" id="chkShowLabel" checked /> Label</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatMatched" checked /> <span style="color:#00cc44;">&#9632;</span> Matched</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatAdded" checked /> <span style="color:#0088ff;">&#9632;</span> Tambahan</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatShift" checked /> <span style="color:#ff9900;">&#9632;</span> Shift</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatUnmatched" checked /> <span style="color:#ff3333;">&#9632;</span> Ref Hilang</label>
      </div>

      <div class="ctrl-group">
        <span class="ctrl-label">Zoom:</span>
        <button id="btnZoomOut">&minus;</button>
        <span id="zoomLabel" style="font-size: 11px; width: 38px; text-align: center;">15%</span>
        <button id="btnZoomIn">&plus;</button>
        <button id="btnZoomFit">Fit</button>
        <button id="btnZoom100">100%</button>
      </div>
    </div>
  </header>

  <div class="workspace">
    <div class="viewport" id="viewport">
      <div class="canvas-stage" id="stage">
        <img class="stage-img" id="baseImage" src="../sheet-1-p1_600dpi_original.png" alt="600 DPI Sheet" />
        <svg class="stage-svg" id="dynamicSvg" viewBox="0 0 ${pageW} ${pageH}"></svg>
      </div>

      <div class="legend-panel">
        <div class="leg-head">
          <span id="legTitle">Legenda vs GEO-2</span>
          <span style="font-size:10px; color:#94a3b8;">Klik untuk toggle</span>
        </div>
        <div class="leg-item" id="legMatched">
          <span class="leg-color" style="background: #00cc44;"></span>
          <span>Matched Acuan</span>
          <span class="item-counter" id="cntMatched" style="background:#059669;">0</span>
        </div>
        <div class="leg-item" id="legAdded">
          <span class="leg-color" style="background: #0088ff;"></span>
          <span>Kandidat Tambahan (Baru)</span>
          <span class="item-counter" id="cntAdded" style="background:#2563eb;">0</span>
        </div>
        <div class="leg-item" id="legShift">
          <span class="leg-color" style="background: #ff9900;"></span>
          <span>Shift Kelas / BBox</span>
          <span class="item-counter" id="cntShift" style="background:#d97706;">0</span>
        </div>
        <div class="leg-item" id="legUnmatched">
          <span class="leg-color" style="background: #ff3333; border:1px dashed white;"></span>
          <span id="txtLegUnmatched">Acuan Tidak Matched</span>
          <span class="item-counter" id="cntUnmatched" style="background:#dc2626;">0</span>
        </div>
        <div class="leg-note">
          Seluruh keputusan manusia tetap UNRESOLVED.
        </div>
      </div>
    </div>

    <div class="sidebar">
      <div class="sidebar-head">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span>Eksperimen C Metrics</span>
          <span class="item-counter" id="totalCandidatesCount" style="background:#8b5cf6;">0</span>
        </div>
        <div class="metrics-box">
          <div class="metrics-item"><span>Total Tile:</span> <span class="metrics-val">${totalTiles}</span></div>
          <div class="metrics-item"><span>Stride:</span> <span class="metrics-val">${STRIDE} px (75%)</span></div>
          <div class="metrics-item"><span>Raw Cands:</span> <span class="metrics-val">${allPageDetsC.length}</span></div>
          <div class="metrics-item"><span>Retained:</span> <span class="metrics-val">${keptDetsC.length}</span></div>
          <div class="metrics-item"><span>Suppressed:</span> <span class="metrics-val">${suppC}</span></div>
          <div class="metrics-item"><span>Durasi:</span> <span class="metrics-val">${(durInferMs / 1000).toFixed(0)}s</span></div>
        </div>
        <div class="sidebar-filter-tabs">
          <button class="filter-btn active" data-filter="all">Semua</button>
          <button class="filter-btn" data-filter="added">Tambahan</button>
          <button class="filter-btn" data-filter="matched">Matched</button>
          <button class="filter-btn" data-filter="shift">Shift</button>
          <button class="filter-btn" data-filter="unmatched">Ref Hilang</button>
        </div>
      </div>
      <div class="candidate-list" id="candidateList"></div>
    </div>
  </div>

  <script>
    const data = ${htmlPayload};
    const stage = document.getElementById('stage');
    const viewport = document.getElementById('viewport');
    const baseImg = document.getElementById('baseImage');
    const dynamicSvg = document.getElementById('dynamicSvg');
    const refSelect = document.getElementById('refSelect');
    const viewModeSelect = document.getElementById('viewModeSelect');
    const zoomLabel = document.getElementById('zoomLabel');
    const candidateList = document.getElementById('candidateList');
    const togglesContainer = document.getElementById('togglesContainer');

    let currentRef = 'geo2';
    let currentFilter = 'all';
    let scale = 0.15;
    let panX = 40, panY = 20;
    let isDragging = false;
    let startX = 0, startY = 0;

    function applyTransform() {
      stage.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
      zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    function fitToScreen() {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      scale = Math.min((vw - 40) / data.pageWidth, (vh - 40) / data.pageHeight);
      panX = (vw - data.pageWidth * scale) / 2;
      panY = (vh - data.pageHeight * scale) / 2;
      applyTransform();
    }

    viewport.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });
    window.addEventListener('mouseup', () => { isDragging = false; });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.85 : 1.15;
      const newScale = Math.max(0.05, Math.min(2.5, scale * delta));
      panX = mouseX - (mouseX - panX) * (newScale / scale);
      panY = mouseY - (mouseY - panY) * (newScale / scale);
      scale = newScale;
      applyTransform();
    }, { passive: false });

    document.getElementById('btnZoomIn').onclick = () => { scale = Math.min(2.5, scale * 1.25); applyTransform(); };
    document.getElementById('btnZoomOut').onclick = () => { scale = Math.max(0.05, scale * 0.8); applyTransform(); };
    document.getElementById('btnZoomFit').onclick = fitToScreen;
    document.getElementById('btnZoom100').onclick = () => { scale = 1.0; applyTransform(); };

    // Toggles logic
    const chkShowBbox = document.getElementById('chkShowBbox');
    const chkShowLabel = document.getElementById('chkShowLabel');
    const chkCatMatched = document.getElementById('chkCatMatched');
    const chkCatAdded = document.getElementById('chkCatAdded');
    const chkCatShift = document.getElementById('chkCatShift');
    const chkCatUnmatched = document.getElementById('chkCatUnmatched');

    chkShowBbox.onchange = () => document.body.classList.toggle('hide-bboxes', !chkShowBbox.checked);
    chkShowLabel.onchange = () => document.body.classList.toggle('hide-labels', !chkShowLabel.checked);
    chkCatMatched.onchange = () => document.body.classList.toggle('hide-cat-matched', !chkCatMatched.checked);
    chkCatAdded.onchange = () => document.body.classList.toggle('hide-cat-added', !chkCatAdded.checked);
    chkCatShift.onchange = () => document.body.classList.toggle('hide-cat-shift', !chkCatShift.checked);
    chkCatUnmatched.onchange = () => document.body.classList.toggle('hide-cat-unmatched', !chkCatUnmatched.checked);

    document.getElementById('legMatched').onclick = () => { chkCatMatched.checked = !chkCatMatched.checked; chkCatMatched.onchange(); };
    document.getElementById('legAdded').onclick = () => { chkCatAdded.checked = !chkCatAdded.checked; chkCatAdded.onchange(); };
    document.getElementById('legShift').onclick = () => { chkCatShift.checked = !chkCatShift.checked; chkCatShift.onchange(); };
    document.getElementById('legUnmatched').onclick = () => { chkCatUnmatched.checked = !chkCatUnmatched.checked; chkCatUnmatched.onchange(); };

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        filterSidebarList();
      };
    });

    function escapeXml(unsafe) {
      return String(unsafe).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function renderView() {
      const mode = viewModeSelect.value;
      currentRef = refSelect.value;

      if (mode === 'original') {
        baseImg.src = '../sheet-1-p1_600dpi_original.png';
        dynamicSvg.style.display = 'none';
        togglesContainer.style.opacity = '0.3';
        togglesContainer.style.pointerEvents = 'none';
        candidateList.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;">Citra 600 DPI bersih tanpa overlay.</div>';
        document.getElementById('totalCandidatesCount').textContent = '0';
        return;
      }

      togglesContainer.style.opacity = '1';
      togglesContainer.style.pointerEvents = 'auto';

      if (mode === 'static') {
        baseImg.src = '03_exp_c_tile1024_stride256_overlay.png';
        dynamicSvg.style.display = 'none';
      } else {
        baseImg.src = '../sheet-1-p1_600dpi_original.png';
        dynamicSvg.style.display = 'block';
      }

      const isGeo2 = currentRef === 'geo2';
      const unmatchedList = isGeo2 ? data.unmatchedGeo2 : data.unmatchedExpB;
      document.getElementById('legTitle').textContent = isGeo2 ? 'Legenda vs GEO-2 (87)' : 'Legenda vs Exp B (150)';
      document.getElementById('txtLegUnmatched').textContent = isGeo2 ? 'GEO-2 Hilang' : 'Exp B Hilang';

      let mCnt = 0, aCnt = 0, sCnt = 0;
      data.items.forEach(item => {
        const cat = isGeo2 ? item.categoryVsGeo2 : item.categoryVsB;
        if (cat === 'matched') mCnt++;
        else if (cat === 'added') aCnt++;
        else if (cat === 'shift') sCnt++;
      });

      document.getElementById('cntMatched').textContent = mCnt;
      document.getElementById('cntAdded').textContent = aCnt;
      document.getElementById('cntShift').textContent = sCnt;
      document.getElementById('cntUnmatched').textContent = unmatchedList.length;

      // Render Dynamic SVG
      let svgHtml = '';
      unmatchedList.forEach(item => {
        const x1 = Math.round(item.box600.x1);
        const y1 = Math.round(item.box600.y1);
        const w = Math.max(1, Math.round(item.box600.x2 - item.box600.x1));
        const h = Math.max(1, Math.round(item.box600.y2 - item.box600.y1));
        const txt = \`[REF Hilang] \${item.rawLabel}\`;
        const lblW = Math.round(txt.length * 12 + 16);
        const lblX = Math.max(8, Math.min(data.pageWidth - lblW - 8, x1));
        const lblY = Math.max(8, Math.min(data.pageHeight - 36, y1 - 32));

        svgHtml += \`
          <g class="det-group cat-unmatched_ref" data-id="\${item.id}">
            <rect class="svg-bbox svg-bbox-unmatched" x="\${x1}" y="\${y1}" width="\${w}" height="\${h}" />
            <g class="svg-lbl-group">
              <rect class="svg-lbl-bg" x="\${lblX}" y="\${lblY}" width="\${lblW}" height="30" />
              <text class="svg-lbl-txt" x="\${lblX + 8}" y="\${lblY + 22}" fill="#ff6666">\${escapeXml(txt)}</text>
            </g>
          </g>
        \`;
      });

      data.items.forEach(item => {
        const cat = isGeo2 ? item.categoryVsGeo2 : item.categoryVsB;
        const x1 = Math.round(item.box600.x1);
        const y1 = Math.round(item.box600.y1);
        const w = Math.max(1, Math.round(item.box600.x2 - item.box600.x1));
        const h = Math.max(1, Math.round(item.box600.y2 - item.box600.y1));

        let bboxCls = 'svg-bbox-added';
        let txtColor = '#88ccff';
        let txt = \`\${item.id} \${item.rawLabel} \${Math.round(item.confidence * 100)}%\`;

        if (cat === 'matched') {
          bboxCls = 'svg-bbox-matched';
          txtColor = '#66ff99';
        } else if (cat === 'shift') {
          bboxCls = 'svg-bbox-shift';
          txtColor = '#ffcc66';
        }

        const lblW = Math.round(txt.length * 12 + 18);
        const lblX = Math.max(8, Math.min(data.pageWidth - lblW - 8, x1));
        const lblY = Math.max(8, Math.min(data.pageHeight - 36, y1 - 32));

        svgHtml += \`
          <g class="det-group cat-\${cat}" data-id="\${item.id}">
            <rect class="svg-bbox \${bboxCls}" x="\${x1}" y="\${y1}" width="\${w}" height="\${h}" />
            <g class="svg-lbl-group">
              <rect class="svg-lbl-bg" x="\${lblX}" y="\${lblY}" width="\${lblW}" height="30" />
              <text class="svg-lbl-txt" x="\${lblX + 8}" y="\${lblY + 22}" fill="\${txtColor}">\${escapeXml(txt)}</text>
            </g>
          </g>
        \`;
      });

      dynamicSvg.innerHTML = svgHtml;

      // Render Sidebar List
      candidateList.innerHTML = '';
      const allCards = [
        ...data.items.map(it => ({ ...it, displayCat: isGeo2 ? it.categoryVsGeo2 : it.categoryVsB })),
        ...unmatchedList.map(it => ({ ...it, displayCat: 'unmatched_ref' })),
      ];

      allCards.forEach(item => {
        const card = document.createElement('div');
        card.className = 'cand-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-cat', item.displayCat);

        let color = '#0088ff';
        let catText = 'TAMBAHAN';
        if (item.displayCat === 'matched') { color = '#00cc44'; catText = 'MATCHED'; }
        else if (item.displayCat === 'shift') { color = '#ff9900'; catText = 'SHIFT'; }
        else if (item.displayCat === 'unmatched_ref') { color = '#ff3333'; catText = 'REF HILANG'; }
        card.style.borderLeftColor = color;

        let cropHtml = '';
        if (item.cropPath) {
          cropHtml = \`<div class="crop-preview-thumb"><img src="\${item.cropPath}" alt="Crop \${item.id}" loading="lazy"/></div>\`;
        }

        card.innerHTML = \`
          <div class="card-top">
            <span>\${item.id} <span style="font-size:10px; color:\${color}; font-weight:normal;">[\${catText}]</span></span>
            <span style="color:\${color}; font-size:11px;">\${Math.round(item.confidence * 100)}%</span>
          </div>
          <div class="card-label">\${item.rawLabel}</div>
          <div class="card-coords">600 DPI: [\${Math.round(item.box600.x1)}, \${Math.round(item.box600.y1)}] &bull; UNRESOLVED</div>
          \${cropHtml}
        \`;

        card.onclick = () => {
          document.querySelectorAll('.cand-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          const cx = (item.box600.x1 + item.box600.x2) / 2;
          const cy = (item.box600.y1 + item.box600.y2) / 2;
          scale = 0.8;
          panX = (viewport.clientWidth / 2) - (cx * scale);
          panY = (viewport.clientHeight / 2) - (cy * scale);
          applyTransform();
        };

        candidateList.appendChild(card);
      });

      filterSidebarList();
    }

    function filterSidebarList() {
      const cards = document.querySelectorAll('.cand-card');
      let visibleCount = 0;
      cards.forEach(card => {
        const cat = card.getAttribute('data-cat');
        let show = false;
        if (currentFilter === 'all') show = true;
        else if (currentFilter === 'added' && cat === 'added') show = true;
        else if (currentFilter === 'matched' && cat === 'matched') show = true;
        else if (currentFilter === 'shift' && cat === 'shift') show = true;
        else if (currentFilter === 'unmatched' && cat === 'unmatched_ref') show = true;

        card.style.display = show ? 'block' : 'none';
        if (show) visibleCount++;
      });
      document.getElementById('totalCandidatesCount').textContent = visibleCount;
    }

    refSelect.onchange = renderView;
    viewModeSelect.onchange = renderView;

    window.onload = () => {
      fitToScreen();
      renderView();
    };
  </script>
</body>
</html>`;

  const htmlOutPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(htmlOutPath, htmlSource, 'utf8');
  console.log(`  HTML Viewer: ${htmlOutPath}`);

  // 11. Write Complete Exp C Telemetry Manifest
  console.log('\n[Step 11] Menulis manifest dan telemetri Eksperimen C...');

  const manifestData = {
    schemaVersion: 'dense-600dpi-exp-c-v1',
    generatedAt: new Date().toISOString(),
    sourceRender: {
      path: path.relative(REPO_ROOT, EXISTING_600DPI_PNG).replace(/\\/g, '/'),
      dimensions: { width: pageW, height: pageH },
      reRenderPdf: false,
    },
    modelVerification: {
      modelPath: path.relative(REPO_ROOT, MODEL_PATH).replace(/\\/g, '/'),
      inputTensorName: inputName,
      inputDimensions: inputDims,
      totalClasses: Object.keys(rawNames).length,
    },
    experimentC: {
      id: 'Exp_C',
      name: 'Eksperimen C (600 DPI, Tile 1024x1024, Stride 256, Overlap 75%)',
      tileSize: TILE_SIZE,
      stride: STRIDE,
      overlapPercent: OVERLAP_PERCENT,
      grid: {
        colsCount,
        rowsCount,
        totalTiles,
        xOffsets: gridC.xOffsets,
        yOffsets: gridC.yOffsets,
      },
      durationMs: durInferMs,
      memoryUsage: { start: memStart, end: memEnd },
      rawCandidatesTotal: allPageDetsC.length,
      retainedCandidatesTotal: keptDetsC.length,
      suppressedByMerge: suppC,
      comparisonVsExpB: {
        referenceTotal: expBItems.length,
        matched: matchedVsB,
        added: addedVsB,
        shift: shiftVsB,
        expBUnmatched: unmatchedB,
      },
      comparisonVsGeo2: {
        referenceTotal: geo2BaselineItems.length,
        matched: matchedVsGeo2,
        added: addedVsGeo2,
        shift: shiftVsGeo2,
        geo2Unmatched: unmatchedGeo2,
      },
      files: {
        rawTilePredictions: 'exp_c_raw_tile_predictions.json',
        retainedDetections: 'exp_c_retained_detections.json',
        overlayPng: '03_exp_c_tile1024_stride256_overlay.png',
        htmlViewer: 'index.html',
        cropsDir: 'crops',
      },
    },
    humanDecisionStatus: 'ALL_UNRESOLVED',
    missingGroundTruthStatus:
      'Lokasi 19 missing yang dilaporkan pengguna belum tersedia sebagai daftar koordinat ground-truth beranotasi; tidak ada klaim pemulihan missing spesifik sebelum daftar lokasi diverifikasi.',
  };

  const manifestPath = path.join(OUTPUT_DIR, 'exp-c-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

  console.log(`  Telemetry Manifest: ${manifestPath}`);
  console.log('\n[SUCCESS] Eksperimen C Selesai Dijalankan!');
}

main().catch((err) => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
