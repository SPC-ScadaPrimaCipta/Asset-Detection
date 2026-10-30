/**
 * DXF Detection Pipeline — improved v2
 *
 * Improvements over v1:
 *   1. Tag pattern from Legend (not hard-coded TAG_RE) — #1
 *   2. Configurable layer mapping via LayerProfile (DB-backed) — #2
 *   3. CIRCLE/ARC entities in detection — #3
 *   4. AI pre-pass layer auto-classification exported — #4 (invoked externally)
 *   5. Adaptive spatial association based on local density — #5
 *   6. XREF bbox proxy from nearby LINE/ARC/CIRCLE — #6
 *   7. Gemini fallback as text-prompt (not SVG crop) — #7
 *   8. Confidence fusion from multi-signal scores — #8
 *
 * Pipeline (XREF-bound / TEXT-first):
 *   Tier 1 — TEXT in tag layer, valid tag format      → base 0.90 + fusion
 *   Tier 2 — INSERT near tag TEXT (bbox from geometry) → base 0.70 + fusion
 *   Tier 3 — Untagged INSERT / CIRCLE cluster          → base 0.40, Gemini text fallback
 */

import {
  parseDxf,
  dxfToNorm,
  stripMtext,
  splitDxfRegions,
  type DxfParseResult,
  type DxfPageExtents,
  type DxfRegion,
  type DxfInsertEntity,
  type DxfTextEntity,
  type DxfPoint,
  type DxfCircleEntity,
  type DxfArcEntity,
  type DxfLineEntity,
  type DxfPolylineEntity,
  type DxfSplineEntity,
  type DxfEllipseEntity,
  type DxfAttDefEntity,
} from '@/lib/dxf-parser';
import {
  clusterSymbolGeometry,
  nearestCluster,
} from '@/lib/dxf-clusters';
import { parseLineSpecText } from '@/lib/piping-parser';
import { env } from '@/lib/env';
import { classifyDxfCandidate } from '@/lib/mdo-pid-rules';

// ── Public types ──────────────────────────────────────────────────────────────

export interface LegendSymbolRef {
  id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  aliases: string[];
}

/**
 * Configurable layer profile (from DB or defaults).
 * category: 'tag' | 'description' | 'pipe' | 'equipment' | 'title' | 'ignore' | 'unknown'
 */
export interface LayerProfile {
  layer_name: string;   // full DXF layer name (may include XREF prefix)
  short_name: string;   // stripped (after $0$)
  category: 'tag' | 'description' | 'pipe' | 'equipment' | 'title' | 'ignore' | 'unknown';
  tag_priority: number; // lower = higher priority
}

export interface DxfDetection {
  assetTag: string | null;
  assetType: string;
  description: string | null;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  evidence: string[];
  blockName: string | null;
  layer: string;
  source: 'INSERT' | 'TEXT' | 'CIRCLE' | 'ATTRIBUTE' | 'VISION';
  rawPosition: DxfPoint;
  needsAiClassification?: boolean;
  needsGeminiClassification?: boolean; // backward-compat alias
  /** 0-based sheet region index (lihat splitDxfRegions). */
  regionIndex: number;
  /** 1-based halaman P&ID (= regionIndex + 1). */
  pidPage: number;
  size?: string | null;
}

export interface DxfRegionInfo {
  index: number;
  pidPage: number;
  entityCount: number;
  extents: DxfPageExtents;
  textTagsFound: number;
}

/** $INSUNITS meaning for evidence/diagnostics. */
export function dxfUnitsLabel(units: number): string {
  const map: Record<number, string> = {
    0: 'unitless', 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm',
    6: 'm', 7: 'km', 8: 'µin', 9: 'mil', 10: 'yd', 11: 'Å', 12: 'nm',
    13: 'µm', 14: 'dm', 15: 'dam', 16: 'hm', 17: 'Gm', 18: 'AU', 19: 'ly', 20: 'pc',
  };
  return map[units] ?? `unit-${units}`;
}

/**
 * Human world-size evidence, anchored to label height (the drawing's own
 * "mm"): `224×224u (~4.5× label)`. Lets reviewers audit physical plausibility.
 */
export function worldDimsEvidence(
  wUnits: number,
  hUnits: number,
  medianTextHeight: number | undefined,
  unitsLabel: string,
): string {
  const w = Math.round(wUnits), h = Math.round(hUnits);
  if (medianTextHeight && medianTextHeight > 0) {
    const f = (n: number) => (Math.round((n / medianTextHeight) * 10) / 10).toString();
    return `size ${w}×${h}${unitsLabel === 'unitless' ? 'u' : unitsLabel} (~${f(Math.max(wUnits, hUnits))}× label)`;
  }
  return `size ${w}×${h}${unitsLabel === 'unitless' ? 'u' : unitsLabel}`;
}

export interface DxfDetectionResult {
  detections: DxfDetection[];
  page: 1;
  regions: DxfRegionInfo[];
  /** $INSUNITS of the file (0 = unitless). */
  units: number;
  parseStats: {
    totalEntities: number;
    insertCount: number;
    textCount: number;
    circleCount: number;
    lineCount: number;
    unmatchedInserts: number;
    aiCandidates: number;
    geminiCandidates: number; // backward-compat alias
    textTagsFound: number;
    /** Symbol stroke clusters formed (Blok 2.1). */
    clusterCount: number;
  };
}

// ── Layer profile helpers ─────────────────────────────────────────────────────

/** "SLON-...$0$Level 6" → "Level 6" */
function shortLayer(layer: string): string {
  const idx = layer.lastIndexOf('$0$');
  return idx >= 0 ? layer.slice(idx + 3).trim() : layer.trim();
}

/** "SLON-...$0$GAF208" → "GAF208" */
function stripXrefPrefix(blockName: string): string {
  const idx = blockName.indexOf('$0$');
  return idx >= 0 ? blockName.slice(idx + 3).trim() : blockName.trim();
}

/**
 * Build a layer lookup map from profiles.
 * Falls back to built-in heuristics for unregistered layers.
 */
export function buildLayerLookup(profiles: LayerProfile[]): Map<string, LayerProfile> {
  const map = new Map<string, LayerProfile>();
  for (const p of profiles) {
    map.set(p.layer_name.toLowerCase(), p);
    map.set(p.short_name.toLowerCase(), p);
  }
  return map;
}

/** Default heuristic when no profile found. */
function heuristicCategory(layer: string): LayerProfile['category'] {
  const sl = shortLayer(layer).toLowerCase();

  // ── Suffix-based ignore: any layer ending in (Construction), (Markup),
  // (Revision), or _constr/_rev etc. — these are redline/revision overlays,
  // never authoritative source-of-truth tags.
  if (/\(construction\)|\(constr\)|\(markup\)|\(revision\)|\(rev\)|\(redline\)$/i.test(sl)) return 'ignore';
  if (/_construction$|_constr$|_markup$|_revision$|_rev$|_redline$/i.test(sl)) return 'ignore';

  // Explicit ignore: cloud revisions, title block, paper/model space markers
  if (/^cloud|revision cloud|^revision$/i.test(sl)) return 'ignore';
  if (/^title|border|frame|sheet|^north|^scale/i.test(sl)) return 'title';
  // Blank / spacer layers
  if (/^blank$|^spacer$/i.test(sl)) return 'ignore';

// ... heuristicCategory (baris 173) ...
  // Known primary tag layers (equipment & instrument tags)
  if (/level\s*6/i.test(sl)) return 'tag';       // equipment tags (primary)
  if (/level\s*4/i.test(sl)) return 'tag';        // instrument/valve tags
  if (/level\s*40/i.test(sl)) return 'tag';       // also equipment
  if (/equip.*tag|p.*tag|tag\b/i.test(sl)) return 'tag';  // Known equipment/symbol geometry layers in P&ID standards
  if (/level\s*5/i.test(sl)) return 'equipment';  // pump/vessel circles
  if (/level\s*3/i.test(sl)) return 'equipment';  // equipment polyline outlines
  if (/valve/i.test(sl)) return 'equipment';       // valve symbols
  if (/water/i.test(sl)) return 'equipment';
  // Level N pattern — only pure "Level N" without any suffix
  const levelMatch = sl.match(/^level\s*(\d+)$/);
  if (levelMatch) {
    const n = parseInt(levelMatch[1]);
    if (n >= 4 && n <= 8) return 'tag';
    if (n === 40 || n === 80) return 'tag';
    return 'description';
  }
  if (/description|desc|service|duty/i.test(sl)) return 'description';
  if (/pipe|piping|process|line|flow/i.test(sl)) return 'pipe';
  if (/equip|vessel|pump|valve|symbol|mech/i.test(sl)) return 'equipment';
  if (/text|annot|label|note|dim/i.test(sl)) return 'description';
  return 'unknown';
}

export function getLayerProfile(layer: string, lookup: Map<string, LayerProfile>): LayerProfile {
  const sl = shortLayer(layer);
  return (
    lookup.get(layer.toLowerCase()) ??
    lookup.get(sl.toLowerCase()) ??
    {
      layer_name: layer,
      short_name: sl,
      category: heuristicCategory(layer),
      tag_priority: heuristicCategory(layer) === 'tag' ? 4 : 99,
    }
  );
}

function isTagLayer(layer: string, lookup: Map<string, LayerProfile>): boolean {
  const p = getLayerProfile(layer, lookup);
  return p.category === 'tag';
}

function isDescLayer(layer: string, lookup: Map<string, LayerProfile>): boolean {
  const p = getLayerProfile(layer, lookup);
  return p.category === 'tag' || p.category === 'description';
}

/**
 * Layer yang datanya tidak boleh jadi sumber tag/deskripsi:
 * construction/redline overlay, title block, border, revision cloud.
 * Sebelumnya layer ini hanya "dideprioritas" sehingga tag sampah
 * (mis. V-0601 di "Level 40(Construction)") tetap masuk DB sebagai duplikat.
 */
export function isExcludedLayer(layer: string, lookup: Map<string, LayerProfile>): boolean {
  const cat = getLayerProfile(layer, lookup).category;
  return cat === 'ignore' || cat === 'title';
}

function tagLayerPriority(layer: string, lookup: Map<string, LayerProfile>): number {
  const p = getLayerProfile(layer, lookup);
  if (p.category !== 'tag') return 99;
  // Construction/revision layers deprioritized
  const sl = shortLayer(layer).toLowerCase();
  if (sl.includes('construction')) return 50;
  return p.tag_priority;
}

// ── Tag validation — Legend-driven ───────────────────────────────────────────

const FALLBACK_TAG_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2}$/i;
const LOOSE_TAG_RE = /^[A-Z]{1,4}-[A-Z0-9]{1,6}-[A-Z0-9]{1,6}$/i;
/** 3-part tags: LCV-101-A, FIC-2101-01, XV-001-A */
const THREE_PART_TAG_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[-_][A-Z0-9]{1,4}$/i;

