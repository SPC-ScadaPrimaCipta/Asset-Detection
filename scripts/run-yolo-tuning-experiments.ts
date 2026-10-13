#!/usr/bin/env tsx
/**
 * YOLO v203 Offline Local Inference Tuning & Geometry Sweep
 *
 * SCOPE:
 *   - Offline parameter exploration on copied inputs only.
 *   - Zero requests to Gemini.
 *   - Model, baseline artifacts, dataset, production, and Settings remain strictly untouched.
 *   - Exclusive output saved to fixtures/diagnostics/tuning-experiments/
 *
 * EVALUATION EXPERIMENTS:
 *   1. Geometry Sweep:
 *      - Baseline: tileSize 1024, stride 819 (~20% overlap, zero resize)
 *      - Tile Size Variations: 768 (zoom-in via letterbox/scale to 1024) and 1280 (zoom-out via letterbox/scale to 1024)
 *      - Overlap Variations: ~10% (stride 922) and ~35% (stride 665)
 *   2. Threshold Sweep (on most promising geometry, with cached raw predictions):
 *      - Confidence threshold: 0.35, 0.50, 0.65
 *      - Per-tile NMS IoU: 0.50, 0.70, 0.85
 *      - Global merge IoU: 0.35, 0.50, 0.65
 *      - Class-aware vs Class-agnostic global merge
 *   3. Native PDF DPI Sweep:
 *      - Scale 2.0 (144 DPI) and Scale 4.0 (288 DPI) rendered directly via render-page.mjs from source PDF
 *   4. Visual overlays & comprehensive audit reporting.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {
  getYoloV203Session,
  DEFAULT_V203_MODEL_PATH,
} from '../lib/detection/yolo/yolo-inference-v203';
import { valueAtV203 } from '../lib/detection/yolo/yolo-decoder-v203';
import {
  resolveYoloV203Class,
  YOLO_V203_INPUT_SIZE,
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_CLASS_COUNT,
} from '../lib/detection/yolo/yolo-class-map-v203';

const REPO_ROOT = path.resolve(__dirname, '..');
const MODEL_PATH = path.resolve(REPO_ROOT, DEFAULT_V203_MODEL_PATH);
const SOURCE_IMAGE_PATH = path.join(REPO_ROOT, 'fixtures/pid-eval/sheet-1/page_1.png');
const SOURCE_PDF_PATH = path.join(
  REPO_ROOT,
  'storage/eval-ab6fa321-0671-4518-8b56-fb1117d91068-ASBUILTSPPDT_11_PE_01_PP_001_Rev_1_P&ID_SP_Pondok_Tengah_Sheet_1.pdf',
);
const RENDER_SCRIPT = path.join(REPO_ROOT, 'scripts/render-page.mjs');

const EXPERIMENT_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments');
const OVERLAY_DIR = path.join(EXPERIMENT_DIR, 'overlays');
const DPI_DIR = path.join(EXPERIMENT_DIR, 'dpi-test');
const COPIED_INPUT_PATH = path.join(EXPERIMENT_DIR, 'input_page_1.png');
const REPORT_FILE = path.join(EXPERIMENT_DIR, 'tuning-report.json');

// Interface definitions
export interface RawCandidate {
  anchor: number;
  rawClassId: number;
  score: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in tile coords
}

export interface PageDetection {
  detectionId: string;
  rawClassId: number;
  rawLabel: string;
  confidence: number;
  tileIndex: number;
  detectionIndex: number;
  pageBox: { x1: number; y1: number; x2: number; y2: number };
  tileBox: { x1: number; y1: number; x2: number; y2: number };
}

export interface TileGridInfo {
  tileSize: number;
  stride: number;
  scaleFactor: number; // tile dimension to ONNX 1024
  xOffsets: number[];
  yOffsets: number[];
  tiles: Array<{
    tileIndex: number;
    col: number;
    row: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function computeIoU(
  a: { x1: number; y1: number; x2: number; y2: number } | [number, number, number, number],
  b: { x1: number; y1: number; x2: number; y2: number } | [number, number, number, number],
): number {
  const ax1 = Array.isArray(a) ? a[0] : a.x1;
  const ay1 = Array.isArray(a) ? a[1] : a.y1;
  const ax2 = Array.isArray(a) ? a[2] : a.x2;
  const ay2 = Array.isArray(a) ? a[3] : a.y2;

  const bx1 = Array.isArray(b) ? b[0] : b.x1;
  const by1 = Array.isArray(b) ? b[1] : b.y1;
  const bx2 = Array.isArray(b) ? b[2] : b.x2;
  const by2 = Array.isArray(b) ? b[3] : b.y2;

  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;

  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Generate 1D axis offsets with specified stride and tile size
 */
