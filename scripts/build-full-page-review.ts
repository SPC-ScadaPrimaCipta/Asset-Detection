#!/usr/bin/env tsx
/**
 * Full-Page Review Package Builder (YOLO v203 Tuning Results)
 *
 * SPECIFICATION:
 *   - Source: sheet-1-p1 (3573x2526 px), exact resolution (zero resize).
 *   - Exclusive directory: fixtures/diagnostics/tuning-experiments/review-package/full-page/
 *   - Produces 4 full-page overlay PNGs (Baseline 60, GEO-4 70, GEO-1 87, GEO-2 87).
 *   - Produces interactive offline HTML with zoom/pan, layer toggles, and candidate list.
 *   - Color scheme:
 *       Green  (#00cc44): Matched with baseline
 *       Blue   (#0088ff): Added candidates
 *       Orange (#ff9900): Class or BBox shift
 *       Dashed Red (#ff3333): Baseline reference not matched
 *   - Offline only (no CDN / external network).
 */

import * as fs from 'fs';
import * as path from 'path';
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
const BASELINE_JSON_PATH = path.join(REPO_ROOT, 'fixtures/diagnostics/predictions-v203-baseline.json');
const FULL_PAGE_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments/review-package/full-page');

export interface DetectionItem {
  id: string;
  rawClassId: number;
  rawLabel: string;
  confidence: number;
  tileIndex: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  category: 'matched' | 'added' | 'shift' | 'baseline_only' | 'missed_baseline';
  matchedId?: string;
  iou?: number;
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
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): number {
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

function buildGrid(pageW: number, pageH: number, tileSize: number, stride: number) {
  const xOffsets = generateAxisOffsets(pageW, tileSize, stride);
  const yOffsets = generateAxisOffsets(pageH, tileSize, stride);
  const tiles: Array<{ tileIndex: number; x: number; y: number; width: number; height: number }> = [];
  let tileIndex = 0;
  for (let r = 0; r < yOffsets.length; r++) {
    for (let c = 0; c < xOffsets.length; c++) {
      tiles.push({ tileIndex, x: xOffsets[c], y: yOffsets[r], width: tileSize, height: tileSize });
      tileIndex++;
    }
  }
  return { tileSize, stride, scaleFactor: YOLO_V203_INPUT_SIZE / tileSize, tiles };
}

async function extractTileTensor(
  fullRgb: Uint8Array,
  pageW: number,
  pageH: number,
  tile: { x: number; y: number; width: number; height: number },
): Promise<Float32Array> {
  const onnxSize = YOLO_V203_INPUT_SIZE;
  const validW = Math.max(0, Math.min(tile.width, pageW - tile.x));
  const validH = Math.max(0, Math.min(tile.height, pageH - tile.y));

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
        tensor[dstIdx] = fullRgb[srcPixel] / 255.0;
        tensor[planeSize + dstIdx] = fullRgb[srcPixel + 1] / 255.0;
        tensor[2 * planeSize + dstIdx] = fullRgb[srcPixel + 2] / 255.0;
      }
    }
    return tensor;
  }

  const extractW = Math.min(tile.width, pageW - tile.x);
  const extractH = Math.min(tile.height, pageH - tile.y);

  const tileRgb = await sharp(Buffer.from(fullRgb), {
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
  return tensor;
}

async function inferTile(session: ort.InferenceSession, tensor: Float32Array) {
  const inputName = session.inputNames[0] || 'images';
  const outputName = session.outputNames[0] || 'output0';
  const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, YOLO_V203_INPUT_SIZE, YOLO_V203_INPUT_SIZE]) };
  const results = await session.run(feeds);
  const rawOutput = results[outputName].data as Float32Array;

  const candidates: Array<{ anchor: number; rawClassId: number; score: number; bbox: [number, number, number, number] }> = [];
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

    if (bestScore >= 0.50) {
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

function applyNms(candidates: any[], nmsIou = 0.70) {
  candidates.sort((a, b) => b.score - a.score || a.anchor - b.anchor);
  const kept: any[] = [];
  const classes = Array.from(new Set(candidates.map((c: any) => c.rawClassId))).sort((a: any, b: any) => a - b);
  for (const cls of classes) {
    const clsCands = candidates.filter((c: any) => c.rawClassId === cls);
    const suppressed = new Array<boolean>(clsCands.length).fill(false);
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
  return kept;
}

function mapToPage(
  tileCandidates: any[],
  tile: { tileIndex: number; x: number; y: number; width: number; height: number },
  scaleFactor: number,
  pageW: number,
  pageH: number,
  prefix: string,
): DetectionItem[] {
  const mapped: DetectionItem[] = [];
  for (let i = 0; i < tileCandidates.length; i++) {
    const cand = tileCandidates[i];
    const tileX1 = cand.bbox[0] / scaleFactor;
    const tileY1 = cand.bbox[1] / scaleFactor;
    const tileX2 = cand.bbox[2] / scaleFactor;
    const tileY2 = cand.bbox[3] / scaleFactor;

    const validW = Math.min(tile.width, pageW - tile.x);
    const validH = Math.min(tile.height, pageH - tile.y);
    if (tileX1 >= validW || tileY1 >= validH) continue;

    const clampedX1 = Math.max(0, Math.min(validW, tileX1));
    const clampedY1 = Math.max(0, Math.min(validH, tileY1));
    const clampedX2 = Math.max(0, Math.min(validW, tileX2));
    const clampedY2 = Math.max(0, Math.min(validH, tileY2));
    if (clampedX2 - clampedX1 < 1 || clampedY2 - clampedY1 < 1) continue;

    const pageX1 = Math.max(0, Math.min(pageW, clampedX1 + tile.x));
    const pageY1 = Math.max(0, Math.min(pageH, clampedY1 + tile.y));
    const pageX2 = Math.max(0, Math.min(pageW, clampedX2 + tile.x));
    const pageY2 = Math.max(0, Math.min(pageH, clampedY2 + tile.y));
    if (pageX2 - pageX1 < 1 || pageY2 - pageY1 < 1) continue;

    mapped.push({
      id: `${prefix}-${String(mapped.length + 1).padStart(2, '0')}`,
      rawClassId: cand.rawClassId,
      rawLabel: resolveYoloV203Class(cand.rawClassId)?.yoloLabel || `class_${cand.rawClassId}`,
      confidence: cand.score,
      tileIndex: tile.tileIndex,
      box: { x1: pageX1, y1: pageY1, x2: pageX2, y2: pageY2 },
      category: 'added',
    });
  }
  return mapped;
}

function mergeGlobal(candidates: DetectionItem[], globalMergeIou = 0.50, classAware = true): DetectionItem[] {
  candidates.sort((a, b) => b.confidence - a.confidence);
  const suppressed = new Array<boolean>(candidates.length).fill(false);
  const kept: DetectionItem[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (suppressed[i]) continue;
    const active = candidates[i];
    kept.push(active);

    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed[j]) continue;
      const neighbor = candidates[j];
      if (classAware && active.rawClassId !== neighbor.rawClassId) continue;

      const iou = computeIoU(active.box, neighbor.box);
      if (iou >= globalMergeIou) {
        suppressed[j] = true;
      }
    }
  }
  return kept;
}

