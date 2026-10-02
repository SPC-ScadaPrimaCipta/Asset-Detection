/**
 * Detection V2 — deterministic, scale-aware text↔symbol association.
 *
 * Produces EXPLAINABLE EVIDENCE for Phase 6 (confidence engine) — it does
 * NOT decide final asset confidence. No fixed pixel radius: every distance
 * is normalized against the page diagonal, so the same drawing at 150 DPI
 * and 360 DPI behaves identically.
 */
import {
  boxIoU,
  centerDistance,
  type PageBox,
  type PageGeometry,
} from './coordinate-transform';
import { containmentRatio, isContained } from './bbox-validator';

export interface TextCandidate {
  id: string;
  text: string;
  bbox: PageBox;
  confidence?: number;
}

export interface SymbolCandidate {
  id: string;
  bbox: PageBox;
  legendReferenceId?: string | null;
}

export type Direction =
  | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
  | 'OVERLAP' | 'CONTAINED';

export interface Association {
  textId: string;
  symbolId: string;
  /** Center distance in page pixels. */
  distance: number;
  /** Minimum edge gap in page pixels (0 when overlapping). */
  edgeDistance: number;
  /** distance / pageDiagonal — scale-invariant. */
  normalizedDistance: number;
  overlap: number;
  direction: Direction;
  /** Evidence score 0..1 (NOT final confidence — consumed by Phase 6). */
  score: number;
  reasons: string[];
}

export interface AssociationOptions {
  /**
   * Max allowed normalizedDistance. Default 0.15 (≈15% of page diagonal).
   * Tags beyond this are never associated, however strong other signals are.
   */
  maxNormalizedDistance?: number;
}

function pageDiagonal(geo: PageGeometry): number {
  return Math.hypot(geo.pageWidth, geo.pageHeight);
}

function center(b: PageBox): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Minimum gap between rect edges; 0 when they touch or overlap. */
export function edgeDistance(a: PageBox, b: PageBox): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(dx, dy);
}

export function directionFromTo(from: PageBox, to: PageBox): Direction {
  const iou = boxIoU(from, to);
  if (iou > 0) return 'OVERLAP';
  if (isContained(to, from) || isContained(from, to)) return 'CONTAINED';
  const f = center(from);
  const t = center(to);
  const dx = t.x - f.x;
  const dy = t.y - f.y;
  // Screen coords: +y is down. 'N' = text above symbol.
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI; // -180..180, 0 = east
  if (angle >= -22.5 && angle < 22.5) return 'E';
  if (angle >= 22.5 && angle < 67.5) return 'NE';
  if (angle >= 67.5 && angle < 112.5) return 'N';
  if (angle >= 112.5 && angle < 157.5) return 'NW';
  if (angle >= 157.5 || angle < -157.5) return 'W';
  if (angle >= -157.5 && angle < -112.5) return 'SW';
  if (angle >= -112.5 && angle < -67.5) return 'S';
  return 'SE';
}

function scoreAssociation(
  normalizedDistance: number,
  maxNorm: number,
  overlap: number,
  contained: boolean
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  // Proximity component (0..0.6): linear decay to the gate.
  const proximity = Math.max(0, 1 - normalizedDistance / maxNorm);
  reasons.push(`proximity=${proximity.toFixed(3)} (normalizedDistance=${normalizedDistance.toFixed(4)})`);
  // Overlap / containment component (0..0.25).
  let overlapBonus = 0;
  if (contained) {
    overlapBonus = 0.25;
    reasons.push('overlap: containment (+0.25)');
  } else if (overlap > 0) {
    overlapBonus = 0.25 * overlap;
    reasons.push(`overlap: IoU=${overlap.toFixed(3)} (+${overlapBonus.toFixed(3)})`);
  } else {
    reasons.push('overlap: none (+0)');
  }
  // Direction component (0..0.15): neutral prior — any adjacent direction is
  // plausible for P&ID tags; only used as tie-break signal.
  const directionBonus = 0.15 * proximity;
  reasons.push(`direction: adjacent prior (+${directionBonus.toFixed(3)})`);
  const score = Math.min(
    1,
    Math.max(0, 0.6 * proximity + overlapBonus + directionBonus)
  );
  return { score, reasons };
}

export function associateOneText(
  text: TextCandidate,
  symbols: SymbolCandidate[],
  geo: PageGeometry,
  opts: AssociationOptions = {}
): Association | null {
  const maxNorm = opts.maxNormalizedDistance ?? 0.15;
  const diag = pageDiagonal(geo);
  if (!(diag > 0)) return null;

  let best: Association | null = null;
  for (const sym of symbols) {
    const distance = centerDistance(text.bbox, sym.bbox);
    const normalizedDistance = distance / diag;
    if (normalizedDistance > maxNorm) continue;
    const overlap = boxIoU(text.bbox, sym.bbox);
    const direction = directionFromTo(sym.bbox, text.bbox);
    const contained =
      direction === 'CONTAINED' ||
      containmentRatio(text.bbox, sym.bbox) >= 0.99 ||
      containmentRatio(sym.bbox, text.bbox) >= 0.99;
    const { score, reasons } = scoreAssociation(normalizedDistance, maxNorm, overlap, contained);
    const assoc: Association = {
      textId: text.id,
      symbolId: sym.id,
      distance,
      edgeDistance: edgeDistance(text.bbox, sym.bbox),
      normalizedDistance,
      overlap,
      direction,
      score,
      reasons,
    };
    if (!best || assoc.score > best.score) best = assoc;
  }
  return best;
}