function generateAxisOffsets(dimension: number, tileSize: number, stride: number): number[] {
  if (dimension <= tileSize) return [0];
  const offsets: number[] = [0];
  let curr = 0;
  while (curr + stride + tileSize <= dimension) {
    curr += stride;
    offsets.push(curr);
  }
  const lastOffset = dimension - tileSize;
  if (lastOffset > 0) offsets.push(lastOffset);
  return Array.from(new Set(offsets)).sort((a, b) => a - b);
}

/**
 * Build tile grid for given page dimension and tile configuration
 */
function buildTileGrid(pageW: number, pageH: number, tileSize: number, stride: number): TileGridInfo {
  const xOffsets = generateAxisOffsets(pageW, tileSize, stride);
  const yOffsets = generateAxisOffsets(pageH, tileSize, stride);
  const tiles: TileGridInfo['tiles'] = [];
  let tileIndex = 0;

  for (let r = 0; r < yOffsets.length; r++) {
    const y = yOffsets[r];
    for (let c = 0; c < xOffsets.length; c++) {
      const x = xOffsets[c];
      tiles.push({
        tileIndex,
        col: c,
        row: r,
        x,
        y,
        width: tileSize,
        height: tileSize,
      });
      tileIndex++;
    }
  }

  return {
    tileSize,
    stride,
    scaleFactor: YOLO_V203_INPUT_SIZE / tileSize, // 1024 / tileSize
    xOffsets,
    yOffsets,
    tiles,
  };
}

/**
 * Extract an RGB tile and convert to 1024x1024 NCHW Float32Array
 */
async function extractTileTensor(
  fullRgb: Uint8Array,
  pageW: number,
  pageH: number,
  tile: { x: number; y: number; width: number; height: number },
  onnxSize = YOLO_V203_INPUT_SIZE,
): Promise<{ tensor: Float32Array; validW: number; validH: number }> {
  const validW = Math.max(0, Math.min(tile.width, pageW - tile.x));
  const validH = Math.max(0, Math.min(tile.height, pageH - tile.y));

  // If tileSize == onnxSize (1024), we can extract directly with grey padding
  if (tile.width === onnxSize && tile.height === onnxSize) {
    const planeSize = onnxSize * onnxSize;
    const tensor = new Float32Array(3 * planeSize);
    tensor.fill(114 / 255.0); // neutral grey padding

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

        tensor[dstIdx] = fullRgb[srcPixel] / 255.0;
        tensor[planeSize + dstIdx] = fullRgb[srcPixel + 1] / 255.0;
        tensor[2 * planeSize + dstIdx] = fullRgb[srcPixel + 2] / 255.0;
      }
    }
    return { tensor, validW, validH };
  }

  // Non-1024 tile size: crop using sharp, then letterbox/resize to 1024x1024
  const extractW = Math.min(tile.width, pageW - tile.x);
  const extractH = Math.min(tile.height, pageH - tile.y);

  // Extract sub-buffer
  const tileRgb = await sharp(Buffer.from(fullRgb), {
    raw: { width: pageW, height: pageH, channels: 3 },
  })
    .extract({ left: tile.x, top: tile.y, width: extractW, height: extractH })
    .resize(onnxSize, onnxSize, {
      fit: 'fill',
    })
    .raw()
    .toBuffer();

  const planeSize = onnxSize * onnxSize;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = tileRgb[i * 3] / 255.0;
    tensor[planeSize + i] = tileRgb[i * 3 + 1] / 255.0;
    tensor[2 * planeSize + i] = tileRgb[i * 3 + 2] / 255.0;
  }
  return { tensor, validW, validH };
}

/**
 * Run ONNX inference on a 1024x1024 Float32Array tensor and return candidate predictions above minScore
 */
