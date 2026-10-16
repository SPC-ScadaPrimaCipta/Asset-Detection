/**
 * Smart Tag Abbreviation & Project-Level Incremental Tag Allocator
 *
 * Implements:
 * 1. Standard ISA 5.1 / PIP P&ID equipment abbreviation suggestions
 * 2. Acronym heuristic generation for custom equipment names
 * 3. Pattern formatting (e.g. GTV-### or GTV-####)
 * 4. Project-level collision-free incremental tag allocation
 */

// ── Standard ISA / PIP P&ID Abbreviation Dictionary ───────────────────────
const STANDARD_PREFIX_MAP: Array<{ match: RegExp; prefix: string }> = [
  // Valves
  { match: /\bgate\s*valve\b/i, prefix: 'GTV' },
  { match: /\bball\s*valve\b/i, prefix: 'BV' },
  { match: /\bglobe\s*valve\b/i, prefix: 'GLV' },
  { match: /\bcheck\s*valve\b/i, prefix: 'CV' },
  { match: /\bcontrol\s*valve\b/i, prefix: 'FCV' },
  { match: /\bbutterfly\s*valve\b/i, prefix: 'BFV' },
  { match: /\bneedle\s*valve\b/i, prefix: 'NV' },
  { match: /\bplug\s*valve\b/i, prefix: 'PV' },
  { match: /\bdiaphragm\s*valve\b/i, prefix: 'DV' },
  { match: /\brotary\s*valve\b/i, prefix: 'RV' },
  { match: /\bsolenoid\s*valve\b/i, prefix: 'SOV' },
  { match: /\bpressure\s*(?:safety|relief)\s*valve\b|\bpsv\b/i, prefix: 'PSV' },
  { match: /\brupture\s*disk\b/i, prefix: 'RD' },
  { match: /\bvalve\b/i, prefix: 'VLV' },

  // Rotating & Static Equipment
  { match: /\bcentrifugal\s*pump\b|\bpump\b/i, prefix: 'P' },
  { match: /\bcompressor\b/i, prefix: 'C' },
  { match: /\bheat\s*exchanger\b|\bcooler\b|\bcondenser\b/i, prefix: 'E' },
  { match: /\btank\b|\bstorage\s*tank\b/i, prefix: 'TK' },
  { match: /\bvessel\b|\bdrum\b|\bcolumn\b/i, prefix: 'V' },
  { match: /\bfurnace\b|\bheater\b|\bboiler\b/i, prefix: 'H' },
  { match: /\bfilter\b|\bstrainer\b/i, prefix: 'FLT' },
  { match: /\bmotor\b/i, prefix: 'M' },
  { match: /\bfan\b|\bblower\b/i, prefix: 'B' },
  { match: /\bsight\s*glass\b/i, prefix: 'SG' },
  { match: /\bflange\b|\bnozzle\b/i, prefix: 'FLG' },
  { match: /\breducer\b/i, prefix: 'RED' },

  // Instruments & Transmitters (ISA 5.1)
  { match: /\bpressure\s*transmitter\b|\bpt\b/i, prefix: 'PT' },
  { match: /\bpressure\s*indicator\b|\bpi\b/i, prefix: 'PI' },
  { match: /\bpressure\s*controller\b|\bpc\b/i, prefix: 'PC' },
  { match: /\btemperature\s*transmitter\b|\btt\b/i, prefix: 'TT' },
  { match: /\btemperature\s*indicator\b|\bti\b/i, prefix: 'TI' },
  { match: /\btemperature\s*controller\b|\btc\b/i, prefix: 'TC' },
  { match: /\bflow\s*transmitter\b|\bft\b/i, prefix: 'FT' },
  { match: /\bflow\s*indicator\b|\bfi\b/i, prefix: 'FI' },
  { match: /\blevel\s*transmitter\b|\blt\b/i, prefix: 'LT' },
  { match: /\blevel\s*indicator\b|\bli\b/i, prefix: 'LI' },
  { match: /\blevel\s*gauge\b|\blg\b/i, prefix: 'LG' },
  { match: /\binstrument\b/i, prefix: 'INST' },
];

