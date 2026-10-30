/**
 * OCR Candidate Extraction + Spatial Tag Matching
 *
 * F1 — OCR tag tokenization:
 *   Extract all tag-like tokens from raw OCR text per page.
 *   Pattern: 1–5 uppercase letters, dash, 1–4 digits (optional suffix letter).
 *   Examples: P-101, XV-301, FIC-201A, LT-001B
 *
 * F2 — Spatial matching:
 *   Given a symbol bounding box (0-1000 normalized space) and all OCR tokens
 *   with their text positions (if available), rank candidates by proximity.
 *
 *   If positions not available (mupdf text extraction gives no bbox for tokens),
 *   fall back to whole-page token set and rank by contextual similarity only.
 *
 * Provenance contract:
 *   Every candidate carries: original OCR text, normalized value, confidence,
 *   source, and spatial score. Raw OCR never silently mutated.
 */

export interface OcrToken {
  text: string;          // raw OCR text as extracted
  // Position in 0-1000 normalized space — null if OCR did not provide position
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export interface TagCandidate {
  original: string;        // raw OCR token before any normalization
  normalized: string;      // after normalization (may equal original)
  normalized_by: string;   // 'none' | 'case' | 'edit_distance_1' | 'char_substitution'
  ocr_confidence: number;  // 0-1: confidence in OCR read quality (estimated from token clarity)
  spatial_score: number;   // 0-1: proximity score to symbol bbox (1 = very close, 0 = far/unknown)
  distance_units: number | null;  // actual distance in 0-1000 units, null if no position
  relative_position: string | null; // 'above' | 'below' | 'left' | 'right' | 'overlap' | null
  source: 'OCR';
  knowledge_match: boolean; // true if normalized tag found in project/drawing knowledge
}

export interface SymbolBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Tag tokenization ─────────────────────────────────────────────────────────

/**
 * Core pattern for industrial P&ID tags.
 *
 * Matches:
 *   Simple:   P-101, XV-301, FIC-201A, PSV-1001B, LT-12, H-001, JB-03
 *   Long num: PSV-10001 (5-digit instrument loops)
 *   Suffix:   FCV-101A, FCV-101AB (multi-letter suffix)
 *   Compound: PSV-PDT-11, FIC-FT-201 (instrument + measured variable compound tags)
 *             captured as full compound or as individual segments
 *
 * Does NOT match: plain numbers, single letters, UUIDs, version strings, pipe sizes (6", DN150).
 *
 * Two alternatives:
 *   Alt 1 — compound tag: PREFIX-PREFIX-DIGITS[suffix]
 *   Alt 2 — simple tag:   PREFIX-DIGITS[suffix]
 * PREFIX = 1–6 uppercase letters (6 to catch FICAHL etc.)
 * DIGITS = 1–5 digits (5 to catch 5-digit loops common in large plants)
 * SUFFIX = 0–2 uppercase letters (A, AB, etc.)
 */
const TAG_PATTERN = /\b([A-Z]{1,6}-(?:[A-Z]{1,6}-\d{1,5}[A-Z]{0,2}|\d{1,5}[A-Z]{0,2}))\b/gi;

/**
 * Extract all tag-like tokens from OCR text.
 * Returns uppercase normalized tokens with position null (mupdf text gives no per-token bbox).
 *
 * @param ocrText  raw text from extractPdfTextByPage()
 * @returns array of OcrTokens — positions are null (mupdf does not provide word-level bbox)
 */
export function extractTagTokens(ocrText: string): OcrToken[] {
  const tokens: OcrToken[] = [];
  // M12: Do NOT deduplicate — keep all occurrences.
  // P-101 appearing 5× in OCR text = 5 tokens at different ordinal positions.
  // sectionSpatialScore uses token index to estimate page position, so keeping
  // occurrences allows each symbol to compete with its nearest OCR occurrence.
  // Entity-level deduplication happens later (worker post-job entity resolution).
  let match: RegExpExecArray | null;
  const re = new RegExp(TAG_PATTERN.source, TAG_PATTERN.flags);
  while ((match = re.exec(ocrText)) !== null) {
    const raw = match[1];
    const upper = raw.toUpperCase();
    tokens.push({
      text: upper,
      x: null,
      y: null,
      width: null,
      height: null,
    });
  }
  return tokens;
}

// ── Distance helpers ──────────────────────────────────────────────────────────

function bboxCenter(b: SymbolBBox): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function euclidean(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Convert raw distance (0-1000 space) to spatial score (0-1).
 * 0 units → 1.0, 200 units → ~0.0
 * Uses exponential decay: score = exp(-dist / 80)
 * 80 units ≈ 8% of canvas = typical tag-to-symbol separation.
 */
function distanceToScore(dist: number): number {
  return Math.exp(-dist / 80);
}

// ── Relative position ─────────────────────────────────────────────────────────

function relativePosition(
  symbolBbox: SymbolBBox,
  tokenBbox: SymbolBBox
): string {
  const sc = bboxCenter(symbolBbox);
  const tc = bboxCenter(tokenBbox);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;

  // If centers nearly overlap → 'overlap'
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return 'overlap';

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? 'above' : 'below';
  }
  return dx < 0 ? 'left' : 'right';
}

// ── OCR confidence estimation ─────────────────────────────────────────────────

/**
 * Estimate OCR confidence from token characteristics.
 * Heuristics:
 *   - Correct format (matches strict TAG_PATTERN) → base 0.80
 *   - All uppercase (no mixed case noise) → +0.10
 *   - Common prefix (P, V, XV, FIC, etc.) → +0.05
 *   - Suspicious chars (O vs 0, I vs 1) → -0.15
 */
const COMMON_PREFIXES = new Set([
  'P', 'V', 'T', 'E', 'K', 'C',
  'XV', 'FV', 'LV', 'PV', 'TV',
  'FIC', 'PIC', 'LIC', 'TIC',
  'FT', 'PT', 'LT', 'TT', 'AT',
  'PSV', 'PRV', 'CV', 'HV',
  'MOV', 'SDV', 'BDV', 'XCV',
]);

export function estimateOcrConfidence(token: string): number {
  let score = 0.80;
  const parts = token.split('-');
  if (parts.length !== 2) return 0.50;

  const prefix = parts[0];
  const numPart = parts[1];

  // Uppercase check
  if (token === token.toUpperCase()) score += 0.10;

  // Known prefix
  if (COMMON_PREFIXES.has(prefix)) score += 0.05;

  // Suspicious: letter O where digit expected (O vs 0)
  if (/O\d|\dO/.test(numPart)) score -= 0.15;
  // Suspicious: letter I where digit expected
  if (/I\d|\dI/.test(numPart) || /^I+$/.test(numPart.replace(/\d/g, 'I'))) score -= 0.15;
  // All digits in number part → good sign
  if (/^\d+[A-Z]?$/.test(numPart)) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

// ── Section-based spatial scoring fallback ────────────────────────────────────

/**
 * When mupdf does not provide per-token positions (x/y = null),
 * fall back to section-based scoring using ordinal position of token in
 * the OCR text stream relative to the symbol's page section.
 *
 * Algorithm:
 *   1. Divide page into a 6x6 grid of sections (each ~167x167 units in 0-1000 space).
 *      6x6 vs old 4x4: finer granularity reduces wrong-tag associations on dense pages.
 *      4x4 cells were 250x250 units — tags at opposite ends of a cell got same score.
 *      6x6 cells are ~167x167 — scoring is ~2.25x more precise.
 *   2. Determine which section the symbol bbox center falls in (symbolSection).
 *   3. Assign each token a section index based on its ordinal position in the OCR
 *      text stream (tokens appear roughly top-to-bottom, left-to-right in mupdf output).
 *   4. Score = 0.80 for same section, decaying with Manhattan section distance.
 *
 * Returns score in range [0.10, 0.80] — capped below true spatial score max of 1.0
 * to signal lower certainty vs. when real pixel positions are available.
 */
const GRID_COLS = 6;
const GRID_ROWS = 6;
const SECTION_W = 1000 / GRID_COLS;  // ~167 units per cell
const SECTION_H = 1000 / GRID_ROWS;  // ~167 units per cell

export function sectionSpatialScore(
  symbolBbox: SymbolBBox,
  tokenIndex: number,
  totalTokens: number
): number {
  if (totalTokens === 0) return 0.5;

  // Symbol center → grid cell
  const sc = bboxCenter(symbolBbox);
  const symbolCol = Math.min(GRID_COLS - 1, Math.floor(sc.x / SECTION_W));
  const symbolRow = Math.min(GRID_ROWS - 1, Math.floor(sc.y / SECTION_H));

  // Token ordinal → estimated grid cell.
  // mupdf text order is roughly top-to-bottom, left-to-right.
  // Map linear fraction to row first, then column within that row.
  const tokenFraction = tokenIndex / Math.max(1, totalTokens - 1);
  const tokenRow = Math.min(GRID_ROWS - 1, Math.floor(tokenFraction * GRID_ROWS));
  const withinRow = tokenFraction * GRID_ROWS - tokenRow;
  const tokenCol = Math.min(GRID_COLS - 1, Math.floor(withinRow * GRID_COLS));

  // Manhattan distance in grid cells (max = (GRID_COLS-1)+(GRID_ROWS-1) = 10 for 6x6)
  const gridDist = Math.abs(symbolCol - tokenCol) + Math.abs(symbolRow - tokenRow);

  // Linear decay: 0.80 same cell → 0.10 furthest cell (10 steps)
  return Math.max(0.10, Math.min(0.80, 0.80 - gridDist * 0.07));
}

// ── Main: rank tag candidates for a symbol ────────────────────────────────────

/**
 * Given OCR tokens for a page and a symbol's bounding box,
 * return ranked list of tag candidates ordered by combined score.
 *
 * Fix #3: When token positions are null (mupdf text extraction gives no per-token bbox),
 * use section-based spatial scoring (sectionSpatialScore) instead of flat 0.5 for all.
 * Section scoring uses token ordinal position in OCR stream as a proxy for page location.
 * This differentiates tags on different parts of the page, reducing wrong-tag associations.
 *
 * @param tokens        from extractTagTokens()
 * @param symbolBbox    symbol bounding box in 0-1000 normalized space
 * @param knownTags     optional set of known tags from project knowledge (for knowledge_match flag)
 * @param maxCandidates max candidates to return (default 5)
 */
export function rankTagCandidates(
  tokens: OcrToken[],
  symbolBbox: SymbolBBox,
  knownTags: Set<string> = new Set(),
  maxCandidates = 5
): TagCandidate[] {
  const candidates: TagCandidate[] = [];
  const totalTokens = tokens.length;

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const ocrConf = estimateOcrConfidence(token.text);

    let spatialScore: number;
    let distanceUnits: number | null = null;
    let relPos: string | null = null;

    if (token.x !== null && token.y !== null) {
      // Position available — compute true pixel-based spatial score (unchanged)
      const tokenBbox: SymbolBBox = {
        x: token.x,
        y: token.y,
        width: token.width ?? 30,
        height: token.height ?? 20,
      };
      const sc = bboxCenter(symbolBbox);
      const tc = bboxCenter(tokenBbox);
      distanceUnits = euclidean(sc.x, sc.y, tc.x, tc.y);
      spatialScore = distanceToScore(distanceUnits);
      relPos = relativePosition(symbolBbox, tokenBbox);
    } else {
      // Fix #3: No position data — use section heuristic instead of flat 0.5.
      // Significantly better than flat when page has spatially separated tag groups.
      spatialScore = sectionSpatialScore(symbolBbox, idx, totalTokens);
      // distanceUnits and relPos remain null (no pixel data available)
    }

    const knowledgeMatch = knownTags.has(token.text);

    candidates.push({
      original: token.text,
      normalized: token.text, // normalization applied in F3 (normalizeTagCandidates)
      normalized_by: 'none',
      ocr_confidence: ocrConf,
      spatial_score: spatialScore,
      distance_units: distanceUnits,
      relative_position: relPos,
      source: 'OCR',
      knowledge_match: knowledgeMatch,
    });
  }

  // Sort by combined score: ocr_confidence * 0.6 + spatial_score * 0.4
  candidates.sort((a, b) => {
    const scoreA = a.ocr_confidence * 0.6 + a.spatial_score * 0.4;
    const scoreB = b.ocr_confidence * 0.6 + b.spatial_score * 0.4;
    return scoreB - scoreA;
  });

  return candidates.slice(0, maxCandidates);
}

// ── Best candidate selection ─────────────────────────────────────────────────

/**
 * Select best OCR tag candidate for a symbol.
 *
 * M13 fix: Evidence-based priority chain. Previously returned null whenever
 * visionTag existed but didn't match OCR — discarding valid OCR candidates.
 *
 * Priority:
 *   1. Vision + OCR exact agreement (strongest signal)
 *   2. Vision + OCR normalized agreement (OCR typo corrected to Vision tag)
 *   3. OCR + knowledge match (known tag confirmed by spatial)
 *   4. Strong OCR candidate with high spatial score (Vision tag absent or low confidence)
 *   5. Vision-only (OCR has no candidate) — caller uses Vision tag directly
 *   6. null → NEEDS_REVIEW
 */
export function selectBestCandidate(
  visionTag: string | null,
  candidates: TagCandidate[]
): TagCandidate | null {
  if (candidates.length === 0) return null;

  const visionUpper = visionTag?.toUpperCase() ?? null;

  // Priority 1: Vision + OCR exact agreement
  if (visionUpper) {
    const exact = candidates.find(c => c.normalized === visionUpper);
    if (exact) return exact;
  }

  // Priority 2: Vision + OCR normalized agreement (edit-distance correction matched Vision)
  if (visionUpper) {
    const normalized = candidates.find(
      c => c.normalized === visionUpper && c.normalized_by !== 'none'
    );
    if (normalized) return normalized;
  }

  // Priority 3: OCR + knowledge match with reasonable spatial score
  // Knowledge match = tag seen in project confirmed detections or company KB
  const knowledgeBest = candidates.find(
    c => c.knowledge_match && c.ocr_confidence >= 0.70 && c.spatial_score >= 0.30
  );
  if (knowledgeBest) return knowledgeBest;

  // Priority 4: Strong OCR candidate with spatial evidence
  // Used when: (a) no visionTag, OR (b) visionTag exists but OCR has higher confidence
  // Threshold: ocr_confidence >= 0.75 AND spatial_score >= 0.35 (not just random match)
  const strongOcr = candidates.find(
    c => c.ocr_confidence >= 0.75 && c.spatial_score >= 0.35
  );
  if (strongOcr) {
    // If visionTag exists and strongOcr differs → return strongOcr with conflict signal
    // Caller in detection-worker.ts will see mismatch and add NEEDS_REVIEW evidence
    return strongOcr;
  }

  // Priority 5: Any candidate if no visionTag at all
  if (!visionUpper && candidates[0].ocr_confidence >= 0.65) {
    return candidates[0];
  }

  return null;
}

/**
 * Build a Set of known full asset tags from confirmed detections and company knowledge.
 *
 * Fix #1: Previously this stored only tag_prefix (e.g. "P", "XV") from company_knowledge.
 * That caused edit-distance normalization and char-substitution to always fail because
 * editDistance("P-10I", "P") = 4, never matches threshold of 1.
 *
 * Now accepts entries with optional `asset_tag` (full tag, e.g. "P-101") AND
 * `tag_prefix` (prefix-only, e.g. "P"). Full tags are preferred; prefixes included
 * as fallback for broad matching when no full tags are available.
 *
 * Worker passes confirmed detections' asset_tags + company_knowledge entries.
 */
export function buildKnownTagSet(
  knowledgeEntries: Array<{ tag_prefix: string | null; asset_tag?: string | null }>
): Set<string> {
  const set = new Set<string>();
  for (const e of knowledgeEntries) {
    // Full tag takes priority — this is what edit-distance normalization compares against
    if (e.asset_tag) set.add(e.asset_tag.toUpperCase().trim());
    // Also add prefix for broad knowledge_match coverage (prefix-only entries)
    if (e.tag_prefix && !e.asset_tag) set.add(e.tag_prefix.toUpperCase().trim());
  }
  return set;
}

// ── F3: Tag normalization ────────────────────────────────────────────────────

/**
 * Compute Levenshtein edit distance between two strings.
 * Standard dynamic programming implementation.
 */
export function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  // DP row — reuse single array
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[lb];
}

