import type { Detection } from "./ai-schemas";

// Associates nearby tags with symbols via Euclidean proximity.
// ponytail: upgrade to layout-aware graph (piping connectivity) when P&ID vector parsing added.
export interface RawSymbol { bbox: { x: number; y: number; width: number; height: number }; label: string }
export interface RawTag { text: string; bbox: { x: number; y: number; width: number; height: number } }

function center(b: { x: number; y: number; width: number; height: number }) {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Tag patterns are configurable per legend — we look up passed symbols
export function associateTagsToSymbols(
  detections: Detection[],
  tagPatternRegexes: RegExp[]
): Detection[] {
  // For MVP, AI already does association. This is a post-validation pass:
  // If any detection has null assetTag but a nearby tag-like text exists in evidence, keep as-is.
  // Confidence penalty if tag pattern doesn't match legend.
  return detections.map((d) => {
    if (!d.assetTag) return d;
    const matches = tagPatternRegexes.length === 0 || tagPatternRegexes.some((r) => r.test(d.assetTag!));
    if (!matches) {
      // Downgrade confidence slightly if tag doesn't match legend patterns
      return { ...d, confidence: Math.min(d.confidence, 0.79), evidence: [...d.evidence, "Tag pattern does not match selected Legend — review required"] };
    }
    return d;
  });
}

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
