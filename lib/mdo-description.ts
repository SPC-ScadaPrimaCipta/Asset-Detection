/**
 * MDO Description Assembly Engine
 *
 * Implements the Alternative Description Rule by PT Accenture Indonesia:
 * OUTPUT = [Prefix-] + Equipment Type + [Size] + [OF ...] + [FROM ...] + [TO ...]
 *
 * Key principle: Clean Omission (bagian yang kosong tidak dipaksakan masuk).
 */

export interface AssembleDescriptionParams {
  locationPrefix?: string | null;  // e.g. "MTR" or "GRS-"
  equipmentTypeShort: string;       // e.g. "PT", "PIPE", "BV", "CKV"
  size?: string | null;            // e.g. "2", "1/2\"", "4\""
  ofValue?: string | null;         // e.g. "HEADER LINE"
  fromValue?: string | null;       // e.g. "SDV-1012"
  toValue?: string | null;         // e.g. "PRESSURE TRANSMITTER A"
}

/**
 * Normalizes an MDO attribute value, stripping leading keyword markers
 * (e.g. "FROM TK-101" -> "TK-101") and invalid placeholder characters.
 */
export function cleanMdoFieldValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  // Strip common leading relation label prefixes if included in raw input
  s = s.replace(/^(?:FROM|TO|OF|AT)\s*[:\-]?\s+/i, '');
  // Strip trailing punctuation
  s = s.replace(/[,.;:]+$/, '').trim();
  if (
    !s ||
    s.toLowerCase() === 'null' ||
    s.toLowerCase() === 'none' ||
    s === '—' ||
    s === '-' ||
    s === 'n/a'
  ) {
    return null;
  }
  return s;
}

/**
 * Formats size with standard inch symbol ("), removing redundant quotes.
 */
export function formatSizeInches(rawSize: string | null | undefined): string | null {
  if (!rawSize) return null;
  const cleaned = cleanMdoFieldValue(rawSize);
  if (!cleaned) return null;
  // Strip existing quotes
  const numPart = cleaned.replace(/^["']+|["']+$/g, '').trim();
  if (!numPart || numPart === '-' || numPart.toLowerCase() === 'null') {
    return null;
  }
  return `${numPart}"`;
}

/**
 * Assembles the full Accenture-compliant description.
 */
export function assembleMdoDescription(params: AssembleDescriptionParams): string {
  const parts: string[] = [];

  // 1. Prefix / Location + Equipment Type (e.g. "MTR-PIPE" or "GRS-PT")
  let prefix = (params.locationPrefix ?? '').trim().replace(/[-_\s]+$/, '');
  const eqp = (params.equipmentTypeShort ?? '').trim().toUpperCase();
  if (prefix && eqp) {
    parts.push(`${prefix}-${eqp}`);
  } else if (eqp) {
    parts.push(eqp);
  } else if (prefix) {
    parts.push(prefix);
  }

  // 2. Size (e.g. "2\"" or "1/2\"")
  const sizeFormatted = formatSizeInches(params.size);
  if (sizeFormatted) {
    parts.push(sizeFormatted);
  }

  // 3. OF (Context / Header Line / Subsystem)
  const ofClean = cleanMdoFieldValue(params.ofValue);
  if (ofClean) {
    parts.push(`OF ${ofClean.toUpperCase()}`);
  }

  // 4. FROM (Origin)
  const fromClean = cleanMdoFieldValue(params.fromValue);
  if (fromClean) {
    parts.push(`FROM ${fromClean.toUpperCase()}`);
  }

  // 5. TO (Destination)
  const toClean = cleanMdoFieldValue(params.toValue);
  if (toClean) {
    parts.push(`TO ${toClean.toUpperCase()}`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