async function inferTile(
  session: ort.InferenceSession,
  tensor: Float32Array,
  minScore = 0.20,
): Promise<RawCandidate[]> {
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';

  const feeds: Record<string, ort.Tensor> = {
    [inputName]: new ort.Tensor('float32', tensor, [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE]),
  };

  const results = await session.run(feeds);
  const rawOutput = results[outputName].data as Float32Array;

  const candidates: RawCandidate[] = [];
  for (let i = 0; i < YOLO_V203_CANDIDATE_COUNT; i++) {
    const cx = valueAtV203(rawOutput, 0, i);
    const cy = valueAtV203(rawOutput, 1, i);
    const w = valueAtV203(rawOutput, 2, i);
    const h = valueAtV203(rawOutput, 3, i);

    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < YOLO_V203_CLASS_COUNT; c++) {
      const s = valueAtV203(rawOutput, YOLO_V203_CLASS_CHANNEL_OFFSET + c, i);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }

    if (bestScore >= minScore) {
      const x1 = cx - w / 2;
      const y1 = cy - h / 2;
      const x2 = cx + w / 2;
      const y2 = cy + h / 2;
      if (x2 - x1 >= 1 && y2 - y1 >= 1) {
        candidates.push({
          anchor: i,
          rawClassId: bestClass,
          score: bestScore,
          bbox: [x1, y1, x2, y2],
        });
      }
    }
  }

  return candidates;
}

/**
 * Filter and apply per-tile NMS (class-aware)
 */
function applyPerTileNms(
  candidates: RawCandidate[],
  confThreshold: number,
  nmsIouThreshold: number,
  maxCap = 300,
): RawCandidate[] {
  const filtered = candidates.filter((c) => c.score >= confThreshold);
  filtered.sort((a, b) => b.score - a.score || a.anchor - b.anchor);

  const kept: RawCandidate[] = [];
  const classes = Array.from(new Set(filtered.map((c) => c.rawClassId))).sort((a, b) => a - b);

  for (const cls of classes) {
    const clsCands = filtered.filter((c) => c.rawClassId === cls);
    const suppressed = new Array<boolean>(clsCands.length).fill(false);

    for (let i = 0; i < clsCands.length; i++) {
      if (suppressed[i]) continue;
      const active = clsCands[i];
      kept.push(active);

      for (let j = i + 1; j < clsCands.length; j++) {
        if (suppressed[j]) continue;
        const iou = computeIoU(active.bbox, clsCands[j].bbox);
        if (iou >= nmsIouThreshold) {
          suppressed[j] = true;
        }
      }
    }
  }

  // Cap per tile
  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, maxCap);
}

/**
 * Map tile candidates to full page coordinate space
 */
function mapCandidatesToPage(
  tileCandidates: RawCandidate[],
  tile: { tileIndex: number; x: number; y: number; width: number; height: number },
  scaleFactor: number,
  pageW: number,
  pageH: number,
): PageDetection[] {
  const mapped: PageDetection[] = [];

  for (let i = 0; i < tileCandidates.length; i++) {
    const cand = tileCandidates[i];
    // Scale from ONNX space (1024) back to tile space
    const tileX1 = cand.bbox[0] / scaleFactor;
    const tileY1 = cand.bbox[1] / scaleFactor;
    const tileX2 = cand.bbox[2] / scaleFactor;
    const tileY2 = cand.bbox[3] / scaleFactor;

    // Check padding boundary rejection
    const validW = Math.min(tile.width, pageW - tile.x);
    const validH = Math.min(tile.height, pageH - tile.y);
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

    const rawLabel = resolveYoloV203Class(cand.rawClassId)?.yoloLabel || `class_${cand.rawClassId}`;

    mapped.push({
      detectionId: `${cand.rawClassId}:${tile.tileIndex}:${i}`,
      rawClassId: cand.rawClassId,
      rawLabel,
      confidence: cand.score,
      tileIndex: tile.tileIndex,
      detectionIndex: i,
      pageBox: { x1: pageX1, y1: pageY1, x2: pageX2, y2: pageY2 },
      tileBox: { x1: tileX1, y1: tileY1, x2: tileX2, y2: tileY2 },
    });
  }

  return mapped;
}

/**
 * Global merge across all tiles
 */