// Differential comparison against baseline
function compareWithBaseline(
  comparisonDets: DetectionItem[],
  baselineDets: DetectionItem[],
  configPrefix: string,
): { evaluatedCandidates: DetectionItem[]; missedBaselineDets: DetectionItem[] } {
  const evaluated: DetectionItem[] = [];
  const baselineMatched = new Array<boolean>(baselineDets.length).fill(false);

  for (let i = 0; i < comparisonDets.length; i++) {
    const cand = comparisonDets[i];
    let bestMatchIdx = -1;
    let bestIoU = 0;

    for (let b = 0; b < baselineDets.length; b++) {
      const iou = computeIoU(cand.box, baselineDets[b].box);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestMatchIdx = b;
      }
    }

    if (bestIoU >= 0.40 && bestMatchIdx >= 0) {
      baselineMatched[bestMatchIdx] = true;
      const baseMatch = baselineDets[bestMatchIdx];
      const isSameClass = cand.rawClassId === baseMatch.rawClassId;
      const isShift = !isSameClass || bestIoU < 0.75;

      evaluated.push({
        ...cand,
        id: `${configPrefix}-${String(i + 1).padStart(2, '0')}`,
        category: isShift ? 'shift' : 'matched',
        matchedId: baseMatch.id,
        iou: parseFloat(bestIoU.toFixed(3)),
      });
    } else {
      evaluated.push({
        ...cand,
        id: `${configPrefix}-${String(i + 1).padStart(2, '0')}`,
        category: 'added',
        iou: bestIoU > 0 ? parseFloat(bestIoU.toFixed(3)) : 0,
      });
    }
  }

  // Baseline items not matched
  const missedBaselineDets: DetectionItem[] = [];
  for (let b = 0; b < baselineDets.length; b++) {
    if (!baselineMatched[b]) {
      missedBaselineDets.push({
        ...baselineDets[b],
        id: `REF-MISSED-${baselineDets[b].id}`,
        category: 'missed_baseline',
      });
    }
  }

  return { evaluatedCandidates: evaluated, missedBaselineDets };
}

