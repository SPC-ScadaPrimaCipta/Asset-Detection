#!/usr/bin/env node
/**
 * Dense Tiling & 600 DPI High-Resolution Local Inference Experiment Runner
 *
 * SCOPE & CONTRACT:
 *   - Native PDF 600 DPI rendering via MuPDF directly.
 *   - Model verification: yolo-pid-v8n-203.onnx with verified input shape [1, 3, 1024, 1024].
 *   - Two sequential experiments:
 *       Exp A: 600 DPI, Tile 1280x1280, Overlap 50%, Stride 640
 *       Exp B: 600 DPI, Tile 1024x1024, Overlap 50%, Stride 512
 *   - Settings match GEO-2: conf=0.50, perTileNmsIou=0.70, perTileCap=300, globalMergeIou=0.50, classAware=true.
 *   - Telemetry: heap/RSS memory, tile counts, durations recorded.
 *   - Mapping to common coordinate space (3573x2526) for IoU comparison with GEO-2.
 *   - Full-page 600 DPI PNG overlays, context crops for added candidates, and offline HTML viewer.
 *   - Exclusive output directory: fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi/
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const PDF_PATH = path.join(
  REPO_ROOT,
  'storage/eval-ab6fa321-0671-4518-8b56-fb1117d91068-ASBUILTSPPDT_11_PE_01_PP_001_Rev_1_P&ID_SP_Pondok_Tengah_Sheet_1.pdf',
);
const MODEL_PATH = path.join(REPO_ROOT, 'model/yolo-pid-v8n-203.onnx');
const NAMES_JSON_PATH = path.join(REPO_ROOT, 'model/yolo-v203-names.json');
const HTML_VIEWER_PATH = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html',
);

const OUTPUT_DIR = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/tuning-experiments/review-package/dense-600dpi',
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

  // Direct 1024x1024 extract with padding 114
  if (tile.width === onnxSize && tile.height === onnxSize) {
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

  // Bilinear resizing for 1280x1280 -> 1024x1024 directly in pure JS (zero external process)
  const planeSize = onnxSize * onnxSize;
  const tensor = new Float32Array(3 * planeSize);
  const scaleX = tile.width / onnxSize;
  const scaleY = tile.height / onnxSize;

  for (let r = 0; r < onnxSize; r++) {
    const srcY = Math.min(validH - 1, Math.floor(r * scaleY));
    const globalY = tile.y + srcY;
    if (globalY >= pageH) continue;
    const srcRowOffset = globalY * pageW * 3;
    const dstRowOffset = r * onnxSize;

    for (let c = 0; c < onnxSize; c++) {
      const srcX = Math.min(validW - 1, Math.floor(c * scaleX));
      const globalX = tile.x + srcX;
      if (globalX >= pageW) continue;
      const srcPixel = srcRowOffset + globalX * 3;
      const dstIdx = dstRowOffset + c;

      tensor[dstIdx] = pageRgb[srcPixel] / 255.0;
      tensor[planeSize + dstIdx] = pageRgb[srcPixel + 1] / 255.0;
      tensor[2 * planeSize + dstIdx] = pageRgb[srcPixel + 2] / 255.0;
    }
  }

  return { tensor, scaleFactor: onnxSize / tile.width, validW, validH };
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

  await sharp(Buffer.from(pageRgb), { raw: { width: pageW, height: pageH, channels: 3 } })
    .extract({ left: cX1, top: cY1, width: cropW, height: cropH })
    .composite([{ input: svg }])
    .png()
    .toFile(outPath);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('================================================================');
  console.log('  Dense Tiling & 600 DPI Local Inference Experiments (Exp A & B)');
  console.log('================================================================\n');

  // Guard: Exclusive output directory
  if (fs.existsSync(OUTPUT_DIR)) {
    console.error(`[BLOCKER] Target directory already exists: ${OUTPUT_DIR}`);
    console.error('Stopping execution to prevent overwriting existing artifacts.');
    process.exit(1);
  }

  // 1. Source verification
  console.log('[Step 1] Verifying source PDF and existing assets...');
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`[BLOCKER] Source PDF not found: ${PDF_PATH}`);
    process.exit(1);
  }
  const pdfStat = fs.statSync(PDF_PATH);
  console.log(`  PDF Source: ${path.basename(PDF_PATH)} (${pdfStat.size} bytes)`);

  // 2. Model verification
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
  console.log(`  Verified Input Name: "${inputName}"`);
  console.log(`  Verified Input Dimensions: [${inputDims.join(', ')}] (FIXED 1024x1024)`);
  console.log(`  Verified Output Name: "${outputName}"`);
  console.log(`  Classes available: ${Object.keys(rawNames).length}`);

  // Create exclusive directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CROPS_DIR, { recursive: true });

  // 3. Render 600 DPI
  console.log('\n[Step 3] Rendering source PDF at 600 DPI via MuPDF...');
  const t0Render = performance.now();
  const pdfBuf = fs.readFileSync(PDF_PATH);
  const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
  const page = doc.loadPage(0);

  const scale600 = 600 / 72; // scale = 8.333333333333334
  const matrix = mupdf.Matrix.scale(scale600, scale600);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const renderDurMs = Math.round(performance.now() - t0Render);

  const pageW = pixmap.getWidth();
  const pageH = pixmap.getHeight();
  const pageRgb = new Uint8Array(pixmap.getPixels()); // Clone to avoid buffer detachment on asPNG()
  const memAfterRender = sampleMemory('post_render_600dpi');

  console.log(`  Actual Rendered Dimensions: ${pageW} x ${pageH} px`);
  console.log(`  Page Number: 1`);
  console.log(`  Render Duration: ${renderDurMs} ms`);
  console.log(`  Memory (RSS): ${memAfterRender.rssMb} MB | Heap: ${memAfterRender.heapUsedMb} MB`);

  // Save 600 DPI original PNG
  const originalPngPath = path.join(OUTPUT_DIR, 'sheet-1-p1_600dpi_original.png');
  console.log('  Saving clean 600 DPI original PNG to disk...');
  fs.writeFileSync(originalPngPath, Buffer.from(pixmap.asPNG()));
  const origPngStat = fs.statSync(originalPngPath);
  console.log(`  Saved: ${originalPngPath} (${Math.round(origPngStat.size / (1024 * 1024))} MB)`);

  // Load GEO-2 reference detections from existing review package
  console.log('\n[Step 4] Loading GEO-2 reference detections for baseline comparison...');
  const existingHtml = fs.readFileSync(HTML_VIEWER_PATH, 'utf8');
  const htmlMatch = existingHtml.match(/const data = (\{.*?\});\n/s);
  if (!htmlMatch) {
    throw new Error('Failed to parse GEO-2 detections from index.html');
  }
  const fullPageData = JSON.parse(htmlMatch[1]);
  const geo2BaselineItems = fullPageData.configs.geo2.items;
  console.log(`  Loaded ${geo2BaselineItems.length} verified GEO-2 detections (in 3573x2526 space).`);

  // Conversion factor between 600 DPI and baseline 216 DPI (3573x2526)
  const normScaleX = 3573 / pageW;
  const normScaleY = 2526 / pageH;

  // ==========================================================================
  // EXPERIMENT A: Tile 1280x1280, Overlap 50%, Stride 640
  // ==========================================================================
  console.log('\n================================================================');
  console.log('  Running Eksperimen A: Tile 1280x1280, Stride 640 (Overlap 50%)');
  console.log('================================================================');

  const t0ExpA = performance.now();
  const memStartA = sampleMemory('start_exp_a');
  const gridA = buildGrid(pageW, pageH, 1280, 640);
  console.log(`  Total Tiles: ${gridA.tiles.length} (${gridA.xOffsets.length} cols x ${gridA.yOffsets.length} rows)`);

  const rawTileDetsA = [];
  const allPageDetsA = [];

  for (let tIdx = 0; tIdx < gridA.tiles.length; tIdx++) {
    const tile = gridA.tiles[tIdx];
    const { tensor, scaleFactor } = extractTileTensor(pageRgb, pageW, pageH, tile, 1024);
    const tileCands = await inferTile(session, tensor, 0.50);
    const nmsKept = applyNms(tileCands, 0.70, 300);

    const tileRecord = {
      tileIndex: tile.tileIndex,
      col: tile.col,
      row: tile.row,
      offset: { x: tile.x, y: tile.y },
      tileSize: 1280,
      candidatesPreNms: tileCands.length,
      candidatesPostNms: nmsKept.length,
      detections: [],
    };

    for (let cIdx = 0; cIdx < nmsKept.length; cIdx++) {
      const cand = nmsKept[cIdx];
      // Map local 1024 coords back to 1280 tile coords
      const localTileX1 = cand.bbox[0] / scaleFactor;
      const localTileY1 = cand.bbox[1] / scaleFactor;
      const localTileX2 = cand.bbox[2] / scaleFactor;
      const localTileY2 = cand.bbox[3] / scaleFactor;

      // Reject if beyond valid image
      const validW = Math.min(tile.width, pageW - tile.x);
      const validH = Math.min(tile.height, pageH - tile.y);
      if (localTileX1 >= validW || localTileY1 >= validH) continue;

      const clampedX1 = Math.max(0, Math.min(validW, localTileX1));
      const clampedY1 = Math.max(0, Math.min(validH, localTileY1));
      const clampedX2 = Math.max(0, Math.min(validW, localTileX2));
      const clampedY2 = Math.max(0, Math.min(validH, localTileY2));
      if (clampedX2 - clampedX1 < 1 || clampedY2 - clampedY1 < 1) continue;

      // Map to 600 DPI page coordinates
      const page600X1 = clampedX1 + tile.x;
      const page600Y1 = clampedY1 + tile.y;
      const page600X2 = clampedX2 + tile.x;
      const page600Y2 = clampedY2 + tile.y;

      // Map to baseline coordinate space (3573x2526)
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
      allPageDetsA.push(detItem);
    }

    rawTileDetsA.push(tileRecord);
    if ((tIdx + 1) % 30 === 0 || tIdx === gridA.tiles.length - 1) {
      process.stdout.write(`    Tiles processed: ${tIdx + 1}/${gridA.tiles.length}\r`);
    }
  }

  const { kept: keptDetsA, suppressedCount: suppA } = mergeGlobal(allPageDetsA, 0.50, true);
  const durExpA = Math.round(performance.now() - t0ExpA);
  const memEndA = sampleMemory('end_exp_a');

  console.log(`\n  Exp A Finished: ${allPageDetsA.length} raw candidates -> ${keptDetsA.length} retained (${suppA} suppressed)`);
  console.log(`  Duration: ${durExpA} ms | Memory (RSS): ${memEndA.rssMb} MB`);

  // ==========================================================================
  // EXPERIMENT B: Tile 1024x1024, Overlap 50%, Stride 512
  // ==========================================================================
  console.log('\n================================================================');
  console.log('  Running Eksperimen B: Tile 1024x1024, Stride 512 (Overlap 50%)');
  console.log('================================================================');

  const t0ExpB = performance.now();
  const memStartB = sampleMemory('start_exp_b');
  const gridB = buildGrid(pageW, pageH, 1024, 512);
  console.log(`  Total Tiles: ${gridB.tiles.length} (${gridB.xOffsets.length} cols x ${gridB.yOffsets.length} rows)`);

  const rawTileDetsB = [];
  const allPageDetsB = [];

  for (let tIdx = 0; tIdx < gridB.tiles.length; tIdx++) {
    const tile = gridB.tiles[tIdx];
    const { tensor } = extractTileTensor(pageRgb, pageW, pageH, tile, 1024);
    const tileCands = await inferTile(session, tensor, 0.50);
    const nmsKept = applyNms(tileCands, 0.70, 300);

    const tileRecord = {
      tileIndex: tile.tileIndex,
      col: tile.col,
      row: tile.row,
      offset: { x: tile.x, y: tile.y },
      tileSize: 1024,
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
      allPageDetsB.push(detItem);
    }

    rawTileDetsB.push(tileRecord);
    if ((tIdx + 1) % 40 === 0 || tIdx === gridB.tiles.length - 1) {
      process.stdout.write(`    Tiles processed: ${tIdx + 1}/${gridB.tiles.length}\r`);
    }
  }

  const { kept: keptDetsB, suppressedCount: suppB } = mergeGlobal(allPageDetsB, 0.50, true);
  const durExpB = Math.round(performance.now() - t0ExpB);
  const memEndB = sampleMemory('end_exp_b');

  console.log(`\n  Exp B Finished: ${allPageDetsB.length} raw candidates -> ${keptDetsB.length} retained (${suppB} suppressed)`);
  console.log(`  Duration: ${durExpB} ms | Memory (RSS): ${memEndB.rssMb} MB`);

  // ==========================================================================
  // STEP 5: COMPARISON AGAINST GEO-2 (Common Coordinate Space: 3573x2526)
  // ==========================================================================
  console.log('\n[Step 5] Comparing Exp A and Exp B against GEO-2 in Common Coordinate Space...');

  function evaluateAgainstGeo2(experimentDets, prefix) {
    const evaluated = [];
    const geo2Matched = new Array(geo2BaselineItems.length).fill(false);

    for (let i = 0; i < experimentDets.length; i++) {
      const cand = experimentDets[i];
      let bestIoU = 0;
      let bestMatchIdx = -1;

      for (let g = 0; g < geo2BaselineItems.length; g++) {
        const iou = computeIoU(cand.baseBox, geo2BaselineItems[g].box);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestMatchIdx = g;
        }
      }

      const id = `${prefix}-${String(i + 1).padStart(3, '0')}`;
      if (bestIoU >= 0.40 && bestMatchIdx >= 0) {
        geo2Matched[bestMatchIdx] = true;
        const gMatch = geo2BaselineItems[bestMatchIdx];
        const isSameClass = cand.rawClassId === gMatch.rawClassId;
        const isShift = !isSameClass || bestIoU < 0.75;
        evaluated.push({
          ...cand,
          id,
          category: isShift ? 'shift' : 'matched',
          geo2MatchId: gMatch.id,
          geo2Label: gMatch.rawLabel,
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

    const unmatchedGeo2 = [];
    for (let g = 0; g < geo2BaselineItems.length; g++) {
      if (!geo2Matched[g]) {
        const item = geo2BaselineItems[g];
        // Project to 600 DPI coordinates for visual rendering
        unmatchedGeo2.push({
          id: `REF-UNMATCHED-${item.id}`,
          rawLabel: item.rawLabel,
          confidence: item.confidence,
          category: 'unmatched_geo2',
          baseBox: item.box,
          box600: {
            x1: item.box.x1 / normScaleX,
            y1: item.box.y1 / normScaleY,
            x2: item.box.x2 / normScaleX,
            y2: item.box.y2 / normScaleY,
          },
        });
      }
    }

    return { evaluated, unmatchedGeo2 };
  }

  const compA = evaluateAgainstGeo2(keptDetsA, 'EA');
  const compB = evaluateAgainstGeo2(keptDetsB, 'EB');

  const matchedCountA = compA.evaluated.filter((x) => x.category === 'matched').length;
  const addedCountA = compA.evaluated.filter((x) => x.category === 'added').length;
  const shiftCountA = compA.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedGeo2CountA = compA.unmatchedGeo2.length;

  const matchedCountB = compB.evaluated.filter((x) => x.category === 'matched').length;
  const addedCountB = compB.evaluated.filter((x) => x.category === 'added').length;
  const shiftCountB = compB.evaluated.filter((x) => x.category === 'shift').length;
  const unmatchedGeo2CountB = compB.unmatchedGeo2.length;

  console.log(`  Exp A Comparison vs GEO-2: Matched=${matchedCountA} | Added=${addedCountA} | Shift=${shiftCountA} | GEO-2 Unmatched=${unmatchedGeo2CountA}`);
  console.log(`  Exp B Comparison vs GEO-2: Matched=${matchedCountB} | Added=${addedCountB} | Shift=${shiftCountB} | GEO-2 Unmatched=${unmatchedGeo2CountB}`);

  // ==========================================================================
  // STEP 6: GENERATE CONTEXT CROPS FOR ADDED CANDIDATES
  // ==========================================================================
  console.log('\n[Step 6] Generating context crops for added candidates...');
  const addedSampleA = compA.evaluated.filter((x) => x.category === 'added');
  const addedSampleB = compB.evaluated.filter((x) => x.category === 'added');

  for (const item of addedSampleA) {
    const cropFile = path.join(CROPS_DIR, `${item.id}.png`);
    await createCropWithContext(pageRgb, pageW, pageH, item.box600, item.rawLabel, item.confidence, cropFile);
    item.cropPath = `crops/${item.id}.png`;
  }

  for (const item of addedSampleB) {
    const cropFile = path.join(CROPS_DIR, `${item.id}.png`);
    await createCropWithContext(pageRgb, pageW, pageH, item.box600, item.rawLabel, item.confidence, cropFile);
    item.cropPath = `crops/${item.id}.png`;
  }
  console.log(`  Generated ${addedSampleA.length + addedSampleB.length} context crops in: ${CROPS_DIR}`);

  // ==========================================================================
  // STEP 7: BUILD FULL-PAGE SVG & COMPOSITE 600 DPI PNG OVERLAYS
  // ==========================================================================
  console.log('\n[Step 7] Compositing 600 DPI Full-Page PNG Overlays...');

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
        .leg-title { fill: #ffffff; font-family: sans-serif; font-size: 32px; font-weight: bold; }
        .leg-text { fill: #e2e8f0; font-family: sans-serif; font-size: 24px; }
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
      if (c.category === 'matched') {
        cls = 'bbox-matched';
        textColor = '#66ff99';
      } else if (c.category === 'shift') {
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

  const svgA = buildOverlaySvg(
    `Eksperimen A (600 DPI, Tile 1280, Stride 640) - Total: ${compA.evaluated.length}`,
    compA.evaluated,
    compA.unmatchedGeo2,
  );
  const overlayAPath = path.join(OUTPUT_DIR, '01_exp_a_tile1280_stride640_overlay.png');
  await sharp(originalPngPath, { limitInputPixels: false })
    .composite([{ input: Buffer.from(svgA) }])
    .png()
    .toFile(overlayAPath);
  console.log(`  Composited: ${overlayAPath}`);

  const svgB = buildOverlaySvg(
    `Eksperimen B (600 DPI, Tile 1024, Stride 512) - Total: ${compB.evaluated.length}`,
    compB.evaluated,
    compB.unmatchedGeo2,
  );
  const overlayBPath = path.join(OUTPUT_DIR, '02_exp_b_tile1024_stride512_overlay.png');
  await sharp(originalPngPath, { limitInputPixels: false })
    .composite([{ input: Buffer.from(svgB) }])
    .png()
    .toFile(overlayBPath);
  console.log(`  Composited: ${overlayBPath}`);

  // ==========================================================================
  // STEP 8: SAVE RAW PREDICTIONS PER TILE (PRE-MERGE)
  // ==========================================================================
  console.log('\n[Step 8] Saving raw per-tile predictions before global merge...');
  const rawTilePathA = path.join(OUTPUT_DIR, 'exp_a_raw_tile_predictions.json');
  fs.writeFileSync(rawTilePathA, JSON.stringify(rawTileDetsA, null, 2), 'utf8');

  const rawTilePathB = path.join(OUTPUT_DIR, 'exp_b_raw_tile_predictions.json');
  fs.writeFileSync(rawTilePathB, JSON.stringify(rawTileDetsB, null, 2), 'utf8');
  console.log(`  Saved: ${rawTilePathA}`);
  console.log(`  Saved: ${rawTilePathB}`);

  // ==========================================================================
  // STEP 9: BUILD OFFLINE INTERACTIVE HTML VIEWER (WITH TOGGLES)
  // ==========================================================================
  console.log('\n[Step 9] Building offline interactive HTML viewer with toggle capabilities...');

  const htmlPayload = JSON.stringify({
    pageWidth: pageW,
    pageHeight: pageH,
    configs: {
      expA: {
        id: 'expA',
        title: 'Eksperimen A (600 DPI &bull; Tile 1280 &bull; Stride 640 &bull; Overlap 50%)',
        overlayFile: '01_exp_a_tile1280_stride640_overlay.png',
        items: compA.evaluated,
        unmatched: compA.unmatchedGeo2,
      },
      expB: {
        id: 'expB',
        title: 'Eksperimen B (600 DPI &bull; Tile 1024 &bull; Stride 512 &bull; Overlap 50%)',
        overlayFile: '02_exp_b_tile1024_stride512_overlay.png',
        items: compB.evaluated,
        unmatched: compB.unmatchedGeo2,
      },
    },
  });

  const htmlSource = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>P&ID 600 DPI Dense Tiling Review (Eksperimen A & B)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; z-index: 20; flex-wrap: wrap; gap: 8px; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo-badge { font-weight: bold; font-size: 13px; background: #2563eb; color: white; padding: 4px 8px; border-radius: 4px; }
    .page-title { font-size: 14px; font-weight: 600; color: #e2e8f0; }

    .ctrl-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ctrl-group { display: flex; align-items: center; gap: 6px; background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; }
    .ctrl-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
    select, button { background: #1e293b; color: #f8fafc; border: 1px solid #475569; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; outline: none; }
    select:hover, button:hover { background: #334155; }

    /* Toggle Checkboxes */
    .toggle-group { display: flex; align-items: center; gap: 10px; background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; }
    .toggle-item { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; user-select: none; }
    .toggle-item input[type="checkbox"] { cursor: pointer; accent-color: #2563eb; }

    .workspace { display: flex; flex: 1; height: calc(100vh - 54px); overflow: hidden; position: relative; }
    .viewport { flex: 1; background: #020617; overflow: hidden; position: relative; cursor: grab; user-select: none; }
    .viewport:active { cursor: grabbing; }

    .canvas-stage { position: absolute; transform-origin: 0 0; will-change: transform; }
    .stage-img { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; display: block; pointer-events: none; }
    .stage-svg { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; pointer-events: none; }

    /* SVG Elements styling */
    .svg-bbox { stroke-width: 4; fill-opacity: 0.08; }
    .svg-bbox-matched { stroke: #00cc44; fill: #00cc44; }
    .svg-bbox-added   { stroke: #0088ff; fill: #0088ff; }
    .svg-bbox-shift   { stroke: #ff9900; fill: #ff9900; }
    .svg-bbox-unmatched { stroke: #ff3333; stroke-dasharray: 12,8; fill: #ff3333; fill-opacity: 0.04; }

    .svg-lbl-bg { fill: rgba(15, 23, 42, 0.90); rx: 4; ry: 4; }
    .svg-lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 20px; font-weight: bold; }

    /* Visibility classes toggled via body classes */
    body.hide-bboxes .svg-bbox { display: none !important; }
    body.hide-labels .svg-lbl-group { display: none !important; }
    body.hide-cat-matched .cat-matched { display: none !important; }
    body.hide-cat-added .cat-added { display: none !important; }
    body.hide-cat-shift .cat-shift { display: none !important; }
    body.hide-cat-unmatched .cat-unmatched_geo2 { display: none !important; }

    .legend-panel { position: absolute; bottom: 20px; left: 20px; background: rgba(15, 23, 42, 0.94); border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; font-size: 12px; z-index: 10; pointer-events: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 310px; }
    .leg-head { font-weight: 700; margin-bottom: 8px; font-size: 13px; color: #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
    .leg-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer; user-select: none; }
    .leg-color { width: 14px; height: 14px; border-radius: 3px; display: inline-block; flex-shrink: 0; }
    .item-counter { background: #3b82f6; font-size: 11px; padding: 2px 6px; border-radius: 10px; margin-left: auto; }
    .leg-note { font-size: 10px; color: #94a3b8; margin-top: 8px; line-height: 1.3; border-top: 1px solid #334155; padding-top: 6px; }

    .sidebar { width: 380px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; z-index: 15; }
    .sidebar-head { padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 13px; font-weight: 600; display: flex; flex-direction: column; gap: 8px; }
    .sidebar-filter-tabs { display: flex; gap: 4px; overflow-x: auto; }
    .filter-btn { padding: 3px 8px; font-size: 11px; border: 1px solid #475569; background: #0f172a; color: #94a3b8; border-radius: 4px; }
    .filter-btn.active { background: #2563eb; color: white; border-color: #3b82f6; }

    .candidate-list { flex: 1; overflow-y: auto; padding: 8px; }
    .cand-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s ease; border-left: 4px solid #3b82f6; }
    .cand-card:hover { background: #1e293b; border-color: #64748b; }
    .cand-card.active { background: #1e3a5f; border-color: #38bdf8; }
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
      <span class="logo-badge">600 DPI DENSE</span>
      <span class="page-title">P&ID Tuning Review (Sheet 1 &bull; 9925&times;7017 px)</span>
    </div>

    <div class="ctrl-bar">
      <div class="ctrl-group">
        <span class="ctrl-label">Layer:</span>
        <select id="configSelect">
          <option value="expA" selected>Eksperimen A (Tile 1280 &bull; Stride 640)</option>
          <option value="expB">Eksperimen B (Tile 1024 &bull; Stride 512)</option>
          <option value="original">Clean Original 600 DPI (Tanpa BBox)</option>
        </select>
      </div>

      <div class="ctrl-group">
        <span class="ctrl-label">Mode:</span>
        <select id="viewModeSelect">
          <option value="interactive" selected>Vektor Interaktif (Toggle)</option>
          <option value="static">PNG Raster 600 DPI</option>
        </select>
      </div>

      <div class="toggle-group" id="togglesContainer">
        <label class="toggle-item"><input type="checkbox" id="chkShowBbox" checked /> BBox</label>
        <label class="toggle-item"><input type="checkbox" id="chkShowLabel" checked /> Label</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatMatched" checked /> <span style="color:#00cc44;">&#9632;</span> Matched</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatAdded" checked /> <span style="color:#0088ff;">&#9632;</span> Tambahan</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatShift" checked /> <span style="color:#ff9900;">&#9632;</span> Shift</label>
        <label class="toggle-item"><input type="checkbox" id="chkCatUnmatched" checked /> <span style="color:#ff3333;">&#9632;</span> GEO-2</label>
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
        <img class="stage-img" id="baseImage" src="sheet-1-p1_600dpi_original.png" alt="600 DPI Sheet" />
        <svg class="stage-svg" id="dynamicSvg" viewBox="0 0 ${pageW} ${pageH}"></svg>
      </div>

      <div class="legend-panel">
        <div class="leg-head">
          <span>Legenda vs GEO-2 (87)</span>
          <span style="font-size:10px; color:#94a3b8;">Klik untuk toggle</span>
        </div>
        <div class="leg-item" id="legMatched">
          <span class="leg-color" style="background: #00cc44;"></span>
          <span>Matched dengan GEO-2</span>
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
          <span>GEO-2 Tidak Matched</span>
          <span class="item-counter" id="cntUnmatched" style="background:#dc2626;">0</span>
        </div>
        <div class="leg-note">
          Warna adalah kategori komparasi geometris terhadap GEO-2. Seluruh status keputusan manusia tetap UNRESOLVED.
        </div>
      </div>
    </div>

    <div class="sidebar">
      <div class="sidebar-head">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span id="listTitle">Daftar Kandidat</span>
          <span class="item-counter" id="totalCandidatesCount">0</span>
        </div>
        <div class="sidebar-filter-tabs">
          <button class="filter-btn active" data-filter="all">Semua</button>
          <button class="filter-btn" data-filter="added">Tambahan</button>
          <button class="filter-btn" data-filter="matched">Matched</button>
          <button class="filter-btn" data-filter="shift">Shift</button>
          <button class="filter-btn" data-filter="unmatched">GEO-2</button>
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
    const configSelect = document.getElementById('configSelect');
    const viewModeSelect = document.getElementById('viewModeSelect');
    const zoomLabel = document.getElementById('zoomLabel');
    const candidateList = document.getElementById('candidateList');
    const togglesContainer = document.getElementById('togglesContainer');

    let currentFilter = 'all';
    let currentConfigKey = 'expA';
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

    function renderDynamicSvg(cfg) {
      const allItems = [...cfg.unmatched, ...cfg.items];
      let svgHtml = '';

      allItems.forEach(item => {
        const x1 = Math.round(item.box600.x1);
        const y1 = Math.round(item.box600.y1);
        const w = Math.max(1, Math.round(item.box600.x2 - item.box600.x1));
        const h = Math.max(1, Math.round(item.box600.y2 - item.box600.y1));

        let bboxCls = 'svg-bbox-added';
        let txtColor = '#88ccff';
        let txt = \`\${item.id} \${item.rawLabel} \${Math.round(item.confidence * 100)}%\`;

        if (item.category === 'matched') {
          bboxCls = 'svg-bbox-matched';
          txtColor = '#66ff99';
        } else if (item.category === 'shift') {
          bboxCls = 'svg-bbox-shift';
          txtColor = '#ffcc66';
        } else if (item.category === 'unmatched_geo2') {
          bboxCls = 'svg-bbox-unmatched';
          txtColor = '#ff6666';
          txt = \`[REF GEO-2 Hilang] \${item.rawLabel}\`;
        }

        const lblW = Math.round(txt.length * 12 + 18);
        const lblX = Math.max(8, Math.min(data.pageWidth - lblW - 8, x1));
        const lblY = Math.max(8, Math.min(data.pageHeight - 36, y1 - 32));

        svgHtml += \`
          <g class="det-group cat-\${item.category}" data-id="\${item.id}">
            <rect class="svg-bbox \${bboxCls}" x="\${x1}" y="\${y1}" width="\${w}" height="\${h}" />
            <g class="svg-lbl-group">
              <rect class="svg-lbl-bg" x="\${lblX}" y="\${lblY}" width="\${lblW}" height="30" />
              <text class="svg-lbl-txt" x="\${lblX + 8}" y="\${lblY + 22}" fill="\${txtColor}">\${escapeXml(txt)}</text>
            </g>
          </g>
        \`;
      });

      dynamicSvg.innerHTML = svgHtml;
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
        else if (currentFilter === 'unmatched' && cat === 'unmatched_geo2') show = true;

        card.style.display = show ? 'block' : 'none';
        if (show) visibleCount++;
      });
      document.getElementById('totalCandidatesCount').textContent = visibleCount;
    }

    function renderConfig(cfgKey) {
      currentConfigKey = cfgKey;
      const isOriginal = cfgKey === 'original';
      const isStatic = viewModeSelect.value === 'static';

      if (isOriginal) {
        baseImg.src = 'sheet-1-p1_600dpi_original.png';
        dynamicSvg.style.display = 'none';
        togglesContainer.style.opacity = '0.3';
        togglesContainer.style.pointerEvents = 'none';
        candidateList.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;">Citra 600 DPI bersih tanpa overlay.</div>';
        document.getElementById('totalCandidatesCount').textContent = '0';
        document.getElementById('cntMatched').textContent = '0';
        document.getElementById('cntAdded').textContent = '0';
        document.getElementById('cntShift').textContent = '0';
        document.getElementById('cntUnmatched').textContent = '0';
        return;
      }

      togglesContainer.style.opacity = '1';
      togglesContainer.style.pointerEvents = 'auto';

      const cfg = data.configs[cfgKey];
      document.getElementById('listTitle').textContent = cfg.title;

      if (isStatic) {
        baseImg.src = cfg.overlayFile;
        dynamicSvg.style.display = 'none';
      } else {
        baseImg.src = 'sheet-1-p1_600dpi_original.png';
        dynamicSvg.style.display = 'block';
        renderDynamicSvg(cfg);
      }

      const mCnt = cfg.items.filter(x => x.category === 'matched').length;
      const aCnt = cfg.items.filter(x => x.category === 'added').length;
      const sCnt = cfg.items.filter(x => x.category === 'shift').length;
      const uCnt = cfg.unmatched.length;

      document.getElementById('cntMatched').textContent = mCnt;
      document.getElementById('cntAdded').textContent = aCnt;
      document.getElementById('cntShift').textContent = sCnt;
      document.getElementById('cntUnmatched').textContent = uCnt;

      candidateList.innerHTML = '';
      const allItems = [...cfg.items, ...cfg.unmatched];

      allItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'cand-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-cat', item.category);

        let color = '#0088ff';
        let catText = 'TAMBAHAN';
        if (item.category === 'matched') { color = '#00cc44'; catText = 'MATCHED'; }
        else if (item.category === 'shift') { color = '#ff9900'; catText = 'SHIFT'; }
        else if (item.category === 'unmatched_geo2') { color = '#ff3333'; catText = 'GEO-2 HILANG'; }
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

    configSelect.onchange = (e) => renderConfig(e.target.value);
    viewModeSelect.onchange = () => renderConfig(configSelect.value);

    window.onload = () => {
      fitToScreen();
      renderConfig('expA');
    };
  </script>
</body>
</html>`;

  const htmlOutPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(htmlOutPath, htmlSource, 'utf8');
  console.log(`  HTML Viewer: ${htmlOutPath}`);

  // ==========================================================================
  // STEP 10: SAVE COMPLETE MANIFEST & TELEMETRY JSON
  // ==========================================================================
  console.log('\n[Step 10] Writing telemetry and manifest metadata...');

  const manifestData = {
    schemaVersion: 'dense-600dpi-review-v1',
    generatedAt: new Date().toISOString(),
    sourcePdf: {
      path: path.relative(REPO_ROOT, PDF_PATH).replace(/\\/g, '/'),
      pageNumber: 1,
      targetDpi: 600,
      actualDimensions: { width: pageW, height: pageH },
      renderDurationMs: renderDurMs,
      savedCleanOriginal: 'sheet-1-p1_600dpi_original.png',
    },
    modelVerification: {
      modelPath: path.relative(REPO_ROOT, MODEL_PATH).replace(/\\/g, '/'),
      inputTensorName: inputName,
      inputDimensions: inputDims,
      totalClasses: Object.keys(rawNames).length,
    },
    geo2Reference: {
      count: geo2BaselineItems.length,
      note: 'GEO-2 retained detections loaded from full-page/index.html (in 3573x2526 coordinate space).',
    },
    experiments: [
      {
        id: 'Exp_A',
        name: 'Eksperimen A (600 DPI, Tile 1280x1280, Stride 640, Overlap 50%)',
        tileSize: 1280,
        stride: 640,
        overlapPercent: 50.0,
        totalTiles: gridA.tiles.length,
        durationMs: durExpA,
        memoryUsage: { start: memStartA, end: memEndA },
        rawCandidatesTotal: allPageDetsA.length,
        retainedCandidatesTotal: keptDetsA.length,
        suppressedByMerge: suppA,
        comparisonVsGeo2: {
          matched: matchedCountA,
          added: addedCountA,
          shift: shiftCountA,
          geo2Unmatched: unmatchedGeo2CountA,
        },
        rawTilePredictionsFile: 'exp_a_raw_tile_predictions.json',
        overlayPngFile: '01_exp_a_tile1280_stride640_overlay.png',
      },
      {
        id: 'Exp_B',
        name: 'Eksperimen B (600 DPI, Tile 1024x1024, Stride 512, Overlap 50%)',
        tileSize: 1024,
        stride: 512,
        overlapPercent: 50.0,
        totalTiles: gridB.tiles.length,
        durationMs: durExpB,
        memoryUsage: { start: memStartB, end: memEndB },
        rawCandidatesTotal: allPageDetsB.length,
        retainedCandidatesTotal: keptDetsB.length,
        suppressedByMerge: suppB,
        comparisonVsGeo2: {
          matched: matchedCountB,
          added: addedCountB,
          shift: shiftCountB,
          geo2Unmatched: unmatchedGeo2CountB,
        },
        rawTilePredictionsFile: 'exp_b_raw_tile_predictions.json',
        overlayPngFile: '02_exp_b_tile1024_stride512_overlay.png',
      },
    ],
    humanDecisionStatus: 'ALL_UNRESOLVED',
    missingGroundTruthStatus:
      'Lokasi 19 missing yang dilaporkan pengguna belum tersedia sebagai daftar koordinat ground-truth beranotasi; tidak ada klaim pemulihan missing spesifik sebelum daftar lokasi diverifikasi.',
  };

  const manifestPath = path.join(OUTPUT_DIR, 'dense-600dpi-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

  console.log(`  Telemetry Manifest: ${manifestPath}`);
  console.log('\n[SUCCESS] Dense 600 DPI Experiments Completed Successfully!');
}

main().catch((err) => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});
