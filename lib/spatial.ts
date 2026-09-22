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
// ~15% of canvas width — covers typical tag-to-symbol separation in dense P&IDs.
// Configurable via SPATIAL_MAX_PROXIMITY env var (integer, 0-1000 units).
const MAX_PROXIMITY = parseInt(process.env.SPATIAL_MAX_PROXIMITY ?? '150', 10);

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
      if (distToCand < bestDist && distToCand < MAX_PROXIMITY) {
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