/**
 * Greedy nearest-evidence association: every text links to its best-scoring
 * symbol within the gate. One text → at most one symbol; a symbol may collect
 * several texts (Phase 6 / review decides the winning tag).
 */
export function associateTextsToSymbols(
  texts: TextCandidate[],
  symbols: SymbolCandidate[],
  geo: PageGeometry,
  opts: AssociationOptions = {}
): Association[] {
  const out: Association[] = [];
  for (const t of texts) {
    const best = associateOneText(t, symbols, geo, opts);
    if (best) out.push(best);
  }
  return out;
}

// ── Phase 4: ranked multi-candidate association wiring ──────────────────────
// Same evidence model as services/cv/association.py. Returns EVERY in-gate
// symbol ranked — no forced single winner (premature assignment creates
// false negatives). Phase 6 owns final resolution. Existing single-best API
// above is preserved untouched.

export interface RankedTextCandidate extends TextCandidate {
  pageNumber: number;
  isTag?: boolean;
  tagLike?: boolean;
}

export interface RankedSymbolCandidate extends SymbolCandidate {
  pageNumber: number;
}

export interface AssociationFeatures {
  tagPatternScore: number;
  distanceScore: number;
  overlapScore: number;
  directionScore: number;
  sizeScore: number;
}

export interface RankedAssociation extends Omit<Association, 'score' | 'reasons'> {
  features: AssociationFeatures;
  score: number;
  reasons: string[];
}

function isFiniteBox(b: PageBox): boolean {
  return (
    Number.isFinite(b.x) && Number.isFinite(b.y) &&
    Number.isFinite(b.width) && Number.isFinite(b.height) &&
    b.width > 0 && b.height > 0
  );
}

export function rankAssociationsForText(
  text: RankedTextCandidate,
  symbols: RankedSymbolCandidate[],
  geo: PageGeometry,
  opts: AssociationOptions = {}
): RankedAssociation[] {
  const maxNorm = opts.maxNormalizedDistance ?? 0.15;
  const diag = Math.hypot(geo.pageWidth, geo.pageHeight);
  if (!(diag > 0) || !isFiniteBox(text.bbox)) return [];

  const out: RankedAssociation[] = [];
  for (const sym of symbols) {
    // Constraint: cross-page candidates never associate.
    if (sym.pageNumber !== text.pageNumber) continue;
    // Constraint: invalid geometry never associates.
    if (!isFiniteBox(sym.bbox)) continue;
    const distance = centerDistance(text.bbox, sym.bbox);
    const normalizedDistance = distance / diag;
    if (normalizedDistance > maxNorm) continue;

    const overlap = boxIoU(text.bbox, sym.bbox);
    const direction = directionFromTo(sym.bbox, text.bbox);
    const distanceScore = Math.max(0, 1 - normalizedDistance / maxNorm);
    const tagPatternScore = text.isTag ? 1 : text.tagLike ? 0.5 : 0;
    const directionScore = distanceScore * 0.5 + Math.min(1, overlap + 0.5) * 0.5;
    // Size plausibility (penalize, don't reject): text vs symbol height.
    const ratio = sym.bbox.height > 0 ? text.bbox.height / sym.bbox.height : 0;
    const sizeScore =
      ratio >= 0.02 && ratio <= 2 ? 1 : Math.max(0, 1 - Math.abs(ratio - 1) / 8);
    // Initial weights — Phase 6 owns final calibration, not this layer.
    const score =
      0.35 * distanceScore + 0.25 * tagPatternScore + 0.15 * overlap +
      0.1 * directionScore + 0.15 * sizeScore;
    out.push({
      textId: text.id,
      symbolId: sym.id,
      distance,
      edgeDistance: edgeDistance(text.bbox, sym.bbox),
      normalizedDistance,
      overlap,
      direction,
      features: { tagPatternScore, distanceScore, overlapScore: overlap, directionScore, sizeScore },
      score: Math.min(1, Math.max(0, score)),
      reasons: [
        `normalizedDistance=${normalizedDistance.toFixed(4)} (gate ${maxNorm})`,
        `tagPattern=${text.isTag ? 'valid' : text.tagLike ? 'tag-like' : 'absent'}`,
        `direction=${direction}`,
        `sizeRatio=${ratio.toFixed(3)}`,
      ],
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