// Generate high-resolution SVG overlay string
function buildFullPageSvg(
  pageW: number,
  pageH: number,
  title: string,
  candidates: DetectionItem[],
  missedBaseline: DetectionItem[] = [],
  isBaselineOnly = false,
): string {
  const svgLines: string[] = [
    `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
    `<style>
      .bbox-matched { stroke: #00cc44; stroke-width: 1.8; fill: rgba(0, 204, 68, 0.08); }
      .bbox-added   { stroke: #0088ff; stroke-width: 1.8; fill: rgba(0, 136, 255, 0.08); }
      .bbox-shift   { stroke: #ff9900; stroke-width: 1.8; fill: rgba(255, 153, 0, 0.08); }
      .bbox-missed  { stroke: #ff3333; stroke-width: 1.8; stroke-dasharray: 6,4; fill: rgba(255, 51, 51, 0.04); }
      .bbox-base    { stroke: #0077ff; stroke-width: 1.8; fill: rgba(0, 119, 255, 0.08); }

      .lbl-bg { fill: rgba(15, 23, 42, 0.88); rx: 3; ry: 3; }
      .lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 11px; font-weight: bold; }

      .legend-card { fill: rgba(15, 23, 42, 0.92); stroke: rgba(255, 255, 255, 0.15); stroke-width: 1.5; rx: 6; ry: 6; }
      .leg-title { fill: #ffffff; font-family: sans-serif; font-size: 14px; font-weight: bold; }
      .leg-text { fill: #e2e8f0; font-family: sans-serif; font-size: 12px; }
    </style>`,
  ];

  // 1. Render Missed Baseline reference boxes (dashed red) underneath
  for (const m of missedBaseline) {
    const x1 = Math.round(m.box.x1);
    const y1 = Math.round(m.box.y1);
    const w = Math.max(1, Math.round(m.box.x2 - m.box.x1));
    const h = Math.max(1, Math.round(m.box.y2 - m.box.y1));

    svgLines.push(`<rect class="bbox-missed" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);

    const labelText = `[REF Hilang] ${m.id} ${m.rawLabel}`;
    const lblW = Math.round(labelText.length * 6.8 + 8);
    const lblX = Math.max(4, Math.min(pageW - lblW - 4, x1));
    const lblY = Math.max(4, Math.min(pageH - 20, y1 - 16));

    svgLines.push(
      `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="15" />`,
      `<text class="lbl-txt" x="${lblX + 4}" y="${lblY + 11}" fill="#ff6666">${escapeXml(labelText)}</text>`,
    );
  }

  // 2. Render Active Candidates
  for (const c of candidates) {
    const x1 = Math.round(c.box.x1);
    const y1 = Math.round(c.box.y1);
    const w = Math.max(1, Math.round(c.box.x2 - c.box.x1));
    const h = Math.max(1, Math.round(c.box.y2 - c.box.y1));

    let cls = 'bbox-base';
    let textColor = '#00ffcc';

    if (!isBaselineOnly) {
      if (c.category === 'matched') {
        cls = 'bbox-matched';
        textColor = '#66ff99';
      } else if (c.category === 'added') {
        cls = 'bbox-added';
        textColor = '#88ccff';
      } else if (c.category === 'shift') {
        cls = 'bbox-shift';
        textColor = '#ffcc66';
      }
    }

    svgLines.push(`<rect class="${cls}" x="${x1}" y="${y1}" width="${w}" height="${h}" />`);

    const shortId = c.id;
    const labelText = `${shortId} ${c.rawLabel} ${(c.confidence * 100).toFixed(0)}%`;
    const lblW = Math.round(labelText.length * 6.8 + 10);
    const lblX = Math.max(4, Math.min(pageW - lblW - 4, x1));
    const lblY = Math.max(4, Math.min(pageH - 20, y1 - 16));

    svgLines.push(
      `<rect class="lbl-bg" x="${lblX}" y="${lblY}" width="${lblW}" height="15" />`,
      `<text class="lbl-txt" x="${lblX + 4}" y="${lblY + 11}" fill="${textColor}">${escapeXml(labelText)}</text>`,
    );
  }

  // 3. Embedded Legend Card (Top-Left or Top-Right)
  const legW = 380;
  const legH = isBaselineOnly ? 75 : 145;
  const legX = 20;
  const legY = 20;

  svgLines.push(
    `<rect class="legend-card" x="${legX}" y="${legY}" width="${legW}" height="${legH}" />`,
    `<text class="leg-title" x="${legX + 16}" y="${legY + 24}">${escapeXml(title)}</text>`,
  );

  if (isBaselineOnly) {
    svgLines.push(
      `<rect x="${legX + 16}" y="${legY + 40}" width="16" height="12" fill="#0077ff" rx="2" />`,
      `<text class="leg-text" x="${legX + 40}" y="${legY + 50}">Baseline Detections (${candidates.length} kandidat)</text>`,
    );
  } else {
    const matchedCount = candidates.filter((c) => c.category === 'matched').length;
    const addedCount = candidates.filter((c) => c.category === 'added').length;
    const shiftCount = candidates.filter((c) => c.category === 'shift').length;
    const missedCount = missedBaseline.length;

    svgLines.push(
      `<rect x="${legX + 16}" y="${legY + 40}" width="16" height="12" fill="#00cc44" rx="2" />`,
      `<text class="leg-text" x="${legX + 40}" y="${legY + 50}">Hijau: Matched dengan Baseline (${matchedCount})</text>`,

      `<rect x="${legX + 16}" y="${legY + 62}" width="16" height="12" fill="#0088ff" rx="2" />`,
      `<text class="leg-text" x="${legX + 40}" y="${legY + 72}">Biru: Kandidat Tambahan (${addedCount})</text>`,

      `<rect x="${legX + 16}" y="${legY + 84}" width="16" height="12" fill="#ff9900" rx="2" />`,
      `<text class="leg-text" x="${legX + 40}" y="${legY + 94}">Oranye: Perubahan Kelas / BBox Shift (${shiftCount})</text>`,

      `<line x1="${legX + 16}" y1="${legY + 112}" x2="${legX + 32}" y2="${legY + 112}" stroke="#ff3333" stroke-width="2" stroke-dasharray="4,3" />`,
      `<text class="leg-text" x="${legX + 40}" y="${legY + 116}">Merah Putus-putus: Baseline Tidak Matched (${missedCount})</text>`,

      `<text class="leg-text" x="${legX + 16}" y="${legY + 136}" font-size="10" fill="#94a3b8">*Warna adalah kategori komparasi, bukan status kebenaran.</text>`,
    );
  }

  svgLines.push('</svg>');
  return svgLines.join('\n');
}

// Generate complete offline HTML viewer
function buildOfflineHtml(
  pageW: number,
  pageH: number,
  baselineDets: DetectionItem[],
  geo4Dets: DetectionItem[],
  geo1Dets: DetectionItem[],
  geo2Dets: DetectionItem[],
  geo4Missed: DetectionItem[],
  geo1Missed: DetectionItem[],
  geo2Missed: DetectionItem[],
): string {
  const payloadJson = JSON.stringify({
    pageWidth: pageW,
    pageHeight: pageH,
    configs: {
      baseline: {
        title: 'Baseline (Tile 1024, Overlap 20%)',
        count: baselineDets.length,
        overlayFile: '01_baseline_overlay.png',
        items: baselineDets,
        missedBaseline: [],
      },
      geo4: {
        title: 'GEO-4 Overlap35 (Tile 1024, Overlap 35%)',
        count: geo4Dets.length,
        overlayFile: '02_geo4_overlap35_overlay.png',
        items: geo4Dets,
        missedBaseline: geo4Missed,
      },
      geo1: {
        title: 'GEO-1 Tile768 (Tile 768, Zoom 1.33x)',
        count: geo1Dets.length,
        overlayFile: '03_geo1_tile768_overlay.png',
        items: geo1Dets,
        missedBaseline: geo1Missed,
      },
      geo2: {
        title: 'GEO-2 Tile1280 (Tile 1280, Zoom 0.8x)',
        count: geo2Dets.length,
        overlayFile: '04_geo2_tile1280_overlay.png',
        items: geo2Dets,
        missedBaseline: geo2Missed,
      },
    },
  });

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>P&ID Asset Detection — Full-Page Tuning Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

    /* Top Toolbar */
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; z-index: 20; }
    .header-left { display: flex; align-items: center; gap: 15px; }
    .logo-badge { font-weight: bold; font-size: 14px; background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; letter-spacing: 0.5px; }
    .page-title { font-size: 15px; font-weight: 600; color: #e2e8f0; }

    .ctrl-group { display: flex; align-items: center; gap: 8px; background: #0f172a; padding: 4px 10px; border-radius: 6px; border: 1px solid #334155; }
    .ctrl-label { font-size: 12px; color: #94a3b8; font-weight: 500; }
    select, button { background: #1e293b; color: #f8fafc; border: 1px solid #475569; padding: 5px 10px; border-radius: 4px; font-size: 12px; cursor: pointer; outline: none; }
    select:hover, button:hover { background: #334155; }

    /* Main Area */
    .workspace { display: flex; flex: 1; height: calc(100vh - 54px); overflow: hidden; position: relative; }
    
    /* Viewport Pan/Zoom Container */
    .viewport { flex: 1; background: #020617; overflow: hidden; position: relative; cursor: grab; user-select: none; }
    .viewport:active { cursor: grabbing; }

    .canvas-stage { position: absolute; transform-origin: 0 0; will-change: transform; }
    .canvas-stage img { display: block; width: ${pageW}px; height: ${pageH}px; pointer-events: none; }

    /* Floating Legend */
    .legend-panel { position: absolute; bottom: 20px; left: 20px; background: rgba(15, 23, 42, 0.94); border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; font-size: 12px; z-index: 10; pointer-events: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 280px; }
    .leg-head { font-weight: 700; margin-bottom: 8px; font-size: 13px; color: #f1f5f9; display: flex; justify-content: space-between; }
    .leg-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer; user-select: none; }
    .leg-color { width: 14px; height: 14px; border-radius: 3px; display: inline-block; flex-shrink: 0; }
    .leg-check { margin-left: auto; }
    .leg-note { font-size: 10px; color: #94a3b8; margin-top: 8px; line-height: 1.3; border-top: 1px solid #334155; padding-top: 6px; }

    /* Sidebar List */
    .sidebar { width: 340px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; z-index: 15; }
    .sidebar-head { padding: 12px 16px; border-bottom: 1px solid #334155; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
    .item-counter { background: #3b82f6; font-size: 11px; padding: 2px 6px; border-radius: 10px; }
    .candidate-list { flex: 1; overflow-y: auto; padding: 8px; }
    .cand-card { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s ease; border-left: 4px solid #3b82f6; }
    .cand-card:hover { background: #1e293b; border-color: #64748b; }
    .cand-card.active { background: #1e3a5f; border-color: #38bdf8; }
    .card-top { display: flex; justify-content: space-between; margin-bottom: 4px; font-weight: 600; }
    .card-label { font-family: monospace; color: #38bdf8; font-size: 11px; word-break: break-all; }
    .card-coords { color: #64748b; font-size: 10px; font-family: monospace; }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <span class="logo-badge">YOLO v203</span>
      <span class="page-title">P&ID Tuning Review (sheet-1-p1 &bull; 3573&times;2526 px)</span>
    </div>

    <div style="display: flex; gap: 10px; align-items: center;">
      <div class="ctrl-group">
        <span class="ctrl-label">Konfigurasi:</span>
        <select id="configSelect">
          <option value="baseline">1. Baseline (60)</option>
          <option value="geo4" selected>2. GEO-4 Overlap35 (70)</option>
          <option value="geo1">3. GEO-1 Tile768 (87)</option>
          <option value="geo2">4. GEO-2 Tile1280 (87)</option>
          <option value="original">0. Clean Original (Tanpa BBox)</option>
        </select>
      </div>

      <div class="ctrl-group">
        <span class="ctrl-label">Zoom:</span>
        <button id="btnZoomOut">&minus;</button>
        <span id="zoomLabel" style="font-size: 11px; width: 42px; text-align: center;">100%</span>
        <button id="btnZoomIn">&plus;</button>
        <button id="btnZoomFit">Fit</button>
        <button id="btnZoom100">100%</button>
      </div>
    </div>
  </header>

  <div class="workspace">
    <!-- Viewport -->
    <div class="viewport" id="viewport">
      <div class="canvas-stage" id="stage">
        <img id="mainImage" src="02_geo4_overlap35_overlay.png" alt="P&ID Sheet 1" />
      </div>

      <!-- Floating Legend -->
      <div class="legend-panel">
        <div class="leg-head">
          <span>Legenda Komparasi</span>
        </div>
        <div class="leg-item">
          <span class="leg-color" style="background: #00cc44;"></span>
          <span>Matched Baseline</span>
          <span class="item-counter" id="cntMatched" style="background:#059669;">0</span>
        </div>
        <div class="leg-item">
          <span class="leg-color" style="background: #0088ff;"></span>
          <span>Kandidat Tambahan</span>
          <span class="item-counter" id="cntAdded" style="background:#2563eb;">0</span>
        </div>
        <div class="leg-item">
          <span class="leg-color" style="background: #ff9900;"></span>
          <span>Shift Kelas / BBox</span>
          <span class="item-counter" id="cntShift" style="background:#d97706;">0</span>
        </div>
        <div class="leg-item">
          <span class="leg-color" style="background: #ff3333; border: 1px dashed white;"></span>
          <span>Baseline Tidak Matched</span>
          <span class="item-counter" id="cntMissed" style="background:#dc2626;">0</span>
        </div>
        <div class="leg-note">
          Warna menunjukkan kategori perbandingan terhadap baseline. Bukan status benar/salah.
        </div>
      </div>
    </div>

    <!-- Sidebar List -->
    <div class="sidebar">
      <div class="sidebar-head">
        <span id="listTitle">Daftar Kandidat</span>
        <span class="item-counter" id="totalCandidatesCount">0</span>
      </div>
      <div class="candidate-list" id="candidateList"></div>
    </div>
  </div>

  <script>
    const data = ${payloadJson};
    const stage = document.getElementById('stage');
    const viewport = document.getElementById('viewport');
    const mainImg = document.getElementById('mainImage');
    const configSelect = document.getElementById('configSelect');
    const zoomLabel = document.getElementById('zoomLabel');
    const candidateList = document.getElementById('candidateList');

    let scale = 0.35;
    let panX = 40;
    let panY = 20;
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

    // Drag / Pan
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

    // Wheel Zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = e.deltaY > 0 ? 0.85 : 1.15;
      const newScale = Math.max(0.1, Math.min(3.0, scale * delta));

      panX = mouseX - (mouseX - panX) * (newScale / scale);
      panY = mouseY - (mouseY - panY) * (newScale / scale);
      scale = newScale;
      applyTransform();
    }, { passive: false });

    document.getElementById('btnZoomIn').onclick = () => { scale = Math.min(3.0, scale * 1.25); applyTransform(); };
    document.getElementById('btnZoomOut').onclick = () => { scale = Math.max(0.1, scale * 0.8); applyTransform(); };
    document.getElementById('btnZoomFit').onclick = fitToScreen;
    document.getElementById('btnZoom100').onclick = () => { scale = 1.0; applyTransform(); };

    function renderConfig(cfgKey) {
      if (cfgKey === 'original') {
        mainImg.src = 'sheet-1-p1_original.png';
        candidateList.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;">Gambar P&ID original tanpa overlay bounding box.</div>';
        document.getElementById('totalCandidatesCount').textContent = '0';
        document.getElementById('cntMatched').textContent = '0';
        document.getElementById('cntAdded').textContent = '0';
        document.getElementById('cntShift').textContent = '0';
        document.getElementById('cntMissed').textContent = '0';
        return;
      }

      const cfg = data.configs[cfgKey];
      mainImg.src = cfg.overlayFile;
      document.getElementById('listTitle').textContent = cfg.title;

      const allItems = [...cfg.items, ...(cfg.missedBaseline || [])];
      document.getElementById('totalCandidatesCount').textContent = allItems.length;

      const mCnt = cfg.items.filter(x => x.category === 'matched').length;
      const aCnt = cfg.items.filter(x => x.category === 'added').length;
      const sCnt = cfg.items.filter(x => x.category === 'shift').length;
      const missCnt = (cfg.missedBaseline || []).length;

      document.getElementById('cntMatched').textContent = mCnt;
      document.getElementById('cntAdded').textContent = aCnt;
      document.getElementById('cntShift').textContent = sCnt;
      document.getElementById('cntMissed').textContent = missCnt;

      // Populate list
      candidateList.innerHTML = '';
      allItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'cand-card';
        
        let color = '#3b82f6';
        if (item.category === 'matched') color = '#00cc44';
        else if (item.category === 'added') color = '#0088ff';
        else if (item.category === 'shift') color = '#ff9900';
        else if (item.category === 'missed_baseline') color = '#ff3333';
        card.style.borderLeftColor = color;

        card.innerHTML = \`
          <div class="card-top">
            <span>\${item.id}</span>
            <span style="color:\${color}; font-size:11px;">\${Math.round(item.confidence * 100)}%</span>
          </div>
          <div class="card-label">\${item.rawLabel}</div>
          <div class="card-coords">X: \${Math.round(item.box.x1)}..\${Math.round(item.box.x2)} | Y: \${Math.round(item.box.y1)}..\${Math.round(item.box.y2)}</div>
        \`;

        card.onclick = () => {
          document.querySelectorAll('.cand-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          // Focus view on box
          const cx = (item.box.x1 + item.box.x2) / 2;
          const cy = (item.box.y1 + item.box.y2) / 2;
          scale = 1.2;
          panX = (viewport.clientWidth / 2) - (cx * scale);
          panY = (viewport.clientHeight / 2) - (cy * scale);
          applyTransform();
        };

        candidateList.appendChild(card);
      });
    }

    configSelect.onchange = (e) => renderConfig(e.target.value);

    // Initial load
    window.onload = () => {
      fitToScreen();
      renderConfig('geo4');
    };
  </script>
</body>
</html>`;
}

export async function runBuildFullPageReview() {
  console.log('=== Building Exclusive Full-Page Review Package ===\n');

  // Strict check: if target directory exists, stop immediately
  if (fs.existsSync(FULL_PAGE_DIR)) {
    throw new Error(`Target directory already exists: ${FULL_PAGE_DIR}. Refusing to overwrite.`);
  }

  fs.mkdirSync(FULL_PAGE_DIR, { recursive: true });
  console.log(`[1/5] Created exclusive output directory: ${FULL_PAGE_DIR}`);

  // Copy original unresized source image (3573x2526)
  const originalCopyPath = path.join(FULL_PAGE_DIR, 'sheet-1-p1_original.png');
  fs.copyFileSync(SOURCE_IMAGE_PATH, originalCopyPath);
  console.log(`[2/5] Preserved original 3573x2526 image at: ${originalCopyPath}`);

  const imageBuffer = fs.readFileSync(SOURCE_IMAGE_PATH);
  const imgMeta = await sharp(imageBuffer).metadata();
  const pageW = imgMeta.width!;
  const pageH = imgMeta.height!;

  const sharpDecoded = await sharp(imageBuffer)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pageRgb = sharpDecoded.data;

  // 1. Load Baseline Detections (60)
  console.log('[3/5] Loading verified baseline detections...');
  const baselineData = JSON.parse(fs.readFileSync(BASELINE_JSON_PATH, 'utf8'));
  const sheet1Baseline = baselineData.pages.find((p: any) => p.pageId === 'sheet-1-p1');
  const baselineDets: DetectionItem[] = sheet1Baseline.retainedDetections.map((d: any, idx: number) => ({
    id: `B-${String(idx + 1).padStart(2, '0')}`,
    rawClassId: d.rawClassId,
    rawLabel: d.rawLabel,
    confidence: d.confidence,
    tileIndex: d.tileIndex,
    box: { ...d.pageBox },
    category: 'baseline_only',
  }));
  console.log(`  Baseline sheet-1-p1 count: ${baselineDets.length}`);

  // 2. Load alternative configurations using deterministic local inference
  console.log('[4/5] Computing geometry candidates in source coordinates...');
  const session = await getYoloV203Session(MODEL_PATH);

  async function getDetections(cfg: { id: string; tileSize: number; stride: number }) {
    const grid = buildGrid(pageW, pageH, cfg.tileSize, cfg.stride);
    const allDets: DetectionItem[] = [];
    for (const tile of grid.tiles) {
      const tensor = await extractTileTensor(pageRgb, pageW, pageH, tile);
      const cands = await inferTile(session, tensor);
      const nmsKept = applyNms(cands, 0.70);
      const pageCands = mapToPage(nmsKept, tile, grid.scaleFactor, pageW, pageH, cfg.id);
      allDets.push(...pageCands);
    }
    return mergeGlobal(allDets, 0.50, true);
  }

  const rawGeo4 = await getDetections({ id: 'G4', tileSize: 1024, stride: 665 });
  const rawGeo1 = await getDetections({ id: 'G1', tileSize: 768, stride: 614 });
  const rawGeo2 = await getDetections({ id: 'G2', tileSize: 1280, stride: 1024 });

  console.log(`  Raw GEO-4: ${rawGeo4.length} | GEO-1: ${rawGeo1.length} | GEO-2: ${rawGeo2.length}`);

  // 3. Differential matching against Baseline
  const geo4Diff = compareWithBaseline(rawGeo4, baselineDets, 'G4');
  const geo1Diff = compareWithBaseline(rawGeo1, baselineDets, 'G1');
  const geo2Diff = compareWithBaseline(rawGeo2, baselineDets, 'G2');

  // 4. Render 4 Full-Page PNG Overlays (Exact 3573x2526 Resolution)
  console.log('[5/5] Compositing 4 high-resolution full-page PNG overlays...');

  // Overlay 1: Baseline (60 kandidat)
  const svgBase = buildFullPageSvg(pageW, pageH, 'Baseline (Tile 1024, Overlap 20%)', baselineDets, [], true);
  const outBasePng = path.join(FULL_PAGE_DIR, '01_baseline_overlay.png');
  await sharp(imageBuffer).composite([{ input: Buffer.from(svgBase) }]).png().toFile(outBasePng);

  // Overlay 2: GEO-4 Overlap35 (70 kandidat + missed baseline)
  const svgGeo4 = buildFullPageSvg(pageW, pageH, 'GEO-4 Overlap35 (Tile 1024, Overlap 35%)', geo4Diff.evaluatedCandidates, geo4Diff.missedBaselineDets);
  const outGeo4Png = path.join(FULL_PAGE_DIR, '02_geo4_overlap35_overlay.png');
  await sharp(imageBuffer).composite([{ input: Buffer.from(svgGeo4) }]).png().toFile(outGeo4Png);

  // Overlay 3: GEO-1 Tile768 (87 kandidat + missed baseline)
  const svgGeo1 = buildFullPageSvg(pageW, pageH, 'GEO-1 Tile768 (Tile 768, Zoom 1.33x)', geo1Diff.evaluatedCandidates, geo1Diff.missedBaselineDets);
  const outGeo1Png = path.join(FULL_PAGE_DIR, '03_geo1_tile768_overlay.png');
  await sharp(imageBuffer).composite([{ input: Buffer.from(svgGeo1) }]).png().toFile(outGeo1Png);

  // Overlay 4: GEO-2 Tile1280 (87 kandidat + missed baseline)
  const svgGeo2 = buildFullPageSvg(pageW, pageH, 'GEO-2 Tile1280 (Tile 1280, Zoom 0.8x)', geo2Diff.evaluatedCandidates, geo2Diff.missedBaselineDets);
  const outGeo2Png = path.join(FULL_PAGE_DIR, '04_geo2_tile1280_overlay.png');
  await sharp(imageBuffer).composite([{ input: Buffer.from(svgGeo2) }]).png().toFile(outGeo2Png);

  // 5. Generate Offline HTML Viewer
  const htmlContent = buildOfflineHtml(
    pageW,
    pageH,
    baselineDets,
    geo4Diff.evaluatedCandidates,
    geo1Diff.evaluatedCandidates,
    geo2Diff.evaluatedCandidates,
    geo4Diff.missedBaselineDets,
    geo1Diff.missedBaselineDets,
    geo2Diff.missedBaselineDets,
  );
  const htmlPath = path.join(FULL_PAGE_DIR, 'index.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  // 6. Generate Manifest Metadata JSON
  const manifestData = {
    schemaVersion: 'full-page-review-v1',
    generatedAt: new Date().toISOString(),
    sourceImage: {
      path: 'fixtures/pid-eval/sheet-1/page_1.png',
      width: pageW,
      height: pageH,
    },
    colorLegend: {
      green: { hex: '#00cc44', label: 'Matched dengan Baseline' },
      blue: { hex: '#0088ff', label: 'Kandidat Tambahan' },
      orange: { hex: '#ff9900', label: 'Perubahan Kelas / BBox Shift' },
      dashedRed: { hex: '#ff3333', label: 'Baseline Tidak Matched (Referensi)' },
    },
    overlays: [
      { id: 'baseline', file: '01_baseline_overlay.png', count: baselineDets.length },
      { id: 'geo4', file: '02_geo4_overlap35_overlay.png', count: geo4Diff.evaluatedCandidates.length, missedBaseline: geo4Diff.missedBaselineDets.length },
      { id: 'geo1', file: '03_geo1_tile768_overlay.png', count: geo1Diff.evaluatedCandidates.length, missedBaseline: geo1Diff.missedBaselineDets.length },
      { id: 'geo2', file: '04_geo2_tile1280_overlay.png', count: geo2Diff.evaluatedCandidates.length, missedBaseline: geo2Diff.missedBaselineDets.length },
    ],
    htmlViewer: 'index.html',
  };
  fs.writeFileSync(path.join(FULL_PAGE_DIR, 'full-page-manifest.json'), JSON.stringify(manifestData, null, 2), 'utf8');

  console.log('\n[SUCCESS] Full-page review package successfully generated:');
  console.log(`  1. ${outBasePng}`);
  console.log(`  2. ${outGeo4Png}`);
  console.log(`  3. ${outGeo1Png}`);
  console.log(`  4. ${outGeo2Png}`);
  console.log(`  HTML: ${htmlPath}`);
}

if (require.main === module || process.argv[1] === __filename) {
  runBuildFullPageReview().catch((err) => {
    console.error('Error generating full-page package:', err);
    process.exit(1);
  });
}
