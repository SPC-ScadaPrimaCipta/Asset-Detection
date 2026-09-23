import type { Detection } from "./ai-schemas";

export interface RawSymbol { bbox: { x: number; y: number; width: number; height: number }; label: string }
export interface RawTag { text: string; bbox: { x: number; y: number; width: number; height: number } }

function center(b: { x: number; y: number; width: number; height: number }) {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Post-processing pass after AI detection:
 *
 * 1. Tag-pattern validation: if assetTag present but doesn't match any legend pattern →
 *    downgrade confidence + add evidence note.
 *
 * 2. Proximity-based tag recovery: if assetTag is null but another detection
 *    on the same page has a tag AND their bboxes are close (within MAX_PROXIMITY units
 *    in 0-1000 space), attempt to associate the nearest tagged detection's tag.
 *    Only applies when AI missed the association — does NOT override AI-assigned tags.
 *
 * Coords are in 0-1000 normalized space.
 */
// Phase 4: proximity per kelas aset (0-1000 units).
// Tag vessel sering jauh dari simbol; valve/instrument dekat.
// Bisa dioverride via SPATIAL_MAX_PROXIMITY_JSON='{"valve":100,"default":150}'.
const DEFAULT_MAX_PROXIMITY = parseInt(process.env.SPATIAL_MAX_PROXIMITY ?? '150', 10);

function maxProximityFor(assetType?: string | null): number {
  try {
    const raw = process.env.SPATIAL_MAX_PROXIMITY_JSON;
    if (raw) {
      const m = JSON.parse(raw) as Record<string, number>;
      const t = (assetType ?? '').toLowerCase();
      if (/valve|psv|prv|xv|fcv|mov|sdv/.test(t) && m.valve != null) return m.valve;
      if (/vessel|tank|column|reactor|separator|drum/.test(t) && m.vessel != null) return m.vessel;
      if (/pump|compressor|fan|blower|turbine|motor/.test(t) && m.rotating != null) return m.rotating;
      if (m.default != null) return m.default;
    }
  } catch { /* abaikan JSON rusak → pakai default */ }
  const t = (assetType ?? '').toLowerCase();
  if (/valve|psv|prv|xv|fcv|mov|sdv|check|gate|ball|globe/.test(t)) return 100;
  if (/vessel|tank|column|reactor|separator|drum|heater|exchanger/.test(t)) return 250;
  if (/pump|compressor|fan|blower|turbine|motor/.test(t)) return 180;
  return DEFAULT_MAX_PROXIMITY;
}

export function associateTagsToSymbols(
  detections: Detection[],
  tagPatternRegexes: RegExp[]
): Detection[] {
  // Step 1: Tag pattern validation
  const validated = detections.map((d) => {
    if (!d.assetTag) return d;
    const matches = tagPatternRegexes.length === 0 || tagPatternRegexes.some((r) => r.test(d.assetTag!));
    if (!matches) {
      return {
        ...d,
        confidence: Math.min(d.confidence, 0.79),
        evidence: [...d.evidence, "Tag pattern does not match selected Legend — review required"],
      };
    }
    return d;
  });

  // Step 2: Proximity-based tag recovery for untagged detections.
  // Build candidate list: detections that have a confirmed tag.
  const taggedCandidates = validated.filter(
    (d) => d.assetTag !== null && d.assetTag !== undefined
  );

  if (taggedCandidates.length === 0) return validated;

  // M14 fix: Track claimed candidates so one tag source is not assigned to multiple detections.
  // Use Set of claimed candidate detection references (object identity).
  const claimedCandidates = new Set<Detection>();

  return validated.map((d) => {
    // Already has a tag — skip
    if (d.assetTag !== null && d.assetTag !== undefined) return d;

    const dc = center(d.bbox);
    let bestDist = Infinity;
    let bestCandidate: Detection | null = null;

    for (const candidate of taggedCandidates) {
      // Skip already-claimed candidates — prevents multi-assign of same tag source
      if (claimedCandidates.has(candidate)) continue;

      const cc = center(candidate.bbox);
      const distToCand = dist(dc, cc);
      const maxProx = maxProximityFor((d as { assetType?: string }).assetType ?? (d as unknown as { asset_type?: string }).asset_type ?? null);
      if (distToCand < bestDist && distToCand < maxProx) {
        bestDist = distToCand;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      // Check: is this candidate's tag already claimed by a closer untagged detection?
      const closerExists = validated.some((other) => {
        if (other === d) return false;
        if (other.assetTag !== null && other.assetTag !== undefined) return false;
        const oc = center(other.bbox);
        const bc = center(bestCandidate!.bbox);
        return dist(oc, bc) < bestDist;
      });

      if (!closerExists) {
        // Claim this candidate — prevents other untagged detections from using it
        claimedCandidates.add(bestCandidate);
        return {
          ...d,
          assetTag: bestCandidate.assetTag,
          confidence: Math.min(d.confidence, 0.75),
          evidence: [
            ...d.evidence,
            `Tag ${bestCandidate.assetTag} inferred by spatial proximity (${Math.round(bestDist)} units away) — verify`,
          ],
        };
      }
    }

    return d;
  });
}

/**
 * Nearest tag for a raw symbol — used by external callers (e.g. future vector P&ID parser).
 */
export function nearestTagForSymbol(symbol: RawSymbol, tags: RawTag[], maxDist = 400): RawTag | null {
  const sc = center(symbol.bbox);
  let best: RawTag | null = null;
  let bestD = Infinity;
  for (const t of tags) {
    const d = dist(sc, center(t.bbox));
    if (d < bestD && d < maxDist) { bestD = d; best = t; }
  }
  return best;
}

/**
 * Phase 4: Non-Maximum Suppression (NMS) pre-persist.
 * Merge deteksi duplikat: IoU bbox > threshold DAN tag sama (UPPER+TRIM)
 * → keep confidence tertinggi. Mencegah inflasi 473 deteksi & bbox
 * "melenceng jauh" akibat box tumpang tindih dari Gemini.
 *
 * Hanya merge jika KEDUANYA punya tag sama non-empty; deteksi tanpa tag
 * tidak di-merge di sini (entity resolution worker menangani via evidence).
 */
export function bboxIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(ax2, bx2);
  const iy1 = Math.min(ay2, by2);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function applyNMS<T extends {
  bbox: { x: number; y: number; width: number; height: number };
  assetTag?: string | null;
  confidence: number;
  evidence?: string[];
}>(detections: T[], iouThreshold = 0.5): T[] {
  if (detections.length <= 1) return detections;
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: T[] = [];
  const suppressed = new Array(sorted.length).fill(false);
  for (let i = 0; i < sorted.length; i++) {
    if (suppressed[i]) continue;
    const cur = sorted[i];
    kept.push(cur);
    const curTag = (cur.assetTag ?? '').toUpperCase().trim();
    if (!curTag) continue; // tanpa tag → jangan suppress yang lain
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed[j]) continue;
      const nxt = sorted[j];
      const nxtTag = (nxt.assetTag ?? '').toUpperCase().trim();
      if (nxtTag !== curTag) continue;
      if (bboxIoU(cur.bbox, nxt.bbox) > iouThreshold) {
        suppressed[j] = true;
      }
    }
  }
  return kept;
}