/**
 * Common OCR character substitution pairs.
 * Key = misread char, Value = correct char.
 * Applied before edit distance check for higher precision correction.
 */
const OCR_CHAR_SUBS: Record<string, string> = {
  'O': '0',  // letter O → digit 0
  '0': 'O',  // digit 0 → letter O (less common but possible in prefix)
  'I': '1',  // letter I → digit 1
  'L': '1',  // letter L → digit 1
  'S': '5',  // letter S → digit 5
  'B': '8',  // letter B → digit 8
  'G': '6',  // letter G → digit 6
  'Z': '2',  // letter Z → digit 2
};

/**
 * Attempt single-character OCR correction on number part of a tag.
 * Only corrects the numeric portion (after dash) to avoid prefix corruption.
 *
 * Example: "P-10I" → try replacing I→1 → "P-101"
 *
 * Returns corrected tag or original if no valid substitution found.
 */
function applyOcrCharSubstitution(token: string, knownTags: Set<string>): string | null {
  const parts = token.split('-');
  if (parts.length !== 2) return null;

  const prefix = parts[0];
  const numPart = parts[1];

  for (let i = 0; i < numPart.length; i++) {
    const char = numPart[i];
    const sub = OCR_CHAR_SUBS[char];
    if (sub) {
      const corrected = prefix + '-' + numPart.slice(0, i) + sub + numPart.slice(i + 1);
      // Only accept if result is in known tags or looks like valid tag format
      if (knownTags.has(corrected) || /^[A-Z]{1,5}-\d+[A-Z]?$/.test(corrected)) {
        return corrected;
      }
    }
  }
  return null;
}

