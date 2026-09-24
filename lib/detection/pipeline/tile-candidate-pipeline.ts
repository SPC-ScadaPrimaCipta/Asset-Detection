/**
 * Detection V2 — tile → page candidate wiring (Phase 3).
 *
 * Pipeline: tile-local candidate → tileToPage → validateBox → dedup.
 * NEVER persists tile-local coords. Coordinate formulas live ONLY in
 * coordinate-transform.ts; validation ONLY in bbox-validator.ts.
 *
 * Produces candidate EVIDENCE for later phases — no confidence scoring,
 * no classification, no Gemini calls here.
 */
import {
  boxIoU,
  centerDistance,
  tileToPage,
  type PageBox,
  type PageGeometry,
} from '@/lib/detection/geometry/coordinate-transform';
import { validateBox } from '@/lib/detection/geometry/bbox-validator';
import type {
  CvCandidate,
  CvTileMeta,
  PageCandidate,
} from '@/lib/detection/candidates/schema';

/**
 * Map one tile's candidates to canonical page space.
 * Invalid boxes (NaN, zero-area, fully outside) are dropped with a reason.
 */
export function mapTileCandidatesToPage(
  candidates: CvCandidate[],
  tile: CvTileMeta
): { kept: PageCandidate[]; dropped: { candidateId: string; reason: string }[] } {
  const geo: PageGeometry = { pageWidth: tile.pageWidth, pageHeight: tile.pageHeight };
  const kept: PageCandidate[] = [];
  const dropped: { candidateId: string; reason: string }[] = [];
  for (const c of candidates) {
    const pageBox = tileToPage(c.bbox, { x: tile.tileX, y: tile.tileY });
    const v = validateBox(pageBox, geo);
    if (!v.valid || !v.box) {
      dropped.push({ candidateId: c.candidateId, reason: v.reasons.join('; ') });
      continue;
    }
    kept.push({
      ...c,
      bbox: v.box,
      pageWidth: tile.pageWidth,
      pageHeight: tile.pageHeight,
      provenance: [...c.provenance, `tile:${tile.tileIndex}`, `page:${tile.pageNumber}`],
    });
  }
  return { kept, dropped };
}

function union(a: PageBox, b: PageBox): PageBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export interface DedupOptions {
  iouThreshold?: number;
}

/**
 * Deterministic page-space dedup (TS mirror of services/cv/dedup.py).
 * Merge rule: same page + same candidateType + IoU ≥ threshold.
 * Provenance retained: canonical candidate lists source tiles + merged ids.
 */
export function deduplicatePageCandidates(
  candidates: PageCandidate[],
  opts: DedupOptions = {}
): PageCandidate[] {
  const threshold = opts.iouThreshold ?? 0.5;
  const kept: PageCandidate[] = [];
  for (const cand of candidates) {
    let target: PageCandidate | null = null;
    for (const k of kept) {
      if (k.pageNumber !== cand.pageNumber) continue;
      if (k.candidateType !== cand.candidateType) continue;
      if (boxIoU(k.bbox, cand.bbox) < threshold) continue;
      target = k;
      break;
    }
    if (!target) {
      kept.push({ ...cand });
      continue;
    }
    target.bbox = union(target.bbox, cand.bbox);
    const tiles = [...(target.evidence?.sourceTiles ?? []), ...(cand.evidence?.sourceTiles ?? [])];
    if (target.evidence) target.evidence.sourceTiles = [...new Set(tiles)];
    target.provenance = [
      ...new Set([...target.provenance, ...cand.provenance, `merged:${cand.candidateId}`]),
    ];
    if (!target.ocr && cand.ocr) target.ocr = cand.ocr;
    if (!target.tag && cand.tag) target.tag = cand.tag;
    if (target.evidence) {
      target.evidence.notes = [
        ...new Set([
          ...(target.evidence.notes ?? []),
          `dedup-merged ${cand.candidateId} (IoU>=${threshold})`,
        ]),
      ];
    }
  }
  // Refresh geometry centers after union merges.
  for (const k of kept) {
    if (k.geometry) {
      k.geometry.centerX = k.bbox.x + k.bbox.width / 2;
      k.geometry.centerY = k.bbox.y + k.bbox.height / 2;
    }
  }
  return kept;
}

export { centerDistance };
