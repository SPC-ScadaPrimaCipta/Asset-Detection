/**
 * Gemini Gap Filler — kirim Gemini hanya ke area yang CV deterministic tidak confident.
 *
 * Pipeline:
 *   1. Terima deteksi CV (deterministic-page.ts)
 *   2. Klasifikasikan: HIGH_CONF (terima), LOW_CONF (verifikasi), UNKNOWN (full Gemini)
 *   3. Kirim Gemini hanya untuk area gap (bukan full scan)
 *   4. Fuse hasil: CV + Gemini, prefer confidence lebih tinggi
 *
 * Contract:
 *   - CV offline → caller pakai full Gemini (tidak lewat sini)
 *   - Semua threshold dari detectionConfig (dikonfigurasi via env, bukan hard-code)
 *   - Tidak mutate input CV detections — return array baru
 */

import { detectionConfig } from '@/lib/detection/config';
import { runDetectionAgent } from '@/lib/ai-agent';
import { buildGapFillerPrompt } from '@/lib/ai-prompt';
import type { LegendSymbol } from '@/lib/rule-validator';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CvDetection {
  candidateId?: string;
  assetTag: string | null;
  assetType: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  evidence: string[];
  legendSymbol: string | null;
  detection_source: string;
  /** 'UNKNOWN' means CV could not match to any legend entry */
  isUnknown?: boolean;
}

export interface GapFillerInput {
  page: number;
  pageImageBase64: string;
  pngWidth: number;
  pngHeight: number;
  legendId: string;
  legendSymbols: LegendSymbol[];
  cvDetections: CvDetection[];
  ocrText?: string;
  projectId?: string | null;
  drawingType?: string | null;
}

export interface FusedDetection extends CvDetection {
  fusion_source: 'CV_HIGH' | 'CV_VERIFIED' | 'GEMINI_FILL' | 'GEMINI_CONFLICT';
  gemini_confidence?: number;
  cv_confidence?: number;
}

// ─── Klasifikasi gap ─────────────────────────────────────────────────────────

interface GapClassification {
  accepted: CvDetection[];      // confidence >= HIGH → terima langsung
  needsVerify: CvDetection[];   // LOW <= confidence < HIGH → verifikasi Gemini
  unknown: CvDetection[];       // assetType === 'UNKNOWN' atau confidence < LOW
}

function classifyGaps(
  detections: CvDetection[],
  highThreshold: number,
  lowThreshold: number
): GapClassification {
  const accepted: CvDetection[] = [];
  const needsVerify: CvDetection[] = [];
  const unknown: CvDetection[] = [];

  for (const d of detections) {
    if (d.isUnknown || d.assetType === 'UNKNOWN') {
      unknown.push(d);
    } else if (d.confidence >= highThreshold) {
      accepted.push(d);
    } else if (d.confidence >= lowThreshold) {
      needsVerify.push(d);
    } else {
      unknown.push(d);
    }
  }

  return { accepted, needsVerify, unknown };
}

// ─── Overlap detection (IoU) ─────────────────────────────────────────────────

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter === 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return inter / (aArea + bArea - inter);
}

/** Cek apakah Gemini detection overlap signifikan dengan CV detection yang sudah ada */
function overlapsWithCv(
  geminiBox: { x: number; y: number; width: number; height: number },
  cvDetections: CvDetection[],
  iouThreshold = 0.4
): CvDetection | null {
  for (const cv of cvDetections) {
    if (iou(geminiBox, cv.bbox) >= iouThreshold) return cv;
  }
  return null;
}

// ─── Fusion logic ─────────────────────────────────────────────────────────────

