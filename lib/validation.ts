/**
 * Detection validation gates (Blok 6).
 *
 * DB forensics (job 510e9ccb) proved junk persistence through the vision path:
 *   - asset_tag "9", "10", "11" (Gemini-hallucinated fragments, conf 0.7)
 *   - asset_type "iso", "pip", "niso" (raw YOLO label suffixes, not types)
 *   - OCR fragments ("4", "X") stored as candidates
 *
 * The vector path already validates tags; the vision/Gemini/YOLO paths did not.
 * These gates apply to EVERY path before persist. Deterministic, no I/O.
 */

export const UNKNOWN_ASSET_TYPE_VALUE = 'UNKNOWN';

// ── Tag validation ────────────────────────────────────────────────────────────

const FALLBACK_TAG_RES = [
  /^[A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2}$/i,
  /^[A-Z]{1,4}-[A-Z0-9]{1,6}-[A-Z0-9]{1,6}$/i,
  /^[A-Z]{1,6}[-_][0-9]{2,6}[-_][A-Z0-9]{1,4}$/i,
];

/** Pipe specs, dimensions, doc numbers — never equipment tags. */
const PIPE_SPEC_RE = /^[\d]+["'/][-x×]?[\d]*["'#\s]|^[\d]+"[-x×][\d]+"$|#\d*$|^\d+"-\d+#$/i;
/** Status codes / single letters — never equipment tags. */
const STATUS_RE = /^(RUN|STOP|R-ST|XI|M|I|B|N\/A|TBD|PIT|ST)$/i;

/** Legend `tag_pattern` (P-### style) → RegExp. Mirrors dxf-detection builder. */
export function buildTagRegexes(patterns: Array<string | null | undefined>): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    if (!p) continue;
    try {
      const esc = p
        .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
        .replace(/#/g, '\\d')
        .replace(/\*/g, '.*');
      out.push(new RegExp(`^${esc}$`, 'i'));
    } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Strict asset-tag check. Rejects pure numbers ("9"), single letters,
 * pipe specs, status codes, and anything matching no known pattern.
 * `legendRegexes` may be empty — fallback formats still apply.
 */
export function isValidAssetTag(tag: string | null | undefined, legendRegexes: RegExp[] = []): boolean {
  if (!tag) return false;
  const t = tag.trim();
  if (t.length < 3 || t.length > 28) return false;
  if (PIPE_SPEC_RE.test(t)) return false;
  if (STATUS_RE.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if (!/^[A-Z]/i.test(t)) return false;
  // Must contain at least one digit (tags always have numbers; "PIT"/"FLARE" don't qualify alone)
  if (!/\d/.test(t)) return false;
  for (const re of legendRegexes) {
    try { if (re.test(t)) return true; } catch { /* skip */ }
  }
  return FALLBACK_TAG_RES.some((re) => re.test(t));
}

// ── YOLO label sanitization ───────────────────────────────────────────────────

/**
 * YOLO v203 labels are hierarchical: <category>.<type>.<standard>
 * (e.g. "valve.ball.iso", "equipment.pump.niso", "instrument.level_indicator.niso").
 * The old code used `.split('.').pop()` → "iso"/"pip"/"niso" persisted as TYPES.
 * This maps to a human asset type, or null when unresolvable (→ UNKNOWN).
 */
export function humanizeYoloLabel(rawLabel: string | null | undefined): string | null {
  if (!rawLabel) return null;
  const parts = rawLabel.trim().toLowerCase().split('.');
  if (parts.length < 2) {
    // Bare fragment ("iso", "pip") or single word — never a type.
    return null;
  }
  const [category, type] = parts;
  if (category === 'unknown' || !type || type === 'unknown') return null;
  const words = (s: string) =>
    s.split(/[_\s]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

  switch (category) {
    case 'valve': {
      // ball → "Ball Valve", 3way_ball → "3-Way Ball Valve"
      const t = type
        .replace(/^(\d)-?way_?/, '$1-Way ')
        .replace(/_closed$/, ' (Closed)')
        .replace(/_nc$/, ' (NC)');
      return `${words(t)} Valve`.replace(' Valve Valve', ' Valve');
    }
    case 'equipment':
    case 'instrument':
    case 'tower':
    case 'fitting':
    case 'tank':
    case 'vessel':
    case 'filter':
    case 'pump':
    case 'compressor':
      return words(type);
    default:
      return null;
  }
}

/** Fragments and scan-output placeholders that must never persist as asset_type. */
const JUNK_TYPE_RE = /^(iso|pip|niso|unknown|other|misc|n\/a|-|valve|equipment|instrument|tower|fitting|null|undefined)$/i;

/**
 * Final type gate before persist. Returns a safe asset type:
 * UNKNOWN when empty, fragmentary, or dotted raw labels.
 */
export function sanitizeAssetType(
  assetType: string | null | undefined,
  knownTypes?: Set<string>,
): string {
  const t = (assetType ?? '').trim();
  if (!t || t === UNKNOWN_ASSET_TYPE_VALUE) return UNKNOWN_ASSET_TYPE_VALUE;
  if (t.includes('.')) return UNKNOWN_ASSET_TYPE_VALUE;
  if (JUNK_TYPE_RE.test(t)) return UNKNOWN_ASSET_TYPE_VALUE;
  if (t.length < 3) return UNKNOWN_ASSET_TYPE_VALUE;
  if (knownTypes && knownTypes.size > 0) {
    const lower = t.toLowerCase();
    let ok = false;
    for (const k of knownTypes) {
      if (k.toLowerCase() === lower) { ok = true; break; }
    }
    if (!ok) return UNKNOWN_ASSET_TYPE_VALUE;
  }
  return t;
}
