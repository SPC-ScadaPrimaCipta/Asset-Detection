/**
 * finalize-postverification.ts
 * Langkah 1: Reconcile verification, form post-verification candidates, compare vs YOLO.
 * Tidak ada API call, inference, atau perubahan produksi.
 * Output: comparison-postverification-result.json (exclusive guard)
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/pilot-sheet-1-p1-v3');
const VERIFICATION_PATH = path.join(OUTPUT_DIR, 'verification-api-attempt-4.json');
const YOLO_PATH = path.join(REPO_ROOT, 'fixtures/diagnostics/predictions-v203-baseline.json');
const COMPARISON_OUTPUT = path.join(OUTPUT_DIR, 'comparison-postverification-result.json');

interface Verification {
  candidateId: string;
  verdict: 'CONFIRMED' | 'CORRECTED' | 'REJECTED' | 'UNCERTAIN';
  assetTypeVerified: string | null;
  assetTagVerified: string | null;
  confidence: number;
  evidence: string[];
  correctedAssetType: string | null;
  correctedAssetTag: string | null;
  note: string;
}

interface PostVerificationCandidate {
  candidateId: string;
  assetType: string;
  assetTag: string | null;
  confidence: number;
  convertedBbox: { x1: number; y1: number; x2: number; y2: number };
  bboxAreaPx: number;
  verification: {
    verdict: string;
    evidence: string[];
    changedAssetType: boolean;
    changedAssetTag: boolean;
    correctedTo?: { assetType?: string; assetTag?: string };
  };
}

interface YoloDetection {
  predictionId: string;
  rawLabel: string;
  confidence: number;
  pageBox: { x1: number; y1: number; x2: number; y2: number };
}

function iou(ax1: number, ay1: number, ax2: number, ay2: number, bx1: number, by1: number, bx2: number, by2: number): number {
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const a = (ax2 - ax1) * (ay2 - ay1), b = (bx2 - bx1) * (by2 - by1);
  return inter / (a + b - inter);
}

async function main() {
  console.log('[finalize] Starting post-verification finalization...');

  // Guard: check output doesn't exist
  try {
    await fs.access(COMPARISON_OUTPUT);
    console.error(`[finalize] BLOCKED: ${COMPARISON_OUTPUT} already exists. Stopping before processing.`);
    process.exit(1);
  } catch { /* not found — proceed */ }

  // 1. Load verification
  const verifyRaw = JSON.parse(await fs.readFile(VERIFICATION_PATH, 'utf8'));
  const verifications: Verification[] = verifyRaw.parsedResponse?.verifications || [];
  console.log(`[finalize] Loaded ${verifications.length} verifications`);

  // 1.1 Reconcile verdict counts
  const verdictCounts = { confirmed: 0, corrected: 0, rejected: 0, uncertain: 0 };
  for (const v of verifications) {
    if (v.verdict === 'CONFIRMED') verdictCounts.confirmed++;
    else if (v.verdict === 'CORRECTED') verdictCounts.corrected++;
    else if (v.verdict === 'REJECTED') verdictCounts.rejected++;
    else if (v.verdict === 'UNCERTAIN') verdictCounts.uncertain++;
  }
  console.log(`[finalize] Verdict tally: CONFIRMED=${verdictCounts.confirmed}, CORRECTED=${verdictCounts.corrected}, REJECTED=${verdictCounts.rejected}, UNCERTAIN=${verdictCounts.uncertain}`);
  console.log(`[finalize] Summary from verification: ${verifyRaw.parsedResponse?.summary}`);

  // 1.2 Identify corrections
  const corrections: Record<string, { from: any; to: any }> = {};
  for (const v of verifications) {
    if (v.verdict === 'CORRECTED' && (v.correctedAssetType || v.correctedAssetTag)) {
      corrections[v.candidateId] = {
        from: { assetType: v.assetTypeVerified, assetTag: v.assetTagVerified },
        to: { assetType: v.correctedAssetType || v.assetTypeVerified, assetTag: v.correctedAssetTag || v.assetTagVerified },
      };
    }
  }
  console.log(`[finalize] Identified ${Object.keys(corrections).length} corrections`);
  Object.entries(corrections).forEach(([id, c]) => {
    console.log(`  ${id}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  });

  // 2. Load original candidates (from discovery-coordinate-corrected)
  const origPath = path.join(OUTPUT_DIR, 'discovery-coordinate-corrected.json');
  const origRaw = JSON.parse(await fs.readFile(origPath, 'utf8'));
  const origCandidates = origRaw.candidates || [];
  console.log(`[finalize] Loaded ${origCandidates.length} original candidates`);

  // 2.1 Form post-verification candidates
  const postVerifCandidates: PostVerificationCandidate[] = [];
  for (const orig of origCandidates) {
    const verif = verifications.find(v => v.candidateId === orig.candidateId);
    if (!verif) {
      console.warn(`[finalize] Missing verification for ${orig.candidateId}`);
      continue;
    }
    const correction = corrections[orig.candidateId];
    const postVerif: PostVerificationCandidate = {
      candidateId: orig.candidateId,
      assetType: correction?.to.assetType || orig.assetType,
      assetTag: correction?.to.assetTag || orig.assetTag,
      confidence: orig.confidence,
      convertedBbox: orig.convertedBbox,
      bboxAreaPx: orig.bboxAreaPx,
      verification: {
        verdict: verif.verdict,
        evidence: verif.evidence,
        changedAssetType: !!(correction && correction.to.assetType !== orig.assetType),
        changedAssetTag: !!(correction && correction.to.assetTag !== orig.assetTag),
        ...(correction && { correctedTo: correction.to }),
      },
    };
    postVerifCandidates.push(postVerif);
  }
  console.log(`[finalize] Formed ${postVerifCandidates.length} post-verification candidates`);

  // 3. Load YOLO predictions
  const yoloRaw = JSON.parse(await fs.readFile(YOLO_PATH, 'utf8'));
  const yoloPage = (yoloRaw.pages || []).find((p: any) => p.pageId === 'sheet-1-p1');
  if (!yoloPage) {
    console.error('[finalize] YOLO sheet-1-p1 not found');
    process.exit(1);
  }
  const yoloDetections: YoloDetection[] = (yoloPage.retainedDetections || []).map((d: any) => ({
    predictionId: d.predictionId,
    rawLabel: d.rawLabel,
    confidence: d.confidence,
    pageBox: d.pageBox,
  }));
  console.log(`[finalize] Loaded ${yoloDetections.length} YOLO detections`);

  // 4. Greedy one-to-one matching
  const IoU_THRESHOLD = 0.15;
  const yoloSorted = yoloDetections.sort((a, b) => b.confidence - a.confidence);
  const yoloMatched = new Set<string>();
  const postVerifMatched = new Set<string>();
  const pairs: any[] = [];

  for (const pv of postVerifCandidates) {
    const bbox = pv.convertedBbox;
    let bestIou = 0, bestY: YoloDetection | null = null;
    for (const y of yoloSorted) {
      if (yoloMatched.has(y.predictionId)) continue;
      const i = iou(bbox.x1, bbox.y1, bbox.x2, bbox.y2, y.pageBox.x1, y.pageBox.y1, y.pageBox.x2, y.pageBox.y2);
      if (i > bestIou) {
        bestIou = i;
        bestY = y;
      }
    }
    if (bestIou >= IoU_THRESHOLD && bestY) {
      postVerifMatched.add(pv.candidateId);
      yoloMatched.add(bestY.predictionId);
      pairs.push({
        postVerif_id: pv.candidateId,
        postVerif_type: pv.assetType,
        postVerif_tag: pv.assetTag,
        postVerif_bbox: bbox,
        yolo_id: bestY.predictionId,
        yolo_label: bestY.rawLabel,
        yolo_conf: bestY.confidence,
        yolo_pageBox: bestY.pageBox,
        iou: Math.round(bestIou * 10000) / 10000,
      });
    }
  }

  const postVerifOnly = postVerifCandidates.filter(pv => !postVerifMatched.has(pv.candidateId));
  const yoloOnly = yoloDetections.filter(y => !yoloMatched.has(y.predictionId));

  console.log(`[finalize] Matched: ${pairs.length}, PostVerif-only: ${postVerifOnly.length}, YOLO-only: ${yoloOnly.length}`);

  // 5. Write output
  const output = {
    schemaVersion: 'pilot-comparison-postverification-v1',
    generatedAt: new Date().toISOString(),
    pageId: 'sheet-1-p1',
    disclaimer: 'Post-verification comparison. Candidates reflect verification corrections. Still not ground truth.',
    summary: {
      verdictReconciled: verdictCounts,
      matchedPairs: pairs.length,
      postVerifOnlyCount: postVerifOnly.length,
      yoloOnlyCount: yoloOnly.length,
    },
    matchedPairs: pairs,
    postVerifOnly: postVerifOnly,
    yoloOnly: yoloOnly,
    correctionsSummary: Object.entries(corrections).map(([id, c]) => ({
      candidateId: id,
      from: c.from,
      to: c.to,
    })),
  };

  await fs.writeFile(COMPARISON_OUTPUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[finalize] Written: ${COMPARISON_OUTPUT}`);
  console.log(`[finalize] Final verdict reconciliation: ${JSON.stringify(verdictCounts)}`);
  console.log(`[finalize] Matched pairs: ${pairs.length} | PostVerif-only: ${postVerifOnly.length} | YOLO-only: ${yoloOnly.length}`);
}

main().catch(e => {
  console.error('[finalize] ERROR:', e.message);
  process.exit(1);
});