/**
 * Suggests an industrial standard abbreviation / prefix for an asset type or symbol name.
 * If not in the standard map, creates an acronym heuristic from capitalized words.
 */
export function suggestAbbreviation(assetType: string, symbolName?: string | null): string {
  const combined = `${symbolName ?? ''} ${assetType ?? ''}`.trim();

  // 1. Check standard map
  for (const entry of STANDARD_PREFIX_MAP) {
    if (entry.match.test(combined)) {
      return entry.prefix;
    }
  }

  // 2. Acronym heuristic for custom equipment
  const words = assetType
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      const lower = w.toLowerCase();
      return (
        w.length > 0 &&
        !['and', 'or', 'of', 'with', 'the', 'a', 'in', 'on', 'type', 'symbol'].includes(lower)
      );
    });

  if (words.length >= 2) {
    // E.g. "High Pressure Separator" -> "HPS"
    return words.map((w) => w[0].toUpperCase()).join('').slice(0, 5);
  }

  if (words.length === 1 && words[0].length > 0) {
    const single = words[0].toUpperCase();
    return single.length <= 4 ? single : single.slice(0, 3);
  }

  return 'EQ';
}

/**
 * Format prefix into a standard tag pattern (e.g. GTV, 3 -> GTV-###).
 */
export function formatTagPattern(prefix: string, digits = 3): string {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'EQ';
  const hashes = '#'.repeat(Math.max(1, digits));
  return `${cleanPrefix}-${hashes}`;
}

export interface ParsedTagPattern {
  prefix: string;
  digits: number;
  delimiter: string;
}

/**
 * Extracts the prefix, delimiter, and digit count from a pattern like "GTV-###" or "P-####" or "TK001".
 */
