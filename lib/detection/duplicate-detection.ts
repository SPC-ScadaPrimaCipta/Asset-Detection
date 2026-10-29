/**
 * Duplicate detection for detected assets — single source of truth.
 *
 * Why this exists: the UI, the dedupe API and the worker post-job entity
 * resolution each had their own copy of "same tag + same type + bbox overlap".
 * That rule misses the duplicates users actually see, because the same symbol
 * is routinely emitted twice with DIFFERENT labels:
 *
 *   - YOLO lane says "Valve", Gemini fallback says "Control Valve" / "iso"
 *   - vector lane resolves "Instrument", vision lane resolves "Flow Element"
 *   - OCR reads "PCV-003" on one pass and "PCV-003B" on another
 *   - untagged symbols get synthetic UNK-### tags, so tag equality never fires
 *
 * The rule below is geometry-first and tolerant, while still refusing to merge
 * two genuinely different assets that merely sit near each other:
 *
 *   A. very strong geometry (IoU >= 0.6, or one box inside the other when tags
 *      or types agree)  -> duplicate regardless of label drift
 *   B. same tag + compatible type + overlap / close centroid -> duplicate
 *   C. same tag base (PCV-003 vs PCV-003B) + overlap -> duplicate
 *   D. both untagged + IoU >= 0.8 -> duplicate
 *
 * Rows never merge across pages. The best row per group is chosen by
 * approved -> informative tag/type -> confidence -> newest.
 */

export interface DuplicateBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DuplicateRow {
  id: string;
  assetTag?: string | null;
  assetType?: string | null;
  confidence?: number | null;
  page?: number | null;
  bbox?: DuplicateBbox | null;
  reviewStatus?: string | null;
  createdAt?: string | null;
}

export interface DuplicateConfig {
  /** IoU that marks a duplicate regardless of tag/type drift. */
  strongIou: number;
  /** IoU required when tag + compatible type already agree. */
  tagIou: number;
  /** Centroid distance (0-1000 space) for same tag + compatible type. */
  tagCentroid: number;
  /** IoU required when the tag base matches but the suffix differs. */
  tagBaseIou: number;
  /** IoU required for two untagged rows. */
  untaggedIou: number;
}

export const DEFAULT_DUPLICATE_CONFIG: DuplicateConfig = {
  strongIou: 0.6,
  tagIou: 0.3,
  tagCentroid: 80,
  tagBaseIou: 0.4,
  untaggedIou: 0.8,
};

export interface DuplicateGroup {
  /** Row kept as the representative of the group. */
  winnerId: string;
  /** Rows considered duplicates of the winner. */
  duplicateIds: string[];
}

export interface DuplicateResult {
  /** Every id that is a duplicate of some other row. */
  duplicateIds: Set<string>;
  /** duplicateId -> winnerId. */
  duplicateOf: Map<string, string>;
  groups: DuplicateGroup[];
}

/** Type values that carry no information and must act as a wildcard in matching. */
const JUNK_TYPE_RE = /^(unknown|iso|pip|niso|other|misc|n\/a|-|null|undefined|equipment|generic|item|asset)$/i;

export function isJunkAssetType(type: string | null | undefined): boolean {
  const t = (type ?? '').trim();
  if (!t) return true;
  if (JUNK_TYPE_RE.test(t)) return true;
  // Dotted raw YOLO labels are fragments, never real types.
  if (t.includes('.')) return true;
  return false;
}

export function normalizeTag(tag: string | null | undefined): string {
  return (tag ?? '').trim().toUpperCase();
}

/**
 * Tag without a trailing single-letter revision suffix (PCV-003B → PCV-003).
 * Numeric suffixes are NOT stripped: P-101 / P-102 are different assets.
 */
export function tagBase(tag: string): string {
  return tag.replace(/(?<=\d)[A-Z]$/i, '');
}

