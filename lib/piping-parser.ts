/**
 * Piping Line Specification & Size Parser
 *
 * Extracts nominal pipe size, service code, and specification/sequence
 * from P&ID piping line numbers (both horizontal and vertical lines).
 * Supports imperial notation (with curly/straight quotes and fractions) and metric DN.
 *
 * Also supports pressure-class shorthand format:
 *   3/4"-800#, 8"-150#, 1/2"-800#, 2"FL, 4"-300#RF
 * These appear on P&ID DXF drawings as valve/fitting size labels.
 */

export interface ParsedLineSpec {
  rawText: string;
  pipeSize: string;
  service?: string;
  spec?: string;
}

// Matches pipe size at beginning of line spec.
// Accepts straight and curly single/double quotes (AutoCAD DXF may use either).
// e.g. 2", 2\u201d, 4", 1/2", 1-1/2", 0.75", DN100, DN 50
const QUOTE_CHARS = `["\u201d'\u2019]`;
const PIPE_SIZE_REGEX = new RegExp(
  `^(\\d+(?:\\s*-\\s*\\d+)?(?:\\/\\d+)?|\\d+(?:\\.\\d+)?)\\s*${QUOTE_CHARS}|^(DN\\s*\\d+)`,
  'i'
);

/**
 * Pressure-class shorthand: [size]"[separator?][class]
 * Examples: 3/4"-800#, 8"-150#, 1/2"-800#, 2"FL, 4"-300#RF, 6"-600#RF
 * The entire text must match this pattern (no extra parts after the class).
 */
const PRESSURE_CLASS_RE = new RegExp(
  `^(\\d+(?:\\/\\d+)?(?:-\\d+)?(?:\\.\\d+)?)\\s*${QUOTE_CHARS}-?(\\d+(?:#|\\s*(?:LB|lb))?|[A-Z]{1,4}(?:#)?(?:[A-Z]{1,2})?)\\s*$`
);

/**
 * Extract normalized pipe size string (e.g. '2"', '1-1/2"', 'DN100') from text.
 */
export function extractSizeFromLineSpec(text: string): string | null {
  if (!text) return null;
  const clean = text.trim();

  // Try pressure-class shorthand first (e.g. 3/4"-800#, 2"FL)
  const pcMatch = clean.match(PRESSURE_CLASS_RE);
  if (pcMatch) {
    const numPart = pcMatch[1].replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
    return `${numPart}"`;
  }

  const match = clean.match(PIPE_SIZE_REGEX);
  if (!match) return null;

  if (match[2]) {
    // Metric DN
    return match[2].replace(/\s+/g, '').toUpperCase();
  }

  // Imperial
  const numPart = match[1].replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
  return `${numPart}"`;
}

/**
 * Parses full line spec text.
 *
 * Handles two formats:
 *   1. Pressure-class shorthand: "3/4\"-800#" → pipeSize="3/4\"", spec="800#"
 *   2. Full line spec: "2\" - WS - B - 007" → pipeSize="2\"", service="WS", spec="B-007"
 *
 * Returns ParsedLineSpec or null if text is not a piping spec.
 */
export function parseLineSpecText(text: string): ParsedLineSpec | null {
  if (!text) return null;
  const clean = text.trim();

  // 1. Pressure-class shorthand (e.g. 3/4"-800#, 8"-150#, 2"FL)
  const pcMatch = clean.match(PRESSURE_CLASS_RE);
  if (pcMatch) {
    const numPart = pcMatch[1].replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
    const pipeSize = `${numPart}"`;
    const specPart = pcMatch[2].trim();
    return {
      rawText: clean,
      pipeSize,
      spec: specPart || undefined,
    };
  }

  // 2. Standard line spec
  const pipeSize = extractSizeFromLineSpec(clean);
  if (!pipeSize) return null;

  // Must have a separator following the size to be considered a full line spec
  // Separators: hyphen (-), en-dash (– \u2013), em-dash (— \u2014)
  const afterSize = clean.replace(PIPE_SIZE_REGEX, '').trim();
  if (!afterSize || !/^[-\u2013\u2014]/.test(afterSize)) {
    // Size only, no service/spec parts
    return {
      rawText: clean,
      pipeSize,
    };
  }

  // Split remainder by hyphens / dashes
  const remainder = afterSize.replace(/^[-\u2013\u2014]\s*/, '');
  const parts = remainder.split(/\s*[-\u2013\u2014]\s*/).filter(Boolean);

  const service = parts[0] || undefined;
  const spec = parts.slice(1).join('-') || undefined;

  return {
    rawText: clean,
    pipeSize,
    service,
    spec,
  };
}