export function extractPrefixAndDigitsFromPattern(pattern: string): ParsedTagPattern {
  const trimmed = pattern.trim().toUpperCase();
  // Match letters, optional delimiter (-, _, or empty), followed by hashes or digits
  const m = trimmed.match(/^([A-Z]+)([-_]?)(#+|\d+)$/);
  if (m) {
    const prefix = m[1];
    const delimiter = m[2] || '';
    const digitsCount = m[3].length > 0 ? m[3].length : 3;
    return { prefix, digits: digitsCount, delimiter };
  }

  // Fallback if no digits/hashes specified (e.g. "GTV" or "P-")
  const m2 = trimmed.match(/^([A-Z]+)([-_]?)$/);
  if (m2) {
    return { prefix: m2[1], digits: 3, delimiter: m2[2] || '-' };
  }

  return { prefix: trimmed.replace(/[^A-Z0-9]/g, '') || 'EQ', digits: 3, delimiter: '-' };
}

/**
 * Allocates the next collision-free incremental tag for a project.
 *
 * Scans all existing tags in the project matching `${prefix}[-_]?(\d+)`.
 * Finds the highest number, and increments it by 1, formatted with padding digits.
 */
export function allocateNextProjectTag(
  prefix: string,
  existingProjectTags: Set<string> | string[],
  digits = 3,
): string {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const tagSet = existingProjectTags instanceof Set
    ? existingProjectTags
    : new Set(existingProjectTags);

  // Regex matching existing tags for this prefix, e.g. GTV-001 or GTV001 or gtv-002
  const prefixRegex = new RegExp(`^${cleanPrefix}[-_]?(\\d+)$`, 'i');

  let maxNum = 0;
  for (const tag of tagSet) {
    if (!tag || typeof tag !== 'string') continue;
    const m = tag.trim().match(prefixRegex);
    if (m && m[1]) {
      const num = parseInt(m[1], 10);
      if (Number.isFinite(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let nextNum = maxNum + 1;
  let candidateTag = `${cleanPrefix}-${String(nextNum).padStart(digits, '0')}`;

  // Extra safety guard: ensure candidateTag is never in tagSet (handles any suffix collisions)
  while (tagSet.has(candidateTag.toUpperCase())) {
    nextNum++;
    candidateTag = `${cleanPrefix}-${String(nextNum).padStart(digits, '0')}`;
  }

  return candidateTag;
}

export interface AutoTaggableDetection {
  assetTag: string | null;
  assetType: string;
  legendSymbol?: string | null;
  evidence: string[];
  detEvidence?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface LegendSymbolTagPatternRef {
  id?: string;
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
}

export interface AutoTagOptions {
  existingProjectTags: Set<string>;
  legendSymbols?: LegendSymbolTagPatternRef[];
  defaultDigits?: number;
}

/**
 * Loads all currently allocated asset tags for a project to ensure collision-free tag allocation.
 */
export async function loadProjectExistingTags(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  projectId: string | null | undefined,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!projectId) return set;

  try {
    const res = await db.query(
      `SELECT DISTINCT UPPER(TRIM(d.asset_tag)) AS tag
       FROM detections d
       JOIN documents doc ON doc.id = d.document_id
       WHERE doc.project_id = $1
         AND d.asset_tag IS NOT NULL
         AND TRIM(d.asset_tag) != ''`,
      [projectId],
    );
    for (const row of res.rows) {
      if (typeof row.tag === 'string' && row.tag.length > 0) {
        set.add(row.tag);
      }
    }
  } catch (err) {
    console.warn(`[AutoTag] Failed to query existing project tags for project ${projectId}:`, err);
  }

  return set;
}

/**
 * Applies project-level unique incremental auto-tagging to detections that do not have an OCR tag.
 *
 * 1. Honors symbol-level `tag_pattern` configured in the Legend.
 * 2. Falls back to standard ISA/PIP abbreviation when no pattern is configured.
 * 3. Enforces uniqueness across the entire project by checking and updating `existingProjectTags`.
 * 4. Records [Auto-Tag] evidence on every generated item for auditability.
 */
export function applyProjectAutoTagging<T extends AutoTaggableDetection>(
  detections: T[],
  options: AutoTagOptions,
): { generatedCount: number } {
  const { existingProjectTags, legendSymbols = [], defaultDigits = 3 } = options;
  let generatedCount = 0;

  // Step 1: Pre-register any non-empty detected tags in this batch into the set
  // to prevent collision if an OCR tag matches the prefix in this batch.
  for (const det of detections) {
    if (det.assetTag && det.assetTag.trim().length > 0) {
      existingProjectTags.add(det.assetTag.trim().toUpperCase());
    }
  }

  // Step 2: For any item missing a tag, allocate next incremental tag
  for (const det of detections) {
    if (det.assetTag && det.assetTag.trim().length > 0) {
      continue;
    }

    // Resolve matching legend symbol to check configured tag_pattern
    let pattern: string | null = null;
    if (legendSymbols.length > 0) {
      const matched = legendSymbols.find(
        (s) =>
          (det.legendSymbol && (s.id === det.legendSymbol || s.symbol_name === det.legendSymbol || s.asset_type === det.legendSymbol)) ||
          s.asset_type.toLowerCase() === det.assetType.toLowerCase() ||
          (s.symbol_name && s.symbol_name.toLowerCase() === det.assetType.toLowerCase()),
      );
      if (matched?.tag_pattern) {
        pattern = matched.tag_pattern;
      }
    }

    let prefix = '';
    let digits = defaultDigits;

    if (pattern) {
      const parsed = extractPrefixAndDigitsFromPattern(pattern);
      prefix = parsed.prefix;
      digits = parsed.digits;
    } else {
      prefix = suggestAbbreviation(det.assetType, det.legendSymbol);
    }

    const allocatedTag = allocateNextProjectTag(prefix, existingProjectTags, digits);
    existingProjectTags.add(allocatedTag.toUpperCase());

    det.assetTag = allocatedTag;
    if (!Array.isArray(det.evidence)) {
      det.evidence = [];
    }
    det.evidence.push(`[Auto-Tag] Generated unique project tag ${allocatedTag} (${prefix})`);

    if (det.detEvidence && typeof det.detEvidence === 'object') {
      det.detEvidence.autoGeneratedTag = true;
      det.detEvidence.allocatedPrefix = prefix;
    }

    generatedCount++;
  }

  return { generatedCount };
}