function alnum(tag: string): string {
  return tag.replace(/[^A-Z0-9]/gi, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * OCR variants of the same tag: PCV-003 / PCV-003B, LSLL-0601 / LSLL-V-0601.
 * Deliberately strict (0.85) so PI-232 / PT-232 and TE-221 / TI-221 stay
 * separate instruments.
 */
export function tagSimilarity(a: string, b: string): number {
  const x = alnum(normalizeTag(a));
  const y = alnum(normalizeTag(b));
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export function normalizeType(type: string | null | undefined): string {
  return (type ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function typeTokens(type: string): string[] {
  return normalizeType(type).split(' ').filter((t) => t.length > 2);
}

/**
 * Two type labels may describe the same symbol when either side is a junk
 * value or they share a meaningful token ("control valve" vs "valve",
 * "pressure transmitter" vs "pressure differential transmitter").
 */
export function typeCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (isJunkAssetType(a) || isJunkAssetType(b)) return true;
  const na = normalizeType(a);
  const nb = normalizeType(b);
  if (na === nb) return true;
  const ta = new Set(typeTokens(a ?? ''));
  return typeTokens(b ?? '').some((t) => ta.has(t));
}

export function bboxIoU(a: DuplicateBbox, b: DuplicateBbox): number {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.width, b.x + b.width);
  const iy1 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Intersection over the smaller box area (detects a box nested in another). */
export function bboxContainment(a: DuplicateBbox, b: DuplicateBbox): number {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.width, b.x + b.width);
  const iy1 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? inter / minArea : 0;
}

export function bboxCentroidDistance(a: DuplicateBbox, b: DuplicateBbox): number {
  return Math.hypot(
    a.x + a.width / 2 - (b.x + b.width / 2),
    a.y + a.height / 2 - (b.y + b.height / 2),
  );
}

function rankScore(row: DuplicateRow): number {
  const approved = (row.reviewStatus ?? '').toUpperCase() === 'APPROVED' ? 8 : 0;
  const tagged = normalizeTag(row.assetTag) ? 4 : 0;
  const typed = isJunkAssetType(row.assetType) ? 0 : 4;
  const bboxed = row.bbox ? 2 : 0;
  const conf = typeof row.confidence === 'number' ? row.confidence : 0;
  return approved + tagged + typed + bboxed + conf;
}

function rankRows(rows: DuplicateRow[]): DuplicateRow[] {
  return rows
    .map((row, index) => ({ row, index, score: rankScore(row) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ac = a.row.createdAt ?? '';
      const bc = b.row.createdAt ?? '';
      if (ac !== bc) return ac < bc ? 1 : -1;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

export function findDuplicates(
  rows: DuplicateRow[],
  config: Partial<DuplicateConfig> = {},
): DuplicateResult {
  const cfg: DuplicateConfig = { ...DEFAULT_DUPLICATE_CONFIG, ...config };
  const ordered = rankRows(rows);
  const duplicateIds = new Set<string>();
  const duplicateOf = new Map<string, string>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    if (duplicateIds.has(a.id)) continue;

    const aTag = normalizeTag(a.assetTag);
    const aBase = aTag ? tagBase(aTag) : '';
    const dupes: string[] = [];

    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j];
      if (duplicateIds.has(b.id)) continue;

      // Never merge across sheets.
      if (a.page !== null && a.page !== undefined && b.page !== null && b.page !== undefined) {
        if (a.page !== b.page) continue;
      }

      const bTag = normalizeTag(b.assetTag);
      const sameTag = aTag !== '' && aTag === bTag;
      const aPrefix = aTag.match(/^[A-Z]+/)?.[0] ?? '';
      const bPrefix = bTag.match(/^[A-Z]+/)?.[0] ?? '';
      const samePrefix = aPrefix !== '' && aPrefix === bPrefix;

      let isDuplicate = false;

      if (a.bbox && b.bbox) {
        const iou = bboxIoU(a.bbox, b.bbox);
        const containment = bboxContainment(a.bbox, b.bbox);
        const dist = bboxCentroidDistance(a.bbox, b.bbox);
        const oneTagMissing = !aTag || !bTag;
        const tagsAgree =
          sameTag ||
          oneTagMissing ||
          (aTag !== '' && bTag !== '' && tagSimilarity(aTag, bTag) >= 0.85);

        // Near-identical geometry is the same symbol no matter what the two lanes called it.
        const isSmallSymbol = Math.max(a.bbox.width, a.bbox.height, b.bbox.width, b.bbox.height) <= 30;
        const closeCentroid = dist <= (isSmallSymbol ? 15 : 25);
        const heavyOverlap = isSmallSymbol
          ? (containment >= 0.15 || iou >= 0.08)
          : (containment >= 0.25 || iou >= 0.10);

        if (iou >= 0.85) {
          // Strong IoU: physical symbol detected twice regardless of tag/type drift
          isDuplicate = true;
        } else if (sameTag && (dist < cfg.tagCentroid || heavyOverlap || containment >= 0.5)) {
          // Identical tag on the same sheet within spatial proximity or overlapping.
          // AI lanes (e.g. YOLO vs Gemini) frequently disagree on type (DIESEL ENGINE vs Equipment).
          // If tags and page match and geometry is in proximity, they represent the same asset.
          isDuplicate = true;
        } else if (isSmallSymbol && samePrefix && typeCompatible(a.assetType, b.assetType) && closeCentroid && heavyOverlap) {
          // Small equipment symbols (e.g. valves) with auto-assigned sequential tags of the same prefix (V-042 vs V-018)
          isDuplicate = true;
        } else if (tagsAgree && typeCompatible(a.assetType, b.assetType) && closeCentroid && heavyOverlap) {
          isDuplicate = true;
        } else if (iou >= cfg.strongIou && tagsAgree) {
          isDuplicate = true;
        } else if (aBase && aBase === (bTag ? tagBase(bTag) : '') && iou >= cfg.tagBaseIou) {
          // OCR suffix drift: PCV-003 vs PCV-003B on the same symbol.
          isDuplicate = true;
        } else if (!aTag && !bTag && iou >= cfg.untaggedIou) {
          isDuplicate = true;
        }
      } else if (sameTag) {
        // No geometry to disprove it — same tag on the same page.
        isDuplicate = true;
      }

      if (isDuplicate) {
        duplicateIds.add(b.id);
        duplicateOf.set(b.id, a.id);
        dupes.push(b.id);
      }
    }

    if (dupes.length > 0) groups.push({ winnerId: a.id, duplicateIds: dupes });
  }

  return { duplicateIds, duplicateOf, groups };
}