function mergeGlobalCandidates(
  candidates: PageDetection[],
  globalMergeIou: number,
  classAware: boolean,
): { kept: PageDetection[]; suppressedCount: number } {
  const sorted = [...candidates].sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 1e-9) return b.confidence - a.confidence;
    if (a.tileIndex !== b.tileIndex) return a.tileIndex - b.tileIndex;
    return a.detectionIndex - b.detectionIndex;
  });

  const suppressed = new Array<boolean>(sorted.length).fill(false);
  const kept: PageDetection[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed[i]) continue;
    const active = sorted[i];
    kept.push(active);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed[j]) continue;
      const neighbor = sorted[j];

      if (classAware && active.rawClassId !== neighbor.rawClassId) {
        continue; // Different class not suppressed under class-aware
      }

      const iou = computeIoU(active.pageBox, neighbor.pageBox);
      if (iou >= globalMergeIou) {
        suppressed[j] = true;
      }
    }
  }

  return { kept, suppressedCount: sorted.length - kept.length };
}

/**
 * Render PDF page using child_process render-page.mjs
 */
async function renderPdfScale(scale: number, outPath: string): Promise<{ width: number; height: number }> {
  const pdfBuf = fs.readFileSync(SOURCE_PDF_PATH);
  const payload = JSON.stringify({
    pdf: pdfBuf.toString('base64'),
    page: 1,
    scale,
  });

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile('node', [RENDER_SCRIPT], { maxBuffer: 100 * 1024 * 1024 });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0 && !out) reject(new Error(`render-page exited ${code}: ${err}`));
      else resolve(out);
    });
    child.stdin?.write(payload);
    child.stdin?.end();
  });

  const result = JSON.parse(stdout) as { png: string; width: number; height: number; error?: string };
  if (result.error) throw new Error(result.error);

  const pngBuf = Buffer.from(result.png, 'base64');
  fs.writeFileSync(outPath, pngBuf);
  return { width: result.width, height: result.height };
}

/**
 * Generate visual overlay image with SVG composite
 */