function fuseDetections(
  cvAccepted: CvDetection[],
  cvNeedsVerify: CvDetection[],
  cvUnknown: CvDetection[],
  geminiResults: Awaited<ReturnType<typeof runDetectionAgent>>['detections'],
  highThreshold: number
): FusedDetection[] {
  const fused: FusedDetection[] = [];

  // 1. CV HIGH confidence → terima langsung
  for (const d of cvAccepted) {
    fused.push({ ...d, fusion_source: 'CV_HIGH', cv_confidence: d.confidence });
  }

  // 2. CV NEEDS_VERIFY → cari Gemini yang overlap, ambil mana yang lebih tinggi
  for (const cv of cvNeedsVerify) {
    const geminiMatch = geminiResults.find(g => iou(g.bbox, cv.bbox) >= 0.4);

    if (geminiMatch && geminiMatch.confidence > cv.confidence) {
      // Gemini lebih yakin — pakai Gemini tapi catat cv sebagai backing
      fused.push({
        assetTag: geminiMatch.assetTag ?? cv.assetTag,
        assetType: geminiMatch.assetType,
        confidence: geminiMatch.confidence,
        bbox: geminiMatch.bbox,
        evidence: [
          ...geminiMatch.evidence,
          `CV backing: score=${cv.confidence.toFixed(3)} (${cv.assetType})`,
        ],
        legendSymbol: geminiMatch.legendSymbol ?? cv.legendSymbol,
        detection_source: 'HYBRID',
        fusion_source: 'CV_VERIFIED',
        gemini_confidence: geminiMatch.confidence,
        cv_confidence: cv.confidence,
      });
    } else if (cv.confidence >= (highThreshold - 0.1)) {
      // CV cukup yakin, Gemini tidak overlap atau lebih rendah
      fused.push({ ...cv, fusion_source: 'CV_VERIFIED', cv_confidence: cv.confidence });
    } else {
      // Ambil keduanya tapi flag needs_review
      fused.push({
        ...cv,
        confidence: Math.max(cv.confidence, geminiMatch?.confidence ?? 0),
        fusion_source: 'CV_VERIFIED',
        cv_confidence: cv.confidence,
        evidence: [
          ...cv.evidence,
          geminiMatch
            ? `Gemini partial match: ${geminiMatch.assetType} conf=${geminiMatch.confidence.toFixed(3)}`
            : 'Gemini no overlap — CV only',
        ],
      });
    }
  }

  // 3. UNKNOWN CV → coba isi dari Gemini
  for (const cv of cvUnknown) {
    const geminiMatch = geminiResults.find(g => iou(g.bbox, cv.bbox) >= 0.35);
    if (geminiMatch) {
      fused.push({
        assetTag: geminiMatch.assetTag ?? cv.assetTag,
        assetType: geminiMatch.assetType,
        confidence: geminiMatch.confidence * 0.95, // slight penalty: unverified by CV
        bbox: geminiMatch.bbox,
        evidence: [
          ...geminiMatch.evidence,
          `CV candidate: UNKNOWN (visual candidate existed at bbox)`,
        ],
        legendSymbol: geminiMatch.legendSymbol,
        detection_source: 'HYBRID',
        fusion_source: 'GEMINI_FILL',
        gemini_confidence: geminiMatch.confidence,
        cv_confidence: cv.confidence,
      });
    }
    // jika tidak ada Gemini match untuk UNKNOWN → drop (noise)
  }

  // 4. Gemini NEW detections (tidak overlap dengan CV sama sekali)
  const allCv = [...cvAccepted, ...cvNeedsVerify, ...cvUnknown];
  for (const g of geminiResults) {
    const cvOverlap = overlapsWithCv(g.bbox, allCv, 0.3);
    if (!cvOverlap) {
      // Gemini temukan sesuatu yang CV missed — tambahkan tapi confidence dikurangi sedikit
      fused.push({
        assetTag: g.assetTag,
        assetType: g.assetType,
        confidence: g.confidence * 0.9, // penalty: tidak ada CV backing
        bbox: g.bbox,
        evidence: [...g.evidence, 'Gemini-only detection (no CV candidate)'],
        legendSymbol: g.legendSymbol ?? null,
        detection_source: 'GEMINI',
        fusion_source: 'GEMINI_FILL',
        gemini_confidence: g.confidence,
      });
    }
  }

  return fused;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function fillGapsWithGemini(
  input: GapFillerInput,
  log: (msg: string, extra?: Record<string, unknown>) => void = () => {}
): Promise<FusedDetection[]> {
  const { high, low } = detectionConfig.confidence;
  const maxCalls = detectionConfig.geminiBudget.maxCallsPerPage;

  const { accepted, needsVerify, unknown } = classifyGaps(input.cvDetections, high, low);

  log(`gap-filler page ${input.page}: cv_high=${accepted.length} verify=${needsVerify.length} unknown=${unknown.length}`, {
    page: input.page,
    high: accepted.length,
    verify: needsVerify.length,
    unknown: unknown.length,
  });

  // Jika tidak ada gap → return CV accepted langsung
  const gapCount = needsVerify.length + unknown.length;
  if (gapCount === 0 || input.cvDetections.length === 0) {
    log(`page ${input.page}: no gaps — CV only`, { page: input.page });
    return accepted.map(d => ({ ...d, fusion_source: 'CV_HIGH' as const, cv_confidence: d.confidence }));
  }

  // Budget guard: jangan kirim Gemini jika terlalu banyak (konfigurasi via env)
  if (gapCount > maxCalls * 3) {
    log(`page ${input.page}: gap count ${gapCount} exceeds budget ${maxCalls * 3} — full Gemini scan`, {
      page: input.page,
      gapCount,
      budget: maxCalls * 3,
    });
  }

  // Kirim ke Gemini dengan prompt gap-filler (focused, bukan full scan)
  let geminiResults: Awaited<ReturnType<typeof runDetectionAgent>>['detections'] = [];
  try {
    const result = await runDetectionAgent({
      page: input.page,
      pageImageBase64: input.pageImageBase64,
      legendId: input.legendId,
      legendSymbols: input.legendSymbols,
      ocrText: input.ocrText ?? '',
      pngWidth: input.pngWidth,
      pngHeight: input.pngHeight,
      projectId: input.projectId ?? null,
      drawingType: input.drawingType ?? null,
      // Gap filler context: hint ke Gemini tentang apa yang sudah diketahui
      gapFillerContext: {
        cvAcceptedCount: accepted.length,
        gapBboxes: [...needsVerify, ...unknown].map(d => d.bbox),
        focusOnGaps: true,
      },
    } as Parameters<typeof runDetectionAgent>[0]);
    geminiResults = result.detections;
    log(`page ${input.page}: gemini returned ${geminiResults.length} detections`, {
      page: input.page,
      geminiCount: geminiResults.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`page ${input.page}: gemini gap-filler failed (non-fatal) — using CV only: ${msg.slice(0, 200)}`, {
      page: input.page,
      error: msg.slice(0, 200),
    });
    // Fallback: CV only
    return [
      ...accepted.map(d => ({ ...d, fusion_source: 'CV_HIGH' as const, cv_confidence: d.confidence })),
      ...needsVerify.map(d => ({ ...d, fusion_source: 'CV_VERIFIED' as const, cv_confidence: d.confidence })),
    ];
  }

  return fuseDetections(accepted, needsVerify, unknown, geminiResults, high);
}

// ─── Helper: convert deterministic-page output to CvDetection[] ──────────────

export interface DetPageResult {
  assetTag: string | null;
  assetType: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  evidence: string[];
  legendSymbol: string | null;
  detection_source?: string;
}

export function toCvDetections(detections: DetPageResult[]): CvDetection[] {
  return detections.map(d => ({
    assetTag: d.assetTag,
    assetType: d.assetType,
    confidence: d.confidence,
    bbox: d.bbox,
    evidence: d.evidence,
    legendSymbol: d.legendSymbol,
    detection_source: d.detection_source ?? 'DETERMINISTIC',
    isUnknown: d.assetType === 'UNKNOWN',
  }));
}