/** Texts that look like pipe specs, not equipment tags — reject these */
const PIPE_SPEC_RE = /^[\d]+["'\/][-x×]?[\d]*["'#\s]|^[\d]+"[-x×][\d]+"$|#\d*$|^\d+"-\d+#$/i;

/** Short status codes — not equipment tags */
const STATUS_RE = /^(RUN|STOP|R-ST|XI|M|I|B|N\/A|TBD)$/i;

function buildLegendTagRegexes(legend: LegendSymbolRef[]): RegExp[] {
  const out: RegExp[] = [];
  for (const sym of legend) {
    if (!sym.tag_pattern) continue;
    try {
      const esc = sym.tag_pattern
        .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
        .replace(/#/g, '\\d')
        .replace(/\*/g, '.*');
      out.push(new RegExp(`^${esc}$`, 'i'));
    } catch { /* skip malformed */ }
  }
  return out;
}

function isTagText(text: string, legendRegexes: RegExp[]): boolean {
  const t = text.trim();
  // Min 3 chars (e.g. "P-1"), max 28 to allow longer instrument tags (FICSL-2101A/B)
  if (!t || t.length < 3 || t.length > 28) return false;
  // Reject pipe specs (e.g. 1"-800#, 10"-150#, 2"x8")
  if (PIPE_SPEC_RE.test(t)) return false;
  // Reject status labels
  if (STATUS_RE.test(t)) return false;
  // Reject if starts with digit (pipe size like 3/4"DRAIN)
  if (/^\d/.test(t)) return false;
  // Must start with a letter
  if (!/^[A-Z]/i.test(t)) return false;
  // Legend patterns first
  for (const re of legendRegexes) {
    if (re.test(t)) return true;
  }
  // Fallback: standard formats
  return FALLBACK_TAG_RE.test(t) || LOOSE_TAG_RE.test(t) || THREE_PART_TAG_RE.test(t);
}

// ── Type resolution — Legend-driven ONLY ──────────────────────────────────────
// DILARANG menebak tipe dari prefix tag (sumber "tag ngaco": V→Valve padahal
// vessel, dll). Tanpa legend match → 'UNKNOWN' + needsGeminiClassification,
// lalu rule-validator (validateDetection) atau review manusia yang memutuskan.

export const UNKNOWN_ASSET_TYPE = 'UNKNOWN';

// ── Legend matching ───────────────────────────────────────────────────────────

function buildTagRegex(pattern: string): RegExp {
  const esc = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
    .replace(/#/g, '\\d')
    .replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

const UNCLASSIFIED_TYPES = new Set(['', 'other', 'unknown', 'n/a', '-', 'misc']);

function matchTagToLegend(tag: string, legend: LegendSymbolRef[]): LegendSymbolRef | null {
  // Exact pattern match first — skipping unclassified scan output ("other")
  // so it can never shadow real standard matches.
  for (const sym of legend) {
    if (!sym.tag_pattern) continue;
    if (UNCLASSIFIED_TYPES.has((sym.asset_type ?? '').trim().toLowerCase())) continue;
    try { if (buildTagRegex(sym.tag_pattern).test(tag)) return sym; } catch { /* skip */ }
  }

  // Fallback 1: match tag prefix (letters before first dash/number) against aliases.
  // e.g. tag "GV-068" → prefix "GV" → match alias "GV" in Gate Valve symbol.
  const prefixMatch = tag.match(/^([A-Za-z]{1,6})/);
  const prefix = prefixMatch?.[1]?.toUpperCase() ?? '';
  if (prefix.length >= 1) {
    for (const sym of legend) {
      if (UNCLASSIFIED_TYPES.has((sym.asset_type ?? '').trim().toLowerCase())) continue;
      const aliases: string[] = Array.isArray(sym.aliases)
        ? (sym.aliases as string[]).map((a: string) => a.trim().toUpperCase())
        : [];
      if (aliases.includes(prefix)) return sym;
      // Also try symbol_name starts-with prefix
      const sn = (sym.symbol_name ?? '').toUpperCase();
      if (sn && (sn === prefix || sn.startsWith(prefix + ' ') || sn.startsWith(prefix + '-'))) return sym;
    }
  }

  // TANPA fallback lebih jauh: tidak ada pola dan tidak ada alias cocok → null (UNKNOWN).
  return null;
}

function tokenise(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function levenshteinSim(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const curr = a[i-1] === b[j-1] ? dp[j-1] : Math.min(dp[j-1], dp[j], prev) + 1;
      dp[j-1] = prev; prev = curr;
    }
    dp[lb] = prev;
  }
  return 1 - dp[lb] / Math.max(la, lb);
}

function matchBlockSuffixToLegend(suffix: string, legend: LegendSymbolRef[]): LegendSymbolRef | null {
  if (!suffix || !legend.length) return null;
  const bt = tokenise(suffix);
  const suffixUpper = suffix.toUpperCase();

  // Pass 1: exact alias match (fastest, highest confidence)
  for (const sym of legend) {
    if (UNCLASSIFIED_TYPES.has((sym.asset_type ?? '').trim().toLowerCase())) continue;
    const aliases: string[] = Array.isArray(sym.aliases)
      ? (sym.aliases as string[]).map((a: string) => a.trim().toUpperCase())
      : [];
    if (aliases.includes(suffixUpper)) return sym;
  }

  // Pass 2: fuzzy token match — lowered threshold 0.75 → 0.65 for better recall
  let best: { sym: LegendSymbolRef; score: number } | null = null;
  for (const sym of legend) {
    if (UNCLASSIFIED_TYPES.has((sym.asset_type ?? '').trim().toLowerCase())) continue;
    const cands = [sym.symbol_name ?? '', sym.asset_type, ...(sym.aliases ?? [])].filter(Boolean);
    for (const cand of cands) {
      const ct = tokenise(cand);
      let score = 0;
      for (const b of bt) for (const c of ct) score = Math.max(score, levenshteinSim(b, c));
      if (score >= 0.65 && (!best || score > best.score)) best = { sym, score };
    }
  }
  return best?.sym ?? null;
}

// ── Bbox helpers ──────────────────────────────────────────────────────────────

function estimateBbox(
  pos: DxfPoint,
  extents: DxfParseResult['extents'],
  ratio = 0.025,
): DxfDetection['bbox'] {
  const hw = extents.width * ratio, hh = extents.height * ratio;
  const center = dxfToNorm(pos, extents);
  const minBboxSize = env.DXF_MIN_BBOX_SIZE ?? 12;
  const w = Math.max(minBboxSize, Math.round((hw * 2 / extents.width) * 1000));
  const h = Math.max(minBboxSize, Math.round((hh * 2 / extents.height) * 1000));
  const x = Math.max(0, center.x - Math.round(w / 2));
  const y = Math.max(0, center.y - Math.round(h / 2));
  // Clamp agar tidak overflow 1000 (viewer/SVG overlay berasumsi x+w ≤ 1000).
  return { x, y, width: Math.min(w, 1000 - x), height: Math.min(h, 1000 - y) };
}

interface RawBbox { minX: number; minY: number; maxX: number; maxY: number }

function computeRealBbox(
  ins: DxfInsertEntity,
  blocks: Record<string, unknown>,
  depth = 0,
): RawBbox | null {
  if (depth > 4) return null;
  const blk = (blocks as Record<string, { entities?: unknown[] }>)?.[ins.blockName];
  const subs = blk?.entities;
  if (!Array.isArray(subs) || subs.length === 0) return null;

  const rotRad = (ins.rotation * Math.PI) / 180;
  const cosA = Math.cos(rotRad), sinA = Math.sin(rotRad);
  const scX = Number(ins.xScale ?? 1), scY = Number(ins.yScale ?? 1);
  const ox = ins.position.x, oy = ins.position.y;
  const tf = (lx: number, ly: number) => ({
    x: ox + (lx * cosA - ly * sinA) * scX,
    y: oy + (lx * sinA + ly * cosA) * scY,
  });

  const box: RawBbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let has = false;
  const add = (x: number, y: number) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (x < box.minX) box.minX = x; if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x; if (y > box.maxY) box.maxY = y;
    has = true;
  };

  for (const raw of subs) {
    const e = raw as Record<string, unknown>;
    const t = String(e.type ?? '').toUpperCase();
    if (t === 'LINE') {
      const s = e.start as {x?:number;y?:number}|undefined, en = e.end as {x?:number;y?:number}|undefined;
      if (s && en) { const p1 = tf(s.x??0,s.y??0), p2 = tf(en.x??0,en.y??0); add(p1.x,p1.y); add(p2.x,p2.y); }
    } else if (t === 'LWPOLYLINE' || t === 'POLYLINE') {
      const verts = (e.vertices as Array<{x?:number;y?:number}> | undefined) ?? [];
      for (const v of verts) {
        const p = tf(v.x??0,v.y??0); add(p.x,p.y);
      }
    } else if (t === 'CIRCLE' || t === 'ARC') {
      const c = e.center as {x?:number;y?:number}|undefined;
      const r = Number(e.radius??0) * Math.max(Math.abs(scX), Math.abs(scY));
      if (c && r > 0) { const cp = tf(c.x??0,c.y??0); add(cp.x-r,cp.y-r); add(cp.x+r,cp.y+r); }
    } else if (t === 'INSERT') {
      const ni: DxfInsertEntity = {
        kind: 'INSERT',
        blockName: String(e.name??e.block??''),
        position: tf((e.position as {x?:number}|undefined)?.x??0, (e.position as {y?:number}|undefined)?.y??0),
        layer: String(e.layer??ins.layer),
        xScale: Number(e.xScale??1)*scX,
        yScale: Number(e.yScale??1)*scY,
        rotation: Number(e.rotation??0)+ins.rotation,
        attributes: [],
      };
      const nb = computeRealBbox(ni, blocks, depth+1);
      if (nb) { add(nb.minX,nb.minY); add(nb.maxX,nb.maxY); }
    }
  }
  return has ? box : null;
}

function rawBboxToNorm(raw: RawBbox, extents: DxfParseResult['extents']): DxfDetection['bbox'] {
  const PAD = 0.06;
  const rw = raw.maxX-raw.minX, rh = raw.maxY-raw.minY;
  const tl = dxfToNorm({ x: raw.minX-rw*PAD, y: raw.maxY+rh*PAD }, extents);
  const br = dxfToNorm({ x: raw.maxX+rw*PAD, y: raw.minY-rh*PAD }, extents);
  const x = Math.max(0, Math.min(999, tl.x));
  const y = Math.max(0, Math.min(999, tl.y));
  return {
    x, y,
    width: Math.max(8, Math.min(1000-x, Math.abs(br.x-tl.x))),
    height: Math.max(8, Math.min(1000-y, Math.abs(br.y-tl.y))),
  };
}

function expandBbox(
  bbox: DxfDetection['bbox'],
  pt: DxfPoint,
  extents: DxfParseResult['extents'],
): DxfDetection['bbox'] {
  const np = dxfToNorm(pt, extents);
  const x1 = Math.min(bbox.x, np.x-5), y1 = Math.min(bbox.y, np.y-5);
  const x2 = Math.max(bbox.x+bbox.width, np.x+5), y2 = Math.max(bbox.y+bbox.height, np.y+5);
  const x = Math.max(0, x1), y = Math.max(0, y1);
  return { x, y, width: Math.min(x2-x1, 1000-x), height: Math.min(y2-y1, 1000-y) };
}

/** Only merge descriptor text when it is spatially local to symbol bbox. */
export function shouldExpandBboxWithDescription(
  bbox: DxfDetection['bbox'],
  point: DxfPoint,
  extents: DxfParseResult['extents'],
): boolean {
  const p = dxfToNorm(point, extents);
  const dx = Math.max(bbox.x - p.x, 0, p.x - (bbox.x + bbox.width));
  const dy = Math.max(bbox.y - p.y, 0, p.y - (bbox.y + bbox.height));
  const localLimit = Math.max(24, Math.max(bbox.width, bbox.height) * 2.5);
  return Math.hypot(dx, dy) <= localLimit;
}

// ── XREF bbox proxy from nearby LINE/ARC/CIRCLE entities (#6) ────────────────

/**
 * When computeRealBbox returns null (XREF block geometry missing),
 * collect raw LINE / CIRCLE / ARC / SPLINE / ELLIPSE entities that are
 * spatially close to `pos` and form a bbox from their geometry.
 *
 * proximityFraction: fraction of drawing size to use as search radius.
 * Defaults to 0.04 (4%). Caller should pass a fraction derived from extents
 * for scale-independent behaviour.
 */
function proxyBboxFromNearbyEntities(
  pos: DxfPoint,
  entities: DxfParseResult['entities'],
  extents: DxfParseResult['extents'],
  proximityFraction = 0.04,
  lookup?: Map<string, LayerProfile>,
  /** Extents untuk normalisasi 0-1000. Default = extents (perilaku lama);
   *  isi dengan globalExtents saat dipanggil dalam scope region. */
  normExtents?: DxfParseResult['extents'],
  /** Tinggi teks median scope — ambang radius relatif huruf (robust multi-sheet). */
  medianTextHeight?: number,
): DxfDetection['bbox'] | null {
  const normExt = normExtents ?? extents;
  const drawingSize = Math.max(extents.width, extents.height);
  // Ambang radius lingkaran equipment: relatif huruf bila diketahui.
  let circMinR = drawingSize * 0.001;
  let circMaxR = drawingSize * 0.05;
  if (medianTextHeight && medianTextHeight > 0) {
    circMinR = medianTextHeight * 0.25;
    circMaxR = medianTextHeight * 40;
  }
  // Clamp fraction: min 0.01 (1%), max 0.10 (10%) to avoid pathological radii
  const clampedFraction = Math.max(0.01, Math.min(0.10, proximityFraction));
  const proximity = drawingSize * clampedFraction;

  // Priority 1: find nearest CIRCLE from an equipment/symbol layer within 2× proximity.
  const equipCircle = entities
    .filter((e): e is DxfCircleEntity => e.kind === 'CIRCLE')
    .filter(e => {
      if (lookup) {
        const cat = getLayerProfile(e.layer, lookup).category;
        if (cat === 'ignore' || cat === 'pipe' || cat === 'title') return false;
      }
      return e.radius >= circMinR && e.radius <= circMaxR;
    })
    .map(e => ({ e, d: Math.hypot(e.center.x - pos.x, e.center.y - pos.y) }))
    .filter(({ d, e }) => d <= proximity * 2 + e.radius)
    .sort((a, b) => a.d - b.d)[0];

  if (equipCircle) {
    const { e } = equipCircle;
    const PAD = 1.15;
    const raw: RawBbox = {
      minX: e.center.x - e.radius * PAD,
      minY: e.center.y - e.radius * PAD,
      maxX: e.center.x + e.radius * PAD,
      maxY: e.center.y + e.radius * PAD,
    };
    return rawBboxToNorm(raw, normExt);
  }

  // Priority 2: nearest ELLIPSE (vessel oval outlines)
  const equipEllipse = entities
    .filter((e): e is DxfEllipseEntity => e.kind === 'ELLIPSE')
    .filter(e => {
      if (lookup) {
        const cat = getLayerProfile(e.layer, lookup).category;
        if (cat === 'ignore' || cat === 'pipe' || cat === 'title') return false;
      }
      return e.majorAxisLength >= circMinR && e.majorAxisLength <= circMaxR * 1.6;
    })
    .map(e => ({ e, d: Math.hypot(e.center.x - pos.x, e.center.y - pos.y) }))
    .filter(({ d, e }) => d <= proximity * 2 + e.majorAxisLength)
    .sort((a, b) => a.d - b.d)[0];

  if (equipEllipse) {
    const { e } = equipEllipse;
    const PAD = 1.15;
    const minorLen = e.majorAxisLength * e.minorAxisRatio;
    const raw: RawBbox = {
      minX: e.center.x - e.majorAxisLength * PAD,
      minY: e.center.y - minorLen * PAD,
      maxX: e.center.x + e.majorAxisLength * PAD,
      maxY: e.center.y + minorLen * PAD,
    };
    return rawBboxToNorm(raw, normExt);
  }

  // Priority 3: collect nearby LINE/POLYLINE/ARC/SPLINE geometry and build bbox.
  // Layer filter: garis pipa / construction / title DIABAIKAN — sebelumnya
  // segmen pipa panjang yang lewat dekat tag ikut membentuk bbox selongsong.
  const layerOk = (layer: string): boolean => {
    if (!lookup) return true;
    const cat = getLayerProfile(layer, lookup).category;
    return cat !== 'pipe' && cat !== 'ignore' && cat !== 'title';
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let has = false;
  const add = (x: number, y: number) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    has = true;
  };

  for (const e of entities) {
    if (!layerOk(e.layer)) continue;
    if (e.kind === 'ARC') {
      const d = Math.hypot(e.center.x - pos.x, e.center.y - pos.y);
      if (d <= proximity + e.radius) {
        add(e.center.x - e.radius, e.center.y - e.radius);
        add(e.center.x + e.radius, e.center.y + e.radius);
      }
    } else if (e.kind === 'LINE') {
      const dmid = Math.hypot((e.start.x+e.end.x)/2 - pos.x, (e.start.y+e.end.y)/2 - pos.y);
      if (dmid <= proximity) { add(e.start.x,e.start.y); add(e.end.x,e.end.y); }
    } else if (e.kind === 'LWPOLYLINE') {
      for (const v of e.vertices) {
        if (Math.hypot(v.x - pos.x, v.y - pos.y) <= proximity) add(v.x, v.y);
      }
    } else if (e.kind === 'SPLINE') {
      // Use control points bounding box if any are near
      const nearPts = e.controlPoints.filter(
        p => Math.hypot(p.x - pos.x, p.y - pos.y) <= proximity,
      );
      if (nearPts.length > 0) {
        for (const p of nearPts) add(p.x, p.y);
      }
    }
  }

  if (!has) return null;
  const raw: RawBbox = { minX, minY, maxX, maxY };
  // Compactness guard: segmen pipa lurus itu panjang-tipis (aspek ratusan).
  // Simbol equipment wajar kompak — tolak cluster selongsong agar tidak jadi bbox.
  const gw = raw.maxX - raw.minX, gh = raw.maxY - raw.minY;
  if (gw > 0 && gh > 0) {
    const aspect = Math.max(gw, gh) / Math.min(gw, gh);
    if (aspect > 8) return null;
  }
  return rawBboxToNorm(raw, normExt);
}

// ── Confidence fusion (#8) ────────────────────────────────────────────────────

interface FusionSignals {
  /** Tag matched a legend pattern exactly */
  legendTagMatch: boolean;
  /** Tag matched by prefix inference only */
  legendTypeMatch: boolean;
  /** Tag came from known tag layer */
  tagLayerKnown: boolean;
  /** Tag layer priority (1=best) */
  tagLayerPriority: number;
  /** Nearest INSERT was found within radius */
  insertFound: boolean;
  /** Bbox computed from actual geometry (not estimated) */
  bboxFromGeometry: boolean;
  /** Description text paired */
  descriptionPaired: boolean;
  /** Block suffix matched legend */
  blockSuffixMatch: boolean;
  /** Source: TEXT is more reliable than INSERT-only */
  sourceIsText: boolean;
}

function fuseConfidence(base: number, signals: FusionSignals): number {
  let score = base;
  if (signals.legendTagMatch) score += 0.10;
  if (signals.legendTypeMatch) score += 0.04;
  if (signals.tagLayerKnown) score += 0.05;
  if (signals.tagLayerPriority <= 2) score += 0.03;
  if (signals.insertFound) score += 0.03;
  if (signals.bboxFromGeometry) score += 0.04;
  if (signals.descriptionPaired) score += 0.03;
  if (signals.blockSuffixMatch) score += 0.05;
  if (signals.sourceIsText) score += 0.02;
  // Penalties
  if (!signals.insertFound && !signals.bboxFromGeometry) score -= 0.05;
  if (!signals.tagLayerKnown) score -= 0.05;
  return Math.max(0.30, Math.min(0.99, score));
}

// ── Adaptive spatial association (#5) ────────────────────────────────────────

/**
 * Compute adaptive proximity threshold based on local entity density.
 * Samples nearby TEXT entities to estimate median spacing, then uses
 * 1.5× median as the association radius.
 *
 * Falls back to `fallbackFraction * extentSize` if not enough neighbors.
 */
function adaptiveMaxDist(
  pos: DxfPoint,
  tagTexts: DxfTextEntity[],
  extents: DxfParseResult['extents'],
  fallbackFraction = 0.05,
): number {
  const fallback = Math.max(extents.width, extents.height) * fallbackFraction;
  if (tagTexts.length < 4) return fallback;

  // Find distances to nearest 10 tag texts
  const dists = tagTexts
    .map(t => Math.hypot(t.position.x - pos.x, t.position.y - pos.y))
    .filter(d => d > 0)
    .sort((a, b) => a - b)
    .slice(0, 10);

  if (dists.length < 2) return fallback;

  // Median spacing
  const med = dists[Math.floor(dists.length / 2)];
  return Math.max(med * 1.5, fallback * 0.3);
}

// ── Distance ──────────────────────────────────────────────────────────────────

function dist(a: DxfPoint, b: DxfPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Deduplication ─────────────────────────────────────────────────────────────

// Default merge threshold in normalized 0-1000 space.
// Two detections of the same tag within this distance are considered the same equipment.
// Caller may pass a text-height-anchored value (mm-anchored precision, Blok 8).
const DEFAULT_MERGE_DIST_NORM = 40;

function deduplicate(
  detections: DxfDetection[],
  lookup: Map<string, LayerProfile>,
  mergeDistNorm: number = DEFAULT_MERGE_DIST_NORM,
): DxfDetection[] {
  const sorted = [...detections].sort((a, b) => {
    if (a.source !== b.source) {
      // TEXT > CIRCLE > INSERT > VISION (vision pelengkap, bukan primer)
      const order: Record<DxfDetection['source'], number> = { TEXT: 0, CIRCLE: 1, ATTRIBUTE: 2, INSERT: 3, VISION: 4 };
      return (order[a.source] ?? 9) - (order[b.source] ?? 9);
    }
    const pa = tagLayerPriority(a.layer, lookup), pb = tagLayerPriority(b.layer, lookup);
    if (pa !== pb) return pa - pb;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const kept: DxfDetection[] = [];
  for (const det of sorted) {
    const cx = det.bbox.x + det.bbox.width / 2;
    const cy = det.bbox.y + det.bbox.height / 2;
    const dup = kept.find(k => {
      if (det.assetTag && k.assetTag && det.assetTag === k.assetTag) {
        const kx = k.bbox.x + k.bbox.width / 2, ky = k.bbox.y + k.bbox.height / 2;
        return Math.hypot(cx - kx, cy - ky) <= mergeDistNorm;
      }
      if (!det.assetTag && !k.assetTag && det.blockName && det.blockName === k.blockName) {
        const kx = k.bbox.x + k.bbox.width / 2, ky = k.bbox.y + k.bbox.height / 2;
        return Math.hypot(cx - kx, cy - ky) <= 6;
      }
      return false;
    });
    if (!dup) kept.push(det);
  }
  return kept;
}

// ── ATTRIB picker ─────────────────────────────────────────────────────────────

const EQUIP_TAG_ATTRIB_NAMES = new Set([
  // Standard / common
  'TAG','TAGNO','TAG_NO','TAG NO','EQUIP_TAG','EQUIPMENT_TAG',
  'EQUIP_NO','EQUIPMENT_NO','ITEM_NO','ITEM','INST_TAG','INSTRUMENT_TAG',
  'ID','ITEM_TAG','TAG_NUMBER','TAGNUMBER','INSTRUMENT_NO','VALVE_TAG','PUMP_TAG',
  // Extended — plant/contractor variations
  'ASSET_TAG','ASSET_NO','ASSET_ID','ASSET_NUMBER',
  'LOOP_TAG','LOOP_NO','LOOP_ID',
  'KKS','KKS_NO',               // German KKS coding
  'FKZ','FUNKTIONSTEIL',        // German P&ID
  'PROCESS_TAG','PROCESS_NO',
  'LINE_NO','LINE_NUMBER','LINE_TAG',
  'SIGNAL_TAG','SIGNAL_NO',
  'IDENT','IDENTIFIK',
  'POSITION','POS','POS_NO',
  'NUMBER','NO',                // last resort — only if value matches tag pattern
  'FUNCTION','FUNCTION_NO',
]);

function pickAttribTag(attribs: Array<{tag:string;value:string}>): string | null {
  if (!attribs?.length) return null;
  const cleaned = attribs
    .map(a => ({ tag: a.tag.trim().toUpperCase(), value: stripMtext(a.value).trim() }))
    .filter(a => a.value);
  if (!cleaned.length) return null;
  for (const a of cleaned) if (EQUIP_TAG_ATTRIB_NAMES.has(a.tag)) return a.value;
  const TL = /^[A-Z]{1,6}[-_/][A-Z0-9]{1,10}([A-Z0-9/_.-]*)?$/i;
  for (const a of cleaned) if (TL.test(a.value)) return a.value;
  return cleaned[0]?.value ?? null;
}

// ── CIRCLE/ARC entity detection (#3) ─────────────────────────────────────────

interface CircleCandidate {
  center: DxfPoint;
  radius: number;
  layer: string;
  source: 'CIRCLE' | 'ARC';
}

/** Median tinggi teks (unit DXF) — skala lokal untuk ambang radius simbol. */
export function medianTextHeightOf(texts: DxfTextEntity[]): number | undefined {
  const hs = texts.map((t) => t.height).filter((h) => h > 0).sort((a, b) => a - b);
  if (!hs.length) return undefined;
  return hs[Math.floor(hs.length / 2)];
}

/**
 * Collect standalone CIRCLE and ARC entities that are plausible equipment symbols.
 * Filter by radius range (not too tiny = noise, not too huge = title border).
 */
function collectCircleCandidates(
  entities: DxfParseResult['entities'],
  extents: DxfParseResult['extents'],
  lookup: Map<string, LayerProfile>,
  /** Tinggi teks median scope (unit DXF). Bila ada, ambang radius relatif
   *  terhadap ukuran huruf — jauh lebih robust daripada fraksi span global
   *  yang runtuh saat file berisi banyak sheet (span raksasa). */
  medianTextHeight?: number,
): CircleCandidate[] {
  const drawingSize = Math.max(extents.width, extents.height);
  // Default fraksi (fallback bila tinggi teks tidak diketahui)
  let minR = drawingSize * 0.003;
  let maxR = drawingSize * 0.08;
  if (medianTextHeight && medianTextHeight > 0) {
    // Simbol equipment wajar: 0.25×–40× tinggi huruf labelnya.
    minR = medianTextHeight * 0.25;
    maxR = medianTextHeight * 40;
  }

  const candidates: CircleCandidate[] = [];
  for (const e of entities) {
    if (e.kind === 'CIRCLE') {
      const prof = getLayerProfile(e.layer, lookup);
      if (prof.category === 'ignore' || prof.category === 'pipe' || prof.category === 'title') continue;
      if (e.radius >= minR && e.radius <= maxR) {
        candidates.push({ center: e.center, radius: e.radius, layer: e.layer, source: 'CIRCLE' });
      }
    } else if (e.kind === 'ARC') {
      const prof = getLayerProfile(e.layer, lookup);
      if (prof.category === 'ignore' || prof.category === 'pipe' || prof.category === 'title') continue;
      // Include arcs that are large enough to be symbol outlines (>90°).
      // 180° threshold was too strict — valve/nozzle arcs can be 90-179°.
      let span = e.endAngle - e.startAngle;
      if (span <= 0) span += 360;
      if (span >= 90 && e.radius >= minR && e.radius <= maxR) {
        candidates.push({ center: e.center, radius: e.radius, layer: e.layer, source: 'ARC' });
      }
    }
  }
  console.log("Candidate circles length:", candidates.length);
  return candidates;
}

// ── Region conflict marking ───────────────────────────────────────────────────
// Tag yang sama muncul >1× dalam SATU region di posisi berjauhan (lolos dedup)
// bukan digabung diam-diam: tandai CONFLICT + penalti confidence agar manusia
// review. Beda region = sheet beda = legal, tidak ditandai.
function markRegionConflicts(detections: DxfDetection[], regionIndex: number): DxfDetection[] {
  const byTag = new Map<string, DxfDetection[]>();
  for (const d of detections) {
    if (!d.assetTag) continue;
    const key = d.assetTag.trim().toLowerCase();
    const list = byTag.get(key) ?? [];
    list.push(d);
    byTag.set(key, list);
  }
  for (const [tag, list] of byTag) {
    if (list.length < 2) continue;
    for (const d of list) {
      d.confidence = Math.max(0.30, d.confidence - 0.10);
      d.evidence.push(
        `CONFLICT: tag "${d.assetTag}" appears ${list.length}× in sheet region ${regionIndex + 1} — human review required`,
      );
    }
  }
  return detections;
}

// ── Confidence guard ──────────────────────────────────────────────────────────
// Bbox tanpa geometri asli (estimasi dari posisi tag) DILARANG tampil yakin:
// cap 0.55 + wajib vision/klasifikasi lanjutan.
function capEstimatedConfidence(confidence: number, bboxFromGeometry: boolean): number {
  return bboxFromGeometry ? confidence : Math.min(confidence, 0.55);
}

function isUsableTagCluster(
  cluster: { minX: number; minY: number; maxX: number; maxY: number; members: number },
  tag: DxfTextEntity,
  medianTextHeight?: number,
): boolean {
  // Lowered from 3 → 2: instrument bubbles (circle + 1 arc/line) are 2 items.
  if (cluster.members < 2) return false;
  if (!medianTextHeight || medianTextHeight <= 0) return true;
  const width = cluster.maxX - cluster.minX;
  const height = cluster.maxY - cluster.minY;
  const tagHeight = Math.max(tag.height, medianTextHeight * 0.5);
  // Lowered from 1.8× → 1.5×: slightly smaller symbol clusters are valid.
  return Math.max(width, height) >= tagHeight * 1.5;
}

// ── Description text helpers ─────────────────────────────────────────────────

const TAG_FRAGMENT_RE_SHARED = /\b[A-Z]{1,6}[-_][0-9]{2,6}\b/i;

/**
 * Collect candidate description texts from a set of entities.
 * Shared by TEXT-FIRST and ATTRIB pipelines.
 */
function buildDescTexts(
  allTexts: DxfTextEntity[],
  lookup: Map<string, LayerProfile>,
  legendTagRegexes: RegExp[],
  medTextH: number | undefined,
): DxfTextEntity[] {
  return allTexts.filter(t => {
    if (!isDescLayer(t.layer, lookup)) return false;
    if (isExcludedLayer(t.layer, lookup)) return false;
    const txt = t.text.trim();
    if (isTagText(t.text, legendTagRegexes)) return false;
    if (txt.length < 5 || txt.length > 80) return false;
    if (medTextH && t.height > medTextH * 3) return false;
    if (STATUS_RE.test(txt)) return false;
    if (TAG_FRAGMENT_RE_SHARED.test(txt)) return false;
    if (!txt.includes(' ') && txt.length < 8) return false;
    if (/^[~MBI\d]/.test(txt)) return false;
    if (/^['"(]/.test(txt)) return false;
    return true;
  });
}

/**
 * Find nearest description text to a position, within maxDist × radiusMultiplier.
 * Marks matched entity in pairedDescs to avoid double-pairing.
 */
function findNearestDesc(
  pos: DxfPoint,
  descTexts: DxfTextEntity[],
  pairedDescs: Set<DxfTextEntity>,
  maxDist: number,
  radiusMultiplier = 2,
): DxfTextEntity | null {
  const match = descTexts
    .filter(d => !pairedDescs.has(d))
    .map(d => ({ d, dist: dist(d.position, pos) }))
    .filter(({ dist: dd }) => dd <= maxDist * radiusMultiplier)
    .sort((a, b) => a.dist - b.dist)[0]?.d ?? null;
  if (match) pairedDescs.add(match);
  return match;
}

// ── Main detection ────────────────────────────────────────────────────────────

export function runDxfDetection(
  buffer: Buffer,
  legend: LegendSymbolRef[] = [],
  options: {
    maxAssocDistFraction?: number;
    layerProfiles?: LayerProfile[];
    adaptiveSpatial?: boolean;
    /** Pre-parsed DXF (Blok 9: hindari parse ganda file besar). */
    parsed?: DxfParseResult;
  } = {},
): DxfDetectionResult {
  const {
    maxAssocDistFraction = 0.05,
    layerProfiles = [],
    adaptiveSpatial = true,
    parsed: parsedOpt,
  } = options;

  const parsed = parsedOpt ?? parseDxf(buffer);
  const { blocks } = parsed;
  // Normalisasi bbox SELALU memakai extents global (seluruh file) agar mapping
  // 0-1000 → world di DxfViewer (GetBounds) tetap valid untuk semua region.
  const globalExtents = parsed.extents;
  const unitsLabel = dxfUnitsLabel(parsed.units);
  const regions = splitDxfRegions(parsed);

  // Build layer lookup (DB profiles + heuristic fallback)
  const lookup = buildLayerLookup(layerProfiles);

  // Build tag regexes from legend
  const legendTagRegexes = buildLegendTagRegexes(legend);

  const globalEntities = parsed.entities;
  const globalInserts = globalEntities.filter((e): e is DxfInsertEntity => e.kind === 'INSERT');
  const globalTexts = globalEntities.filter((e): e is DxfTextEntity => e.kind === 'TEXT' || e.kind === 'MTEXT');
  const lineCount = globalEntities.filter(e => e.kind === 'LINE' || e.kind === 'LWPOLYLINE').length;
  const globalCircleCount = collectCircleCandidates(globalEntities, globalExtents, lookup).length;

  // Detect pipeline type (global — satu file, satu pipeline)
  const DEST_LABEL_RE = /^(?:TO|FROM)\s+.+?\b([A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2})\s*$/i;
  const hasAttribs = globalInserts.some(i => i.attributes?.length > 0);
  const tagLayerTexts = globalTexts.filter(t =>
    isTagLayer(t.layer, lookup) && (isTagText(t.text, legendTagRegexes) || DEST_LABEL_RE.test(t.text.trim()))
  );
  const hasContinuationLabels = globalTexts.some((t) => /^(?:TO|FROM)\s+.+\b[A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2}\s*$/i.test(t.text.trim()));
  const isXrefBound = !hasAttribs && (tagLayerTexts.length > 0 || hasContinuationLabels || globalInserts.length === 0);

  const allDetections: DxfDetection[] = [];
  const regionsInfo: DxfRegionInfo[] = [];
  let unmatchedInserts = 0, aiCandidates = 0, textTagsFoundTotal = 0, circleCountTotal = 0, clusterCountTotal = 0;

  for (const region of regions) {
    // Scope lokal: jarak/radius asosiasi memakai extents region (densitas lokal),
    // normalisasi bbox tetap memakai globalExtents (kompatibilitas viewer).
    const entities = region.entities;
    const extents = region.extents;
    const regionIndex = region.index;
    const pidPage = region.index + 1;

    const inserts = entities.filter((e): e is DxfInsertEntity => e.kind === 'INSERT');
    const allTexts = entities.filter((e): e is DxfTextEntity => e.kind === 'TEXT' || e.kind === 'MTEXT');

    const detections: DxfDetection[] = [];

    // Skala lokal region: median tinggi huruf untuk ambang radius simbol.
    const medTextH = medianTextHeightOf(allTexts);

    // Collect circle/arc candidates
    const circleCandidates = collectCircleCandidates(entities, extents, lookup, medTextH);
    const circleCount = circleCandidates.length;
    circleCountTotal += circleCount;

    // Symbol stroke clusters (exact hulls — primary bbox source for tags).
    const symbolClusters = clusterSymbolGeometry(entities, extents, lookup, medTextH);
    clusterCountTotal += symbolClusters.length;

  if (isXrefBound) {
    // ════════════════════════════════════════════
    // TEXT-FIRST PIPELINE (XREF-bound drawings)
    // ════════════════════════════════════════════

    // Helper: check if a position is in the title block / border area.
    // P&ID title blocks are typically at the BOTTOM of the drawing sheet in
    // most standards (ISO, ANSI). Top area frequently contains equipment header
    // labels (P-0501, V-0601, etc.) — filtering those is wrong.
    // Only filter BOTTOM 3% (title block strip) and skip the top entirely.
    // Configurable via DXF_TITLE_STRIP_FRACTION env (default 0.03).
    const TITLE_STRIP_FRACTION = parseFloat(process.env.DXF_TITLE_STRIP_FRACTION ?? '0.03');
    const titleStripHeight = extents.height * TITLE_STRIP_FRACTION;
    const isInTitleStrip = (pos: DxfPoint): boolean => {
      // DXF Y: larger = higher on sheet. Bottom strip = pos.y near minY.
      const fromBottom = pos.y - extents.minY;
      return fromBottom < titleStripHeight;
    };

    // 1. Collect all tag texts from tag layers — excluding title block area
    // dan HARD-EXCLUDE layer construction/revision/title (sebelumnya lolos jadi duplikat).
    const tagTexts = allTexts.filter(t =>
      isTagLayer(t.layer, lookup) &&
      !isExcludedLayer(t.layer, lookup) &&
      isTagText(t.text, legendTagRegexes) &&
      !isInTitleStrip(t.position)
    );

    // 1b. Tier kedua: teks pola-tag di layer 'unknown' TAPI cocok pola legend
    // (recall untuk layer non-standar; base confidence lebih rendah).
    const unknownTierTags = allTexts.filter(t => {
      if (getLayerProfile(t.layer, lookup).category !== 'unknown') return false;
      if (isInTitleStrip(t.position)) return false;
      const txt = t.text.trim();
      if (!txt || txt.length < 3 || txt.length > 28) return false;
      return legendTagRegexes.length > 0 && legendTagRegexes.some(re => re.test(txt));
    });
    const lowTierSet = new Set<DxfTextEntity>(unknownTierTags);
    for (const ut of unknownTierTags) {
      if (!tagTexts.some(t => t === ut)) tagTexts.push(ut);
    }

    // 1c. Destination / off-page labels — e.g. "TO WASH TANK 1 T-0101"
    // These are flow-continuation arrows pointing to equipment on another sheet.
    // The tag appears at the END of the label text after a keyword like TO/FROM.
    // They are NOT equipment on this page, so they get:
    //   - source: 'TEXT' (same as normal tag text)
    //   - evidence note explaining they are referenced, not drawn here
    //   - confidence capped at 0.65 (below review threshold → always PENDING)
    // Excluded: title strip, excluded layers, texts already picked up as tagTexts.
    const alreadyTagSet = new Set(tagTexts.map(t => t.text.trim().toUpperCase()));
    const destLabelTags: Array<{ text: DxfTextEntity; extractedTag: string; labelText: string }> = [];
    for (const t of allTexts) {
      if (isExcludedLayer(t.layer, lookup)) continue;
      if (isInTitleStrip(t.position)) continue;
      const raw = t.text.trim();
      // Must be long enough to be a label (> 28 = too long for isTagText)
      if (raw.length <= 10) continue;
      const m = DEST_LABEL_RE.exec(raw);
      if (!m) continue;
      const extracted = m[1].trim();
      // Don't double-count tags already found via normal tag layer
      if (alreadyTagSet.has(extracted.toUpperCase())) continue;
      destLabelTags.push({ text: t, extractedTag: extracted, labelText: raw });
    }

    // 2. Description texts — layer ignore/title tidak boleh jadi deskripsi.
    const descTexts = buildDescTexts(allTexts, lookup, legendTagRegexes, medTextH);

    // 3. Deduplicate tag texts: same tag at same position across layers → keep best
    const dedupedTags: DxfTextEntity[] = [];
    const seenKey = new Map<string, { entity: DxfTextEntity; prio: number }>();
    // Grid cell size: 0.3% of drawing size — fine enough to separate tags but merge exact dupes
    const gridCell = Math.max(1, Math.max(extents.width, extents.height) * 0.003);

    for (const tt of tagTexts) {
      const tag = tt.text.trim();
      const pos = tt.position;
      const prio = tagLayerPriority(tt.layer, lookup);
      const gx = Math.round(pos.x / gridCell), gy = Math.round(pos.y / gridCell);
      const key = `${tag.toLowerCase()}|${gx}|${gy}`;
      const existing = seenKey.get(key);
      if (!existing) {
        seenKey.set(key, { entity: tt, prio });
        dedupedTags.push(tt);
      } else if (prio < existing.prio) {
        const idx = dedupedTags.indexOf(existing.entity);
        if (idx >= 0) dedupedTags[idx] = tt;
        seenKey.set(key, { entity: tt, prio });
      }
    }

    // 4. Build detections from deduped tag texts
    const pairedDescs = new Set<DxfTextEntity>();

    for (const tagTxt of dedupedTags) {
      const tag = tagTxt.text.trim();
      const pos = tagTxt.position;
      const sl = shortLayer(tagTxt.layer);

      // Adaptive max dist (#5)
      const maxDist = adaptiveSpatial
        ? adaptiveMaxDist(pos, dedupedTags, extents, maxAssocDistFraction)
        : Math.max(extents.width, extents.height) * maxAssocDistFraction;

      // Find nearest description — radius ketat (2×, bukan 4×) agar tidak
      // mencomot teks yang tidak berhubungan di gambar padat.
      const descMatch = findNearestDesc(pos, descTexts, pairedDescs, maxDist, 2);

      // Legend / type — TANPA tebak prefix. Tanpa match → UNKNOWN,
      // rule-validator / review manusia yang memutuskan.
      const legendMatch = matchTagToLegend(tag, legend);
      const assetType = legendMatch?.asset_type ?? UNKNOWN_ASSET_TYPE;
      const typeUnknown = !legendMatch;

      // Nearest INSERT for bbox — only non-skip blocks
      const skipSuffixesForBbox = /^(A\d+|Arrow|PAN\d*|Pan\d*|AnonymousCell|GAF\d*|R\d+|AROF|SLON|Model_Space|Paper_Space)/i;
      const insertRadius = medTextH
        ? Math.min(maxDist * 6, medTextH * 30)
        : maxDist * 6;
      const nearestIns = inserts
        .filter(i => !skipSuffixesForBbox.test(stripXrefPrefix(i.blockName)))
        .map(i => ({ i, d: dist(i.position, pos) }))
        .filter(({ d }) => d <= insertRadius)
        .sort((a, b) => a.d - b.d)[0]?.i ?? null;

      let bbox: DxfDetection['bbox'];
      const bboxEvid: string[] = [];
      let bboxFromGeometry = false;

      // Primary strategy: nearest symbol stroke cluster (exact hull).
      // Falls back to radius-grab proxy only when no cluster is near.
      // Cap association by local text scale. Sparse sheets can make adaptive
      // spacing huge; a tag must not steal geometry from another area.
      const symbolAssociationDist = medTextH
        ? Math.min(maxDist * 3, medTextH * 16)
        : maxDist * 3;
      const candidateCluster = nearestCluster(symbolClusters, pos, symbolAssociationDist);
      const tagCluster = candidateCluster && isUsableTagCluster(candidateCluster, tagTxt, medTextH)
        ? candidateCluster
        : null;
      if (tagCluster) {
        bbox = rawBboxToNorm(
          { minX: tagCluster.minX, minY: tagCluster.minY, maxX: tagCluster.maxX, maxY: tagCluster.maxY },
          globalExtents,
        );
        bboxFromGeometry = true;
        bboxEvid.push(`Bbox from symbol stroke cluster (${tagCluster.members} strokes)`);
        bboxEvid.push(worldDimsEvidence(
          tagCluster.maxX - tagCluster.minX, tagCluster.maxY - tagCluster.minY, medTextH, unitsLabel,
        ));
      }
      const proxyFraction = medTextH
        ? Math.min(0.05, (medTextH * 16) / Math.max(extents.width, extents.height))
        : 0.05;
      const proxyFromTag = !tagCluster
        ? proxyBboxFromNearbyEntities(pos, entities, extents, proxyFraction, lookup, globalExtents, medTextH)
        : null;
      if (!tagCluster && proxyFromTag) {
        bbox = proxyFromTag;
        bboxFromGeometry = true;
        bboxEvid.push('Bbox from equipment symbol geometry near tag');
      } else if (nearestIns) {
        const raw = computeRealBbox(nearestIns, blocks as Record<string, unknown>);
        if (raw) {
          bbox = rawBboxToNorm(raw, globalExtents);
          bboxFromGeometry = true;
          bboxEvid.push(`Bbox from INSERT geometry: ${stripXrefPrefix(nearestIns.blockName)}`);
          bboxEvid.push(worldDimsEvidence(raw.maxX - raw.minX, raw.maxY - raw.minY, medTextH, unitsLabel));
        } else {
          const proxy = proxyBboxFromNearbyEntities(nearestIns.position, entities, extents, 0.04, lookup, globalExtents, medTextH);
          if (proxy) {
            bbox = proxy;
            bboxFromGeometry = true;
            bboxEvid.push('Bbox from nearby entity geometry (XREF proxy)');
          } else {
            bbox = estimateBbox(pos, globalExtents);
            bboxEvid.push('Bbox estimated (no block or nearby geometry) — vision required');
          }
        }
      } else {
        // No INSERT — try circle candidates near pos.
        // Expanded search radius: up to medTextH*20 (was maxDist*3) before estimateBbox.
        const circleSearchRadius = medTextH
          ? Math.min(maxDist * 6, medTextH * 20)
          : maxDist * 4;
        const nearCircle = circleCandidates
          .map(c => ({ c, d: dist(c.center, pos) }))
          .filter(({ d }) => d <= circleSearchRadius)
          .sort((a, b) => a.d - b.d)[0]?.c ?? null;

        if (nearCircle) {
          const r = nearCircle.radius;
          const cp = nearCircle.center;
          const PAD = 1.15;
          const raw: RawBbox = { minX: cp.x-r*PAD, minY: cp.y-r*PAD, maxX: cp.x+r*PAD, maxY: cp.y+r*PAD };
          bbox = rawBboxToNorm(raw, globalExtents);
          bboxFromGeometry = true;
          bboxEvid.push(`Bbox from CIRCLE/ARC entity (r=${Math.round(r)})`);
          bboxEvid.push(worldDimsEvidence(raw.maxX - raw.minX, raw.maxY - raw.minY, medTextH, unitsLabel));
        } else {
          bbox = estimateBbox(pos, globalExtents);
          bboxEvid.push('Bbox estimated from tag position — vision required');
        }
      }

      if (descMatch && shouldExpandBboxWithDescription(bbox, descMatch.position, globalExtents)) {
        bbox = expandBbox(bbox, descMatch.position, globalExtents);
      }

      // Confidence fusion (#8)
      const layerPrio = tagLayerPriority(tagTxt.layer, lookup);
      const signals: FusionSignals = {
        legendTagMatch: !!legendMatch && !!legendMatch.tag_pattern,
        legendTypeMatch: !!legendMatch && !legendMatch.tag_pattern,
        tagLayerKnown: isTagLayer(tagTxt.layer, lookup),
        tagLayerPriority: layerPrio,
        insertFound: !!nearestIns,
        bboxFromGeometry,
        descriptionPaired: !!descMatch,
        blockSuffixMatch: nearestIns
          ? !!matchBlockSuffixToLegend(stripXrefPrefix(nearestIns.blockName), legend)
          : false,
        sourceIsText: true,
      };
      const baseConf = lowTierSet.has(tagTxt) ? 0.70 : 0.80;
      const confidence = capEstimatedConfidence(fuseConfidence(baseConf, signals), bboxFromGeometry);

      detections.push({
        assetTag: tag,
        assetType,
        description: descMatch ? descMatch.text.trim() : null,
        confidence,
        bbox,
        evidence: [
          `Tag from DXF TEXT layer "${sl}": ${tag}`,
          legendMatch
            ? `Legend match: ${legendMatch.symbol_name ?? legendMatch.asset_type}`
            : 'No legend match — type UNKNOWN, needs rule validation',
          ...bboxEvid,
          ...(descMatch ? [`Description: ${descMatch.text.trim()}`] : []),
        ],
        blockName: nearestIns ? stripXrefPrefix(nearestIns.blockName) : null,
        layer: tagTxt.layer,
        source: 'TEXT',
        rawPosition: pos,
        regionIndex,
        pidPage,
        needsAiClassification: typeUnknown || !bboxFromGeometry,
        needsGeminiClassification: typeUnknown || !bboxFromGeometry,
      });
    }

    // 4b. Destination label detections — referenced equipment on other sheets.
    // Tags extracted from "TO WASH TANK 1 T-0101" style labels.
    // Confidence capped at 0.65 so they always land in PENDING review.
    for (const { text: t, extractedTag, labelText } of destLabelTags) {
      const legendMatch = matchTagToLegend(extractedTag, legend);
      const assetType = legendMatch?.asset_type ?? UNKNOWN_ASSET_TYPE;
      // Place bbox at the arrow/label position using a small estimated box
      const normPos = dxfToNorm(t.position, globalExtents);
      const bbox: DxfDetection['bbox'] = {
        x: Math.max(0, normPos.x - 30),
        y: Math.max(0, normPos.y - 15),
        width: 60,
        height: 30,
      };
      detections.push({
        assetTag: extractedTag,
        assetType,
        description: labelText,
        confidence: 0.65,
        bbox,
        evidence: [
          `Destination label: "${labelText}"`,
          `Tag "${extractedTag}" referenced in off-page continuation — equipment may be on another sheet`,
          legendMatch
            ? `Legend match: ${legendMatch.symbol_name ?? legendMatch.asset_type}`
            : 'No legend match — type UNKNOWN, needs rule validation',
        ],
        blockName: null,
        layer: t.layer,
        source: 'TEXT',
        rawPosition: t.position,
        regionIndex,
        pidPage,
        needsAiClassification: !legendMatch,
        needsGeminiClassification: !legendMatch,
      });
    }

    // 5. CIRCLE/ARC candidates not already covered by a tag text (#3)
    const taggedPositions = dedupedTags.map(t => t.position);
    const coveredCircles = new Set<CircleCandidate>();

    // Mark circles that are near a tagged position
    for (const cc of circleCandidates) {
      // Use circle radius as part of the coverage check (larger symbol = larger association zone)
      // but cap at 3× maxDist to avoid marking distant circles as covered.
      const coverRadius = Math.min(
        Math.max(extents.width, extents.height) * maxAssocDistFraction * 3,
        cc.radius * 3,
      );
      const covered = taggedPositions.some(tp => dist(tp, cc.center) <= coverRadius);
      if (covered) coveredCircles.add(cc);
    }

    for (const cc of circleCandidates) {
      if (coveredCircles.has(cc)) continue;

      // Check if any tag text is near this circle — HANYA dari layer non-excluded
      // (sebelumnya teks construction ikut jadi tag → duplikat & salah label).
      const nearTag = allTexts
        .filter(t => !isExcludedLayer(t.layer, lookup) && isTagText(t.text, legendTagRegexes))
        .map(t => ({ t, d: dist(t.position, cc.center) }))
        .filter(({ d }) => d <= cc.radius * 4)
        .sort((a, b) => a.d - b.d)[0]?.t ?? null;

      const tag = nearTag ? nearTag.text.trim() : null;
      const legendMatch = tag ? matchTagToLegend(tag, legend) : null;
      const assetType = legendMatch?.asset_type ?? UNKNOWN_ASSET_TYPE;

      const r = cc.radius;
      const raw: RawBbox = { minX: cc.center.x-r, minY: cc.center.y-r, maxX: cc.center.x+r, maxY: cc.center.y+r };
      const bbox = rawBboxToNorm(raw, globalExtents);

      const signals: FusionSignals = {
        legendTagMatch: !!legendMatch && !!legendMatch?.tag_pattern,
        legendTypeMatch: !!legendMatch && !legendMatch?.tag_pattern,
        tagLayerKnown: false,
        tagLayerPriority: 99,
        insertFound: false,
        bboxFromGeometry: true,
        descriptionPaired: false,
        blockSuffixMatch: false,
        sourceIsText: false,
      };
      const confidence = fuseConfidence(tag ? 0.62 : 0.42, signals);

      const needsAi = !tag && !legendMatch;
      if (needsAi) { aiCandidates++; }

      if (classifyDxfCandidate({
        source: 'CIRCLE',
        assetTag: tag,
        assetType,
        evidence: tag ? [`Nearby tag text: ${tag}`] : ['CIRCLE entity detected', 'No legend match'],
      }) === 'DROP') {
        continue;
      }

      // Description: look for nearest desc text around circle center
      const circleMaxDist = Math.max(extents.width, extents.height) * maxAssocDistFraction;
      const circleDescMatch = findNearestDesc(cc.center, descTexts, pairedDescs, circleMaxDist, 3);

      detections.push({
        assetTag: tag,
        assetType,
        description: circleDescMatch ? circleDescMatch.text.trim() : null,
        confidence,
        bbox,
        evidence: [
          `${cc.source} entity detected (r=${Math.round(r)})`,
          tag ? `Nearby tag text: ${tag}` : 'No nearby tag text',
          legendMatch
            ? `Legend match: ${legendMatch.symbol_name ?? legendMatch.asset_type}`
            : 'No legend match',
          ...(circleDescMatch ? [`Description: ${circleDescMatch.text.trim()}`] : []),
        ],
        blockName: null,
        layer: cc.layer,
        source: 'CIRCLE',
        rawPosition: cc.center,
        regionIndex,
        pidPage,
        needsAiClassification: needsAi || !tag,
        needsGeminiClassification: needsAi || !tag,
      });
    }

    // 6. Untagged INSERTs not covered by any tag text
    // Skip internal DXF block names (connectors, panels, reference blocks, legend frames)
    // Patterns: A1-A999, Arrow*, PAN###, Pan###, AnonymousCell###, GAF###, R###, AROF*, SLON*, plus standard Model/Paper_Space
    const skipSuffixes = /^(A\d+|Arrow|PAN\d*|Pan\d*|AnonymousCell|GAF\d*|R\d*|AROF|SLON|Model_Space|Paper_Space)/i;

    for (const ins of inserts) {
      const suffix = stripXrefPrefix(ins.blockName);
      if (skipSuffixes.test(suffix)) continue;
      const alreadyCovered = taggedPositions.some(tp => dist(tp, ins.position) <= Math.max(extents.width, extents.height) * maxAssocDistFraction * 6);
      if (alreadyCovered) continue;

      const raw = computeRealBbox(ins, blocks as Record<string, unknown>);
      let bbox: DxfDetection['bbox'];
      let bboxFromGeometry = false;
      const bboxEvid: string[] = [];

      if (raw) {
        bbox = rawBboxToNorm(raw, globalExtents);
        bboxFromGeometry = true;
        bboxEvid.push('Bbox from block geometry');
        bboxEvid.push(worldDimsEvidence(raw.maxX - raw.minX, raw.maxY - raw.minY, medTextH, unitsLabel));
      } else {
        // XREF proxy (#6)
        const proxy = proxyBboxFromNearbyEntities(ins.position, entities, extents, 0.04, lookup, globalExtents, medTextH);
        if (proxy) {
          bbox = proxy;
          bboxFromGeometry = true;
          bboxEvid.push('Bbox from nearby entity geometry (XREF proxy)');
        } else {
          bbox = estimateBbox(ins.position, globalExtents);
          bboxEvid.push('Bbox estimated — vision required');
        }
      }

      const lgMatch = matchBlockSuffixToLegend(suffix, legend);
      const needsAi = !lgMatch;
      if (needsAi) { unmatchedInserts++; aiCandidates++; }

      // Description: nearest desc text to INSERT position
      const insertMaxDist = Math.max(extents.width, extents.height) * maxAssocDistFraction;
      const untaggedDescMatch = findNearestDesc(ins.position, descTexts, pairedDescs, insertMaxDist, 3);

      const signals: FusionSignals = {
        legendTagMatch: false,
        legendTypeMatch: false,
        tagLayerKnown: false,
        tagLayerPriority: 99,
        insertFound: true,
        bboxFromGeometry,
        descriptionPaired: !!untaggedDescMatch,
        blockSuffixMatch: !!lgMatch,
        sourceIsText: false,
      };
      const confidence = capEstimatedConfidence(fuseConfidence(lgMatch ? 0.60 : 0.38, signals), bboxFromGeometry);

      detections.push({
        assetTag: null,
        assetType: lgMatch?.asset_type ?? UNKNOWN_ASSET_TYPE,
        description: untaggedDescMatch ? untaggedDescMatch.text.trim() : null,
        confidence,
        bbox,
        evidence: [
          `DXF INSERT block: ${suffix}`,
          lgMatch ? `Legend block match: ${lgMatch.symbol_name ?? lgMatch.asset_type}` : 'No legend match — untagged',
          ...bboxEvid,
          ...(untaggedDescMatch ? [`Description: ${untaggedDescMatch.text.trim()}`] : []),
        ],
        blockName: suffix,
        layer: ins.layer,
        source: 'INSERT',
        rawPosition: ins.position,
        regionIndex,
        pidPage,
        needsAiClassification: needsAi || !bboxFromGeometry,
        needsGeminiClassification: needsAi || !bboxFromGeometry,
      });
    }

    // Merge distance anchored to label height (mm-anchored, Blok 8):
    // same-tag boxes within ~3 label-heights merge; clamped to sane bounds.
    // Use DXF_DEDUP_MERGE_DIST env var to override (default 40, lenient mode 150)
    const scopeSpan = Math.max(extents.width, extents.height);
    const medHNorm = medTextH && scopeSpan > 0 ? (medTextH / scopeSpan) * 1000 : DEFAULT_MERGE_DIST_NORM / 3;
    const autoMergeDist = Math.min(80, Math.max(20, medHNorm * 3));
    const mergeDist = env.DXF_DEDUP_MERGE_DIST ?? autoMergeDist;
    const regionDets = markRegionConflicts(deduplicate(detections, lookup, mergeDist), regionIndex);
    for (const d of regionDets) { d.regionIndex = regionIndex; d.pidPage = pidPage; }
    allDetections.push(...regionDets);
    regionsInfo.push({ index: regionIndex, pidPage, entityCount: entities.length, extents: region.extents, textTagsFound: dedupedTags.length });
    textTagsFoundTotal += dedupedTags.length;

  } else {
    // ════════════════════════════════════════════
    // ATTRIB-FIRST PIPELINE (standard DXF)
    // ════════════════════════════════════════════

    // Description texts for this region (shared with insert loop below)
    const descTexts = buildDescTexts(allTexts, lookup, legendTagRegexes, medTextH);
    const pairedDescs = new Set<DxfTextEntity>();

    const insertTagMap = new Map<DxfInsertEntity, { tag: string; fromAttrib: boolean }>();
    for (const ins of inserts) {
      const tag = pickAttribTag(ins.attributes);
      if (tag) insertTagMap.set(ins, { tag, fromAttrib: true });
    }

    const assignedTexts = new Set<DxfTextEntity>();
    const insertBboxes = inserts.map(i => ({
      ins: i,
      raw: computeRealBbox(i, blocks as Record<string, unknown>),
    }));

    for (const { ins, raw } of insertBboxes) {
      if (insertTagMap.has(ins)) continue;
      let adDist = Math.max(extents.width, extents.height) * maxAssocDistFraction;
      if (raw) {
        const bw = raw.maxX-raw.minX, bh = raw.maxY-raw.minY;
        adDist = Math.max(adDist, Math.max(bw,bh)*2);
      }
      let nearest: { txt: DxfTextEntity; d: number } | null = null;
      for (const txt of allTexts) {
        if (assignedTexts.has(txt)) continue;
        // Hanya teks pola-tag dari layer non-excluded (sebelumnya teks apa pun
        // — termasuk dimensi/construction — bisa ditempel ke simbol).
        if (isExcludedLayer(txt.layer, lookup)) continue;
        if (!isTagText(txt.text, legendTagRegexes)) continue;
        const d = dist(txt.position, ins.position);
        if (d <= adDist && (!nearest || d < nearest.d)) nearest = { txt, d };
      }
      if (nearest) {
        insertTagMap.set(ins, { tag: nearest.txt.text, fromAttrib: false });
        assignedTexts.add(nearest.txt);
      }
    }

    for (const { ins, raw } of insertBboxes) {
      const te = insertTagMap.get(ins);
      const tag = te?.tag ?? null;

      // XREF proxy fallback (#6)
      let bboxFromGeometry = !!raw;
      let bbox: DxfDetection['bbox'];
      const bboxDimsEvid: string[] = [];
      if (raw) {
        bbox = rawBboxToNorm(raw, globalExtents);
        bboxDimsEvid.push(worldDimsEvidence(raw.maxX - raw.minX, raw.maxY - raw.minY, medTextH, unitsLabel));
      } else {
        const proxy = proxyBboxFromNearbyEntities(ins.position, entities, extents, 0.04, lookup, globalExtents, medTextH);
        if (proxy) {
          bbox = proxy;
          bboxFromGeometry = true;
        } else {
          bbox = estimateBbox(ins.position, globalExtents);
        }
      }

      const suffix = stripXrefPrefix(ins.blockName);
      const bm = matchBlockSuffixToLegend(suffix, legend);
      const tm = tag ? matchTagToLegend(tag, legend) : null;
      const lm = bm ?? tm;
      const assetType = lm?.asset_type ?? UNKNOWN_ASSET_TYPE;
      const needsAi = !lm;
      if (needsAi) { unmatchedInserts++; aiCandidates++; }

      // Description: nearest desc text around INSERT position
      const attribMaxDist = Math.max(extents.width, extents.height) * maxAssocDistFraction;
      const attribDescMatch = findNearestDesc(ins.position, descTexts, pairedDescs, attribMaxDist, 3);

      const signals: FusionSignals = {
        legendTagMatch: !!tm && !!tm.tag_pattern,
        legendTypeMatch: !!tm && !tm.tag_pattern,
        tagLayerKnown: tag ? isTagLayer(ins.layer, lookup) : false,
        tagLayerPriority: 99,
        insertFound: true,
        bboxFromGeometry,
        descriptionPaired: !!attribDescMatch,
        blockSuffixMatch: !!bm,
        sourceIsText: false,
      };
      let base: number;
      if (lm && tag && te?.fromAttrib) base = 0.88;
      else if (lm && tag) base = 0.72;
      else if (lm) base = 0.62;
      else if (tag) base = 0.52;
      else base = 0.35;

      const confidence = capEstimatedConfidence(fuseConfidence(base, signals), bboxFromGeometry);

      detections.push({
        assetTag: tag,
        assetType,
        description: attribDescMatch ? attribDescMatch.text.trim() : null,
        confidence,
        bbox,
        evidence: [
          `DXF INSERT block: ${suffix}`,
          tag ? (te?.fromAttrib ? `ATTRIB tag: ${tag}` : `Spatial text: ${tag}`) : 'No tag',
          lm ? `Legend: ${lm.symbol_name ?? lm.asset_type}` : 'No legend match — type UNKNOWN, needs rule validation',
          ...bboxDimsEvid,
          ...(attribDescMatch ? [`Description: ${attribDescMatch.text.trim()}`] : []),
        ],
        blockName: suffix,
        layer: ins.layer,
        source: 'INSERT',
        rawPosition: ins.position,
        regionIndex,
        pidPage,
        needsAiClassification: needsAi || !bboxFromGeometry,
        needsGeminiClassification: needsAi || !bboxFromGeometry,
      });
    }

    const scopeSpan2 = Math.max(extents.width, extents.height);
    const medHNorm2 = medTextH && scopeSpan2 > 0 ? (medTextH / scopeSpan2) * 1000 : DEFAULT_MERGE_DIST_NORM / 3;
    const mergeDist2 = Math.min(80, Math.max(20, medHNorm2 * 3));
    const regionDets2 = markRegionConflicts(deduplicate(detections, lookup, mergeDist2), regionIndex);
    for (const d of regionDets2) { d.regionIndex = regionIndex; d.pidPage = pidPage; }
    allDetections.push(...regionDets2);
    regionsInfo.push({ index: regionIndex, pidPage, entityCount: entities.length, extents: region.extents, textTagsFound: insertTagMap.size });
    textTagsFoundTotal += insertTagMap.size;
  }
  } // end region loop

  // Associate piping line sizes to valves across all detections
  const pipeLines = extractPipingLinesFromEntities(
    globalEntities,
    globalTexts,
    Math.max(globalExtents.width, globalExtents.height) * 0.05
  );
  associatePipingLinesToValves(allDetections, pipeLines);

  // ── Fix 3: Filter detections whose rawPosition lies outside their region extents.
  // A tolerance of 2% of the region span handles entities exactly on the border.
  // This eliminates cross-sheet false positives picked up when region boundaries
  // don't perfectly separate adjacent sheets.
  const filteredDetections = allDetections.filter(det => {
    const ri = det.regionIndex;
    const regionInfo = regionsInfo[ri];
    if (!regionInfo) return true; // no info → keep
    const ext = regionInfo.extents;
    const tolX = ext.width * 0.02;
    const tolY = ext.height * 0.02;
    const px = det.rawPosition.x, py = det.rawPosition.y;
    return (
      px >= ext.minX - tolX &&
      px <= ext.maxX + tolX &&
      py >= ext.minY - tolY &&
      py <= ext.maxY + tolY
    );
  });

  // ── Fix 1: Cross-region dedup.
  // Per-region dedup may miss duplicates when the same tag appears in adjacent
  // region boundaries. Run a second pass over all detections with a larger
  // merge threshold (2× the default).
  function deduplicateCrossRegion(dets: DxfDetection[]): DxfDetection[] {
    const sorted = [...dets].sort((a, b) => {
      const order: Record<DxfDetection['source'], number> = { TEXT: 0, CIRCLE: 1, ATTRIBUTE: 2, INSERT: 3, VISION: 4 };
      const so = (order[a.source] ?? 9) - (order[b.source] ?? 9);
      if (so !== 0) return so;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
    const crossMergeDist = DEFAULT_MERGE_DIST_NORM * 2;
    const kept: DxfDetection[] = [];
    for (const det of sorted) {
      const cx = det.bbox.x + det.bbox.width / 2;
      const cy = det.bbox.y + det.bbox.height / 2;
      const isDup = kept.some(k => {
        if (!det.assetTag || !k.assetTag) return false;
        if (det.assetTag !== k.assetTag) return false;
        const kx = k.bbox.x + k.bbox.width / 2, ky = k.bbox.y + k.bbox.height / 2;
        return Math.hypot(cx - kx, cy - ky) <= crossMergeDist;
      });
      if (!isDup) kept.push(det);
    }
    return kept;
  }

  const finalDetections = deduplicateCrossRegion(filteredDetections);

  return {
    detections: finalDetections,
    page: 1,
    regions: regionsInfo,
    units: parsed.units,
    parseStats: {
      totalEntities: globalEntities.length,
      insertCount: globalInserts.length,
      textCount: globalTexts.length,
      circleCount: circleCountTotal,
      clusterCount: clusterCountTotal,
      lineCount,
      unmatchedInserts,
      aiCandidates,
      geminiCandidates: aiCandidates,
      textTagsFound: textTagsFoundTotal,
    },
  };
}

// ── AI pre-pass layer auto-classification (#4) ────────────────────────────────

export interface LayerSample {
  layerName: string;
  shortName: string;
  sampleTexts: string[];
}

export interface LayerClassificationResult {
  layerName: string;
  shortName: string;
  category: LayerProfile['category'];
  confidence: number;
  reasoning: string;
}

/**
 * Analyze DXF buffer to collect layer sample data for AI classification.
 * Call this before running detection to get LayerSample[] for the AI pre-pass.
 */
export function collectLayerSamples(buffer: Buffer): LayerSample[] {
  const parsed = parseDxf(buffer);
  const textsByLayer = new Map<string, Set<string>>();

  for (const e of parsed.entities) {
    if (e.kind !== 'TEXT' && e.kind !== 'MTEXT') continue;
    const sl = shortLayer(e.layer);
    if (!textsByLayer.has(sl)) textsByLayer.set(sl, new Set());
    textsByLayer.get(sl)!.add(e.text.trim().slice(0, 50));
  }

  const samples: LayerSample[] = [];
  for (const [sl, texts] of textsByLayer) {
    const fullLayer = parsed.layers.find(l => shortLayer(l) === sl) ?? sl;
    samples.push({
      layerName: fullLayer,
      shortName: sl,
      sampleTexts: [...texts].slice(0, 8),
    });
  }
  return samples;
}

/**
 * AI-based layer classification using Gemini text prompt.
 * Returns array of LayerClassificationResult for persistence to dxf_layer_analysis.
 *
 * Does NOT require image/SVG — cheaper, more reliable for structural classification.
 */
export async function classifyLayersWithAI(
  samples: LayerSample[],
): Promise<LayerClassificationResult[]> {
  if (!samples.length) return [];

  const { getVisionProvider } = await import('@/lib/ai-providers');
  const { getAiConfig } = await import('@/lib/ai-config');

  let provider: import('@/lib/ai-providers').IVisionProvider;
  let model: string | undefined;
  try {
    const cfg = await getAiConfig();
    provider = await getVisionProvider(cfg);
    model = cfg.provider === 'openai' ? cfg.openaiModel : (cfg.provider === 'anthropic' ? cfg.anthropicModel : cfg.geminiModel);
  } catch (err) {
    console.error('getVisionProvider config error in classifyLayersWithAI:', err);
    return [];
  }

  const layerList = samples.map((s, i) =>
    `${i+1}. layer="${s.shortName}" samples=${JSON.stringify(s.sampleTexts.slice(0, 5))}`
  ).join('\n');

  const prompt = `You are a P&ID DXF layer classifier. Classify each DXF layer by its purpose.

Categories:
- "tag": equipment/instrument tag numbers (e.g. "P-0301", "XV-001", "FIC-201")
- "description": equipment descriptions or service text
- "pipe": piping or process line geometry
- "equipment": equipment symbol geometry
- "title": title block, border, revision table
- "ignore": construction lines, dimensions, not useful for asset detection
- "unknown": cannot determine

Layers to classify:
${layerList}

Reply ONLY with valid JSON object:
{"layers": [{"layerName":"...","category":"...","confidence":0.0-1.0,"reasoning":"..."}]}`;

  try {
    const res = await provider.generateVisionCompletion({
      model,
      prompt,
      responseFormat: 'json',
      maxTokens: 2048,
      temperature: 0.1,
    });
    const raw = res.text.trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(raw);
    const list = (Array.isArray(parsed)
      ? parsed
      : (parsed.layers ?? parsed.items ?? Object.values(parsed).find(Array.isArray) ?? (parsed.category ? [parsed] : []))) as Array<{
      layerName: string;
      category: string;
      confidence: number;
      reasoning: string;
    }>;

    return list.map((item, i) => ({
      layerName: samples[i]?.layerName ?? item.layerName,
      shortName: samples[i]?.shortName ?? item.layerName,
      category: (['tag','description','pipe','equipment','title','ignore','unknown'] as const)
        .includes(item.category as LayerProfile['category'])
        ? (item.category as LayerProfile['category'])
        : 'unknown',
      confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
      reasoning: item.reasoning ?? '',
    }));
  } catch (err) {
    console.error('classifyLayersWithAI error:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ── AI text-prompt fallback (#7) ──────────────────────────────────────────

/**
 * Improved AI fallback: uses text-only prompt (INSERT block name + nearby texts)
 * instead of SVG crop. Cheaper, more reliable for structural P&ID naming.
 *
 * Supports multi-provider (Gemini, OpenAI / 9router, Anthropic).
 */
export async function applyAiFallback(
  detections: DxfDetection[],
  _svgBuffer: Buffer,        // kept for API compat, only used for vision fallback path
  legend: LegendSymbolRef[],
  dxfExtents: DxfParseResult['extents'],
  /** Raw DXF entities for context — used to find nearby text */
  rawEntities?: DxfParseResult['entities'],
): Promise<void> {
  // Only UNKNOWN-typed candidates: resolved detections don't need re-classification
  // (previously any estimated-box detection burned an AI call).
  const candidates = detections.filter(
    d => (d.needsAiClassification ?? d.needsGeminiClassification) && d.blockName && d.assetType === UNKNOWN_ASSET_TYPE,
  );
  if (!candidates.length || !legend.length) return;

  const { getVisionProvider } = await import('@/lib/ai-providers');
  const { getAiConfig } = await import('@/lib/ai-config');

  let provider: import('@/lib/ai-providers').IVisionProvider;
  let model: string | undefined;
  try {
    const cfg = await getAiConfig();
    provider = await getVisionProvider(cfg);
    model = cfg.provider === 'openai' ? cfg.openaiModel : (cfg.provider === 'anthropic' ? cfg.anthropicModel : cfg.geminiModel);
  } catch (err) {
    console.error('getVisionProvider config error in applyAiFallback:', err);
    return;
  }

  const legendTypes = [...new Set(legend.map(s => s.asset_type))].join(', ');

  // Dynamic proximity radius: 5% of drawing size.
  // Avoids the old hardcoded 500 DXF-unit radius that was wrong for large/small drawings.
  const drawingSize = Math.max(dxfExtents.width, dxfExtents.height);
  const nearbyRadius = Math.max(drawingSize * 0.05, 50); // min 50 units safety floor

  const BATCH = 8; // text-prompt = cheap, larger batch OK
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);

    // Build context for each candidate
    const items = batch.map(det => {
      // Find nearby text entities if rawEntities provided
      let nearbyTexts: string[] = [];
      if (rawEntities) {
        nearbyTexts = rawEntities
          .filter((e): e is DxfTextEntity => e.kind === 'TEXT' || e.kind === 'MTEXT')
          .map(e => ({
            t: e,
            d: Math.hypot(
              e.position.x - det.rawPosition.x,
              e.position.y - det.rawPosition.y,
            ),
          }))
          .filter(({ d }) => d <= nearbyRadius)
          .sort((a, b) => a.d - b.d)
          .slice(0, 5)
          .map(({ t }) => t.text.trim());
      }
      return { blockName: det.blockName, nearbyTexts };
    });

    const listStr = items.map((it, idx) =>
      `${idx+1}. block="${it.blockName}" nearbyText=${JSON.stringify(it.nearbyTexts)}`
    ).join('\n');

    const prompt = `P&ID asset classifier. Available types: ${legendTypes}.

Classify each DXF block reference. Use block name and nearby text labels as clues.

${listStr}

Reply ONLY with valid JSON object:
{"classifications": [{"assetType":"<type or UNKNOWN>","confidence":0.0-1.0,"evidence":"<reason>"}]}`;

    try {
      const res = await provider.generateVisionCompletion({
        model,
        prompt,
        responseFormat: 'json',
        maxTokens: 2048,
        temperature: 0.1,
      });
      const raw = res.text.trim()
        .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      const parsed = JSON.parse(raw);
      const list = (Array.isArray(parsed)
        ? parsed
        : (parsed.classifications ?? parsed.items ?? Object.values(parsed).find(Array.isArray) ?? (parsed.assetType ? [parsed] : []))) as Array<{
        assetType?: string;
        confidence?: number;
        evidence?: string;
      }>;

      for (let j = 0; j < batch.length; j++) {
        const det = batch[j];
        const p = list[j];
        if (!p) continue;
        const at = p.assetType?.trim();
        const cf = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.55;
        if (at && at !== 'UNKNOWN' && cf >= 0.45) {
          const m = legend.find(s => s.asset_type.toLowerCase() === at.toLowerCase());
          det.assetType = m?.asset_type ?? at;
          det.confidence = Math.max(det.confidence, cf);
          det.evidence.push(`AI text-prompt: ${p.evidence ?? at} (${Math.round(cf*100)}%)`);
          det.needsAiClassification = false;
          det.needsGeminiClassification = false;
        }
      }
    } catch (err) {
      console.error('applyAiFallback error:', err instanceof Error ? err.message : err);
    }

    if (i + BATCH < candidates.length) await new Promise(r => setTimeout(r, 200));
  }
}

/** Backward-compatibility alias */
export const applyGeminiFallback = applyAiFallback;

// ── Piping Line & Valve Size Association ─────────────────────────────────────

export interface DxfPipeLineRef {
  start: DxfPoint;
  end: DxfPoint;
  text?: string;
  /** Nominal pipe size only, e.g. '3/4"', '8"' */
  size: string;
  /** Full raw spec text as it appears in DXF, e.g. '3/4"-800# Drain', '8"-150#' */
  rawSpec?: string;
}

/**
 * Calculates perpendicular/closest distance from point P to line segment AB.
 */
export function distancePointToSegment(p: DxfPoint, a: DxfPoint, b: DxfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const diffX = p.x - projX;
  const diffY = p.y - projY;
  return Math.sqrt(diffX * diffX + diffY * diffY);
}

/**
 * Extracts piping lines from entities and texts using parseLineSpecText.
 * Also includes pipe spec texts that have no nearby LINE entity (text-only specs).
 */
export function extractPipingLinesFromEntities(
  entities: import('@/lib/dxf-parser').DxfEntity[],
  texts: DxfTextEntity[],
  maxTextToLineDist: number = 50
): DxfPipeLineRef[] {
  const lineEntities: DxfLineEntity[] = entities.filter((e): e is DxfLineEntity => e.kind === 'LINE');
  const pipeLines: DxfPipeLineRef[] = [];

  for (const t of texts) {
    const parsed = parseLineSpecText(t.text);
    if (!parsed) continue;

    let closestLine: DxfLineEntity | null = null;
    let minD = maxTextToLineDist;

    for (const l of lineEntities) {
      const d = distancePointToSegment(t.position, l.start, l.end);
      if (d < minD) {
        minD = d;
        closestLine = l;
      }
    }

    if (closestLine) {
      pipeLines.push({
        start: closestLine.start,
        end: closestLine.end,
        text: parsed.rawText,
        size: parsed.pipeSize,
        rawSpec: parsed.rawText,
      });
    } else {
      // No nearby LINE — include as text-only spec anchored at text position.
      // associatePipingLinesToValves will match by proximity to rawPosition.
      pipeLines.push({
        start: t.position,
        end: t.position,
        text: parsed.rawText,
        size: parsed.pipeSize,
        rawSpec: parsed.rawText,
      });
    }
  }

  return pipeLines;
}

/**
 * Associates valves with collinear/intersecting piping line segments and assigns nominal size.
 * For text-only specs (start === end), uses Euclidean distance to rawPosition.
 */
export function associatePipingLinesToValves<T extends DxfDetection>(
  valves: T[],
  lines: DxfPipeLineRef[],
  maxDistance: number = 120
): T[] {
  for (const v of valves) {
    if (v.size) continue;
    const pos = v.rawPosition ?? { x: v.bbox.x + v.bbox.width / 2, y: v.bbox.y + v.bbox.height / 2 };

    let bestLine: DxfPipeLineRef | null = null;
    let minD = maxDistance;

    for (const line of lines) {
      const d = distancePointToSegment(pos, line.start, line.end);
      if (d < minD) {
        minD = d;
        bestLine = line;
      }
    }

    if (bestLine) {
      v.size = bestLine.rawSpec ?? bestLine.size;
      v.evidence.push(`[Line-Size] Inferred ${bestLine.rawSpec ?? bestLine.size} from collinear piping line`.trim());
    }
  }
  return valves;
}