async function generateOverlayImage(
  imagePath: string,
  detections: PageDetection[],
  pageW: number,
  pageH: number,
  outPath: string,
  title: string,
): Promise<void> {
  const svgElements: string[] = [
    `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
    `<style>
      .bbox { fill: rgba(0, 150, 255, 0.10); stroke: #0077ff; stroke-width: 2.5; }
      .lbl-bg { fill: rgba(0, 0, 0, 0.82); rx: 3; ry: 3; }
      .lbl-txt { fill: #00ffcc; font-family: monospace, sans-serif; font-size: 11px; font-weight: bold; }
      .hdr-bg { fill: rgba(10, 20, 30, 0.90); }
      .hdr-txt { fill: #ffffff; font-family: sans-serif; font-size: 18px; font-weight: bold; }
    </style>`,
    // Banner header
    `<rect class="hdr-bg" x="0" y="0" width="${pageW}" height="40" />`,
    `<text class="hdr-txt" x="20" y="26">${escapeXml(title)} | Count: ${detections.length}</text>`,
  ];

  for (const det of detections) {
    const x1 = Math.round(det.pageBox.x1);
    const y1 = Math.round(det.pageBox.y1);
    const x2 = Math.round(det.pageBox.x2);
    const y2 = Math.round(det.pageBox.y2);
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);

    svgElements.push(`<rect class="bbox" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);

    const lbl = `${det.rawLabel} ${(det.confidence * 100).toFixed(0)}%`;
    const lblW = Math.max(70, Math.round(lbl.length * 7.2 + 8));
    const lblH = 16;
    const lblY = Math.max(42, y1 - lblH - 2);

    svgElements.push(
      `<rect class="lbl-bg" x="${x1}" y="${lblY}" width="${lblW}" height="${lblH}" />`,
      `<text class="lbl-txt" x="${x1 + 4}" y="${lblY + 12}">${escapeXml(lbl)}</text>`,
    );
  }

  svgElements.push('</svg>');
  const svgBuf = Buffer.from(svgElements.join('\n'));

  await sharp(imagePath)
    .composite([{ input: svgBuf }])
    .png()
    .toFile(outPath);
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

export async function runTuningExperiments() {
  console.log('================================================================');
  console.log('   YOLO v203 Local Inference Tuning & Geometry Sweep Runner');
  console.log('================================================================\n');

  // Ensure directories exist
  fs.mkdirSync(EXPERIMENT_DIR, { recursive: true });
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });
  fs.mkdirSync(DPI_DIR, { recursive: true });

  // 1. Copy input page to preserve original artifacts
  console.log('[Step 1] Preparing isolated input copy...');
  fs.copyFileSync(SOURCE_IMAGE_PATH, COPIED_INPUT_PATH);
  const imgMeta = await sharp(COPIED_INPUT_PATH).metadata();
  const pageW = imgMeta.width!;
  const pageH = imgMeta.height!;
  console.log(`  Source Image: ${pageW}x${pageH} copied to ${COPIED_INPUT_PATH}`);

  // Load raw RGB into memory
  const sharpDecoded = await sharp(COPIED_INPUT_PATH)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pageRgb = sharpDecoded.data;

  // Initialize ONNX Session
  console.log('[Step 2] Initializing ONNX session (CPU)...');
  const session = await getYoloV203Session(MODEL_PATH);

  // Store experiment results
  const experimentResults: any[] = [];

  // ==========================================================================
  // EXPERIMENT 1: Tile Geometry & Overlap Sweep
  // ==========================================================================
  console.log('\n[Step 3] Running Geometry & Overlap Sweep...');

  const geometryConfigs = [
    {
      id: 'GEO-0_Baseline',
      name: 'Baseline (Tile 1024, Overlap ~20%, Stride 819)',
      tileSize: 1024,
      stride: 819,
      conf: 0.50,
      perTileNms: 0.70,
      mergeIou: 0.50,
      classAware: true,
    },
    {
      id: 'GEO-1_Tile768',
      name: 'Tile 768 (Zoom-in 1.33x, Overlap ~20%, Stride 614)',
      tileSize: 768,
      stride: 614,
      conf: 0.50,
      perTileNms: 0.70,
      mergeIou: 0.50,
      classAware: true,
    },
    {
      id: 'GEO-2_Tile1280',
      name: 'Tile 1280 (Zoom-out 0.8x, Overlap ~20%, Stride 1024)',
      tileSize: 1280,
      stride: 1024,
      conf: 0.50,
      perTileNms: 0.70,
      mergeIou: 0.50,
      classAware: true,
    },
    {
      id: 'GEO-3_Overlap10',
      name: 'Tile 1024, Low Overlap ~10% (Stride 922)',
      tileSize: 1024,
      stride: 922,
      conf: 0.50,
      perTileNms: 0.70,
      mergeIou: 0.50,
      classAware: true,
    },
    {
      id: 'GEO-4_Overlap35',
      name: 'Tile 1024, High Overlap ~35% (Stride 665)',
      tileSize: 1024,
      stride: 665,
      conf: 0.50,
      perTileNms: 0.70,
      mergeIou: 0.50,
      classAware: true,
    },
  ];

  // We will cache raw candidates for GEO-0 (Baseline) and GEO-4 (Overlap35) to allow fast threshold sweeping
  const cachedTileCandidates: Record<string, { grid: TileGridInfo; tiles: RawCandidate[][] }> = {};

  for (const cfg of geometryConfigs) {
    const t0 = performance.now();
    const grid = buildTileGrid(pageW, pageH, cfg.tileSize, cfg.stride);
    const rawTileCandidates: RawCandidate[][] = [];
    let allPageDetections: PageDetection[] = [];

    for (const tile of grid.tiles) {
      const { tensor } = await extractTileTensor(pageRgb, pageW, pageH, tile);
      // Run inference caching at low minScore (0.20) for flexibility
      const tileCands = await inferTile(session, tensor, 0.20);
      rawTileCandidates.push(tileCands);

      // Filter and NMS per tile with current config
      const nmsKept = applyPerTileNms(tileCands, cfg.conf, cfg.perTileNms);
      const pageDets = mapCandidatesToPage(nmsKept, tile, grid.scaleFactor, pageW, pageH);
      allPageDetections.push(...pageDets);
    }

    // Global merge
    const mergeRes = mergeGlobalCandidates(allPageDetections, cfg.mergeIou, cfg.classAware);
    const durationMs = performance.now() - t0;

    // Cache candidates for threshold sweep
    cachedTileCandidates[cfg.id] = { grid, tiles: rawTileCandidates };

    // Generate overlay
    const overlayPath = path.join(OVERLAY_DIR, `${cfg.id}.png`);
    await generateOverlayImage(COPIED_INPUT_PATH, mergeRes.kept, pageW, pageH, overlayPath, cfg.name);

    const resultEntry = {
      configId: cfg.id,
      name: cfg.name,
      category: 'geometry_sweep',
      tileSize: cfg.tileSize,
      stride: cfg.stride,
      overlapPct: `${(((cfg.tileSize - cfg.stride) / cfg.tileSize) * 100).toFixed(1)}%`,
      numTiles: grid.tiles.length,
      confThreshold: cfg.conf,
      perTileNmsIou: cfg.perTileNms,
      globalMergeIou: cfg.mergeIou,
      classAware: cfg.classAware,
      rawCandidatesBeforeMerge: allPageDetections.length,
      retainedDetections: mergeRes.kept.length,
      suppressedCount: mergeRes.suppressedCount,
      durationMs: Math.round(durationMs),
      overlayPath: path.relative(REPO_ROOT, overlayPath),
      detections: mergeRes.kept,
    };
    experimentResults.push(resultEntry);

    console.log(
      `  [${cfg.id}] Tiles: ${grid.tiles.length} | Raw: ${allPageDetections.length} | Retained: ${mergeRes.kept.length} | Suppressed: ${mergeRes.suppressedCount} | ${Math.round(durationMs)}ms`,
    );
  }

  // ==========================================================================
  // EXPERIMENT 2: Threshold Sweeping on Promising Geometry (Cached Inference)
  // ==========================================================================
  console.log('\n[Step 4] Running Threshold Sweeps on Promising Geometry (Zero Inference Repetition)...');

  // We test on the 1024 Baseline geometry (15 tiles) and High Overlap geometry (18 tiles)
  const targetGeom = cachedTileCandidates['GEO-0_Baseline'];

  const thresholdVariations = [
    // Confidence sweep
    { id: 'CONF-0.35', name: 'Confidence 0.35 (Lower threshold)', conf: 0.35, nms: 0.70, merge: 0.50, classAware: true },
    { id: 'CONF-0.65', name: 'Confidence 0.65 (Higher threshold)', conf: 0.65, nms: 0.70, merge: 0.50, classAware: true },

    // Per-tile NMS IoU sweep
    { id: 'NMS-0.50', name: 'Per-Tile NMS IoU 0.50 (Stricter NMS)', conf: 0.50, nms: 0.50, merge: 0.50, classAware: true },
    { id: 'NMS-0.85', name: 'Per-Tile NMS IoU 0.85 (Looser NMS)', conf: 0.50, nms: 0.85, merge: 0.50, classAware: true },

    // Global merge IoU sweep
    { id: 'MERGE-0.35', name: 'Global Merge IoU 0.35 (Aggressive merge)', conf: 0.50, nms: 0.70, merge: 0.35, classAware: true },
    { id: 'MERGE-0.65', name: 'Global Merge IoU 0.65 (Conservative merge)', conf: 0.50, nms: 0.70, merge: 0.65, classAware: true },

    // Class-Aware vs Class-Agnostic
    { id: 'MERGE-Agnostic', name: 'Global Merge Class-Agnostic (Deduplicate across classes)', conf: 0.50, nms: 0.70, merge: 0.50, classAware: false },
  ];

  for (const tCfg of thresholdVariations) {
    const t0 = performance.now();
    let allPageDetections: PageDetection[] = [];

    for (let i = 0; i < targetGeom.grid.tiles.length; i++) {
      const tile = targetGeom.grid.tiles[i];
      const rawCands = targetGeom.tiles[i];
      const nmsKept = applyPerTileNms(rawCands, tCfg.conf, tCfg.nms);
      const pageDets = mapCandidatesToPage(nmsKept, tile, targetGeom.grid.scaleFactor, pageW, pageH);
      allPageDetections.push(...pageDets);
    }

    const mergeRes = mergeGlobalCandidates(allPageDetections, tCfg.merge, tCfg.classAware);
    const durationMs = performance.now() - t0;

    const overlayPath = path.join(OVERLAY_DIR, `${tCfg.id}.png`);
    await generateOverlayImage(COPIED_INPUT_PATH, mergeRes.kept, pageW, pageH, overlayPath, tCfg.name);

    const resultEntry = {
      configId: tCfg.id,
      name: tCfg.name,
      category: 'threshold_sweep',
      tileSize: targetGeom.grid.tileSize,
      stride: targetGeom.grid.stride,
      numTiles: targetGeom.grid.tiles.length,
      confThreshold: tCfg.conf,
      perTileNmsIou: tCfg.nms,
      globalMergeIou: tCfg.merge,
      classAware: tCfg.classAware,
      rawCandidatesBeforeMerge: allPageDetections.length,
      retainedDetections: mergeRes.kept.length,
      suppressedCount: mergeRes.suppressedCount,
      durationMs: Math.round(durationMs),
      overlayPath: path.relative(REPO_ROOT, overlayPath),
      detections: mergeRes.kept,
    };
    experimentResults.push(resultEntry);

    console.log(
      `  [${tCfg.id}] Raw: ${allPageDetections.length} | Retained: ${mergeRes.kept.length} | Suppressed: ${mergeRes.suppressedCount} | ${Math.round(durationMs)}ms (Fast)`,
    );
  }

  // ==========================================================================
  // EXPERIMENT 3: Source PDF DPI Sweep (scale 2.0 ≈ 144 DPI & scale 4.0 ≈ 288 DPI)
  // ==========================================================================
  console.log('\n[Step 5] Running Source PDF DPI Sweep (Direct PDF render)...');

  const dpiConfigs = [
    { scale: 2.0, approxDpi: 144, label: 'DPI-144_Scale2.0' },
    { scale: 4.0, approxDpi: 288, label: 'DPI-288_Scale4.0' },
  ];

  for (const dCfg of dpiConfigs) {
    const renderedPngPath = path.join(DPI_DIR, `sheet_1_${dCfg.label}.png`);
    console.log(`  Rendering PDF at scale ${dCfg.scale} (${dCfg.approxDpi} DPI)...`);
    const { width: dpiW, height: dpiH } = await renderPdfScale(dCfg.scale, renderedPngPath);
    console.log(`    Rendered dimensions: ${dpiW}x${dpiH}`);

    // Load decoded buffer
    const dpiDecoded = await sharp(renderedPngPath)
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const t0 = performance.now();
    // Use standard 1024 tile size
    const dpiGrid = buildTileGrid(dpiW, dpiH, 1024, 819);
    let allPageDetections: PageDetection[] = [];

    for (const tile of dpiGrid.tiles) {
      const { tensor } = await extractTileTensor(dpiDecoded.data, dpiW, dpiH, tile);
      const tileCands = await inferTile(session, tensor, 0.20);
      const nmsKept = applyPerTileNms(tileCands, 0.50, 0.70);
      const pageDets = mapCandidatesToPage(nmsKept, tile, dpiGrid.scaleFactor, dpiW, dpiH);
      allPageDetections.push(...pageDets);
    }

    const mergeRes = mergeGlobalCandidates(allPageDetections, 0.50, true);
    const durationMs = performance.now() - t0;

    const overlayPath = path.join(OVERLAY_DIR, `${dCfg.label}.png`);
    await generateOverlayImage(renderedPngPath, mergeRes.kept, dpiW, dpiH, overlayPath, `${dCfg.label} (${dCfg.approxDpi} DPI)`);

    const resultEntry = {
      configId: dCfg.label,
      name: `Source PDF Render Scale ${dCfg.scale} (~${dCfg.approxDpi} DPI)`,
      category: 'dpi_sweep',
      scale: dCfg.scale,
      approxDpi: dCfg.approxDpi,
      dimensions: { width: dpiW, height: dpiH },
      coordinateScaleVsBaseline: (dCfg.scale / 3.0).toFixed(3),
      tileSize: 1024,
      stride: 819,
      numTiles: dpiGrid.tiles.length,
      confThreshold: 0.50,
      perTileNmsIou: 0.70,
      globalMergeIou: 0.50,
      classAware: true,
      rawCandidatesBeforeMerge: allPageDetections.length,
      retainedDetections: mergeRes.kept.length,
      suppressedCount: mergeRes.suppressedCount,
      durationMs: Math.round(durationMs),
      renderedImagePath: path.relative(REPO_ROOT, renderedPngPath),
      overlayPath: path.relative(REPO_ROOT, overlayPath),
      detections: mergeRes.kept,
    };
    experimentResults.push(resultEntry);

    console.log(
      `  [${dCfg.label}] Dimensions: ${dpiW}x${dpiH} | Tiles: ${dpiGrid.tiles.length} | Raw: ${allPageDetections.length} | Retained: ${mergeRes.kept.length} | Suppressed: ${mergeRes.suppressedCount} | ${Math.round(durationMs)}ms`,
    );
  }

  // ==========================================================================
  // STEP 6: Problematic Symbol Analysis
  // ==========================================================================
  console.log('\n[Step 6] Analyzing boundary-affected, duplicate, and problematic symbols...');

  // Inspect Baseline (GEO-0) vs High Overlap (GEO-4) vs Low Overlap (GEO-3)
  const baselineDets = experimentResults.find((r) => r.configId === 'GEO-0_Baseline').detections as PageDetection[];
  const highOverlapDets = experimentResults.find((r) => r.configId === 'GEO-4_Overlap35').detections as PageDetection[];
  const lowOverlapDets = experimentResults.find((r) => r.configId === 'GEO-3_Overlap10').detections as PageDetection[];
  const tile768Dets = experimentResults.find((r) => r.configId === 'GEO-1_Tile768').detections as PageDetection[];
  const agnosticDets = experimentResults.find((r) => r.configId === 'MERGE-Agnostic').detections as PageDetection[];

  // Find symbols near tile seam (e.g. within 25px of tile boundaries x=819, x=1638, y=819, y=1502)
  const seamX = [819, 1638, 2457, 2549];
  const seamY = [819, 1502];

  const seamSymbols = baselineDets.filter((d) => {
    const nearX = seamX.some((sx) => Math.abs(d.pageBox.x1 - sx) < 40 || Math.abs(d.pageBox.x2 - sx) < 40);
    const nearY = seamY.some((sy) => Math.abs(d.pageBox.y1 - sy) < 40 || Math.abs(d.pageBox.y2 - sy) < 40);
    return nearX || nearY;
  });

  // Check multi-label overlaps (where IoU between two different class boxes is > 0.40 in baseline)
  const multiLabelPairs: Array<{ classA: string; classB: string; iou: number; box: any }> = [];
  for (let i = 0; i < baselineDets.length; i++) {
    for (let j = i + 1; j < baselineDets.length; j++) {
      if (baselineDets[i].rawClassId !== baselineDets[j].rawClassId) {
        const iou = computeIoU(baselineDets[i].pageBox, baselineDets[j].pageBox);
        if (iou >= 0.40) {
          multiLabelPairs.push({
            classA: baselineDets[i].rawLabel,
            classB: baselineDets[j].rawLabel,
            iou: parseFloat(iou.toFixed(3)),
            box: baselineDets[i].pageBox,
          });
        }
      }
    }
  }

  // Save report JSON
  const reportPayload = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      onnxruntime: ort.version,
      platform: process.platform,
    },
    baselineReference: {
      image: 'fixtures/pid-eval/sheet-1/page_1.png',
      dimensions: { width: pageW, height: pageH },
      modelPath: DEFAULT_V203_MODEL_PATH,
      expectedModelSha256: '92f22175ade687a0f7e29617c3a3ae9cbf80266dda6df30d74fb9c3c95917e6c',
    },
    experiments: experimentResults.map((r) => ({
      configId: r.configId,
      name: r.name,
      category: r.category,
      tileSize: r.tileSize,
      stride: r.stride,
      overlapPct: r.overlapPct,
      numTiles: r.numTiles,
      confThreshold: r.confThreshold,
      perTileNmsIou: r.perTileNmsIou,
      globalMergeIou: r.globalMergeIou,
      classAware: r.classAware,
      rawCandidatesBeforeMerge: r.rawCandidatesBeforeMerge,
      retainedDetections: r.retainedDetections,
      suppressedCount: r.suppressedCount,
      durationMs: r.durationMs,
      overlayPath: r.overlayPath,
    })),
    problematicAnalysis: {
      totalSeamBorderDetections: seamSymbols.length,
      seamBorderSampleBoxes: seamSymbols.slice(0, 5).map((s) => ({
        label: s.rawLabel,
        confidence: s.confidence,
        box: s.pageBox,
      })),
      multiLabelOverlappingPairs: multiLabelPairs,
      overlapImpactNotes: {
        baselineRetained: baselineDets.length,
        highOverlapRetained: highOverlapDets.length,
        lowOverlapRetained: lowOverlapDets.length,
        tile768Retained: tile768Dets.length,
        classAgnosticRetained: agnosticDets.length,
      },
    },
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(reportPayload, null, 2));
  console.log(`\n[OK] Complete tuning report saved to: ${REPORT_FILE}`);
  console.log(`[OK] All overlays generated in: ${OVERLAY_DIR}`);
}

// Execute if run directly
if (require.main === module || process.argv[1] === __filename) {
  runTuningExperiments().catch((err) => {
    console.error('Fatal error running tuning experiments:', err);
    process.exit(1);
  });
}
