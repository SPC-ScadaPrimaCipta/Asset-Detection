/**
 * Piping Line Specification & Size Parser
 *
 * Extracts nominal pipe size, service code, and specification/sequence
 * from P&ID piping line numbers (both horizontal and vertical lines).
 * Supports imperial notation (with curly/straight quotes and fractions) and metric DN.
 */

export interface ParsedLineSpec {
  rawText: string;
  pipeSize: string;
  service?: string;
  spec?: string;
}

// Matches pipe size at beginning of line spec:
// e.g. 2", 2”, 4", 1/2", 1-1/2", 0.75", DN100, DN 50
const PIPE_SIZE_REGEX = /^(\d+(?:\s*-\s*\d+)?(?:\/\d+)?|\d+(?:\.\d+)?)\s*["”'’]|^(DN\s*\d+)/i;

/**
 * Extract normalized pipe size string (e.g. '2"', '1-1/2"', 'DN100') from text.
 */
export function extractSizeFromLineSpec(text: string): string | null {
  if (!text) return null;
  const clean = text.trim();
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
 * Parses full line spec text (e.g., '2” - WS - B - 007' or '4” - NG - B3CS2F - 01 - 004').
 * Returns ParsedLineSpec or null if not a piping line specification.
 */
export function parseLineSpecText(text: string): ParsedLineSpec | null {
  if (!text) return null;
  const clean = text.trim();
  const pipeSize = extractSizeFromLineSpec(clean);
  if (!pipeSize) return null;

  // Must have a separator following the size to be considered a line spec
  // Separators: hyphen (-), en-dash (– \u2013), em-dash (— \u2014)
  const afterSize = clean.replace(PIPE_SIZE_REGEX, '').trim();
  if (!afterSize || !/^[\-\u2013\u2014]/.test(afterSize)) {
    // If it's just the size without line spec, return size with raw text
    return {
      rawText: clean,
      pipeSize,
    };
  }

  // Split remainder by hyphens / dashes
  const remainder = afterSize.replace(/^[\-\u2013\u2014]\s*/, '');
  const parts = remainder.split(/\s*[\-\u2013\u2014]\s*/).filter(Boolean);

  const service = parts[0] || undefined;
  const spec = parts.slice(1).join('-') || undefined;

  return {
    rawText: clean,
    pipeSize,
    service,
    spec,
  };
}