export interface NormalizedTag {
  original: string;
  normalized: string;
  normalized_by: 'none' | 'case' | 'char_substitution' | 'edit_distance_1';
  correction_reason: string | null;
  confidence: number;   // adjusted confidence after normalization
}

/**
 * Normalize a raw OCR tag token using:
 *   1. Case normalization (always)
 *   2. Single OCR char substitution (O↔0, I↔1, etc.) — applied when result is known tag
 *   3. Edit distance 1 match against known tag set — only if result is in known tags
 *
 * RULE: Never normalize without knowledge evidence.
 * If knownTags is empty and no char substitution produces a valid-looking result,
 * returns normalized_by='none' with original value.
 *
 * @param rawToken   raw OCR token (already uppercase)
 * @param knownTags  Set of known tags from project/drawing knowledge
 * @param visionTag  Vision-predicted tag for cross-validation (optional)
 */
export function normalizeTag(
  rawToken: string,
  knownTags: Set<string>,
  visionTag?: string | null
): NormalizedTag {
  const upper = rawToken.toUpperCase();

  // Step 1: If already in known tags → valid, no correction needed
  if (knownTags.has(upper)) {
    return {
      original: rawToken,
      normalized: upper,
      normalized_by: 'none',
      correction_reason: null,
      confidence: estimateOcrConfidence(upper),
    };
  }

  // Step 2: If Vision tag provided and matches after case normalization → confirm
  if (visionTag && upper === visionTag.toUpperCase()) {
    return {
      original: rawToken,
      normalized: upper,
      normalized_by: 'case',
      correction_reason: 'case normalization, confirmed by Vision',
      confidence: estimateOcrConfidence(upper) + 0.05,
    };
  }

  // Step 3: OCR char substitution — apply to numeric part
  const substituted = applyOcrCharSubstitution(upper, knownTags);
  if (substituted && substituted !== upper) {
    // Prefer substituted result if it matches Vision tag or is in known tags
    const matchesVision = visionTag && substituted === visionTag.toUpperCase();
    const matchesKnown = knownTags.has(substituted);
    if (matchesVision || matchesKnown) {
      return {
        original: rawToken,
        normalized: substituted,
        normalized_by: 'char_substitution',
        correction_reason: `OCR char substitution: "${upper}" → "${substituted}"${matchesKnown ? ' (known tag)' : ''}${matchesVision ? ' (matches Vision)' : ''}`,
        confidence: Math.min(0.92, estimateOcrConfidence(upper) + 0.10),
      };
    }
  }

  // Step 4: Edit distance 1 against known tags
  // Only attempt if knownTags is not too large (avoid O(n) on huge sets)
  if (knownTags.size > 0 && knownTags.size <= 500) {
    for (const known of Array.from(knownTags)) {
      if (editDistance(upper, known) === 1) {
        return {
          original: rawToken,
          normalized: known,
          normalized_by: 'edit_distance_1',
          correction_reason: `edit distance 1: "${upper}" → "${known}" (known tag match)`,
          confidence: Math.min(0.88, estimateOcrConfidence(upper) + 0.05),
        };
      }
    }
  }

  // Step 5: Edit distance 1 against Vision tag (if provided and not already tried)
  if (visionTag) {
    const visionUpper = visionTag.toUpperCase();
    if (editDistance(upper, visionUpper) === 1) {
      return {
        original: rawToken,
        normalized: visionUpper,
        normalized_by: 'edit_distance_1',
        correction_reason: `edit distance 1: "${upper}" → "${visionUpper}" (matches Vision prediction)`,
        confidence: Math.min(0.85, estimateOcrConfidence(upper)),
      };
    }
  }

  // No normalization possible — return as-is
  return {
    original: rawToken,
    normalized: upper,
    normalized_by: 'none',
    correction_reason: null,
    confidence: estimateOcrConfidence(upper),
  };
}

/**
 * Normalize all candidates in a ranked list.
 * Mutates normalized/normalized_by fields in-place on a copy.
 *
 * @param candidates   from rankTagCandidates()
 * @param knownTags    known tag set from project knowledge
 * @param visionTag    Vision-predicted tag for cross-validation
 */
export function normalizeTagCandidates(
  candidates: TagCandidate[],
  knownTags: Set<string>,
  visionTag?: string | null
): TagCandidate[] {
  return candidates.map(c => {
    const norm = normalizeTag(c.original, knownTags, visionTag);
    return {
      ...c,
      normalized: norm.normalized,
      normalized_by: norm.normalized_by,
      ocr_confidence: norm.confidence,
    };
  });
}
