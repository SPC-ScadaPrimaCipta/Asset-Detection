/**
 * MDO Description Assembly Engine
 *
 * Implements the Alternative Description Rule by PT Accenture Indonesia:
 * OUTPUT = [Prefix-] + Equipment Type + [Size] + [OF ...] + [FROM ...] + [TO ...] + [AT ...]
 *
 * Key principle: Clean Omission (bagian yang kosong tidak dipaksakan masuk).
 */

export interface AssembleDescriptionParams {
  locationPrefix?: string | null;  // e.g. "MTR" or "GRS-"
  equipmentTypeShort: string;       // e.g. "PT", "PIPE", "BV", "CKV"
  size?: string | null;            // e.g. "2", "1/2\"", "4\""
  ofValue?: string | null;         // e.g. "HEADER LINE"
  fromValue?: string | null;       // e.g. "SDV-1012"
  toValue?: string | null;         // e.g. "VENT"
  atValue?: string | null;         // e.g. "WELLHEAD" or "DISCHARGE NOZZLE"
}

/**
 * Standard ISA-5.1 Instrument identification letter combinations
 * representing sensing, transmitting, indicating, or analytical devices.
 * Instruments do not transport fluid and therefore never have FROM or TO.
 */
export const INSTRUMENT_SHORT_CODES = new Set([
  // Transmitters
  'PT', 'TT', 'FT', 'LT', 'DPT', 'PDT', 'AT', 'ST', 'VT', 'IT', 'ZT', 'WT',
  // Indicators & Gauges
  'PI', 'TI', 'FI', 'LI', 'AI', 'PG', 'TG', 'LG', 'FG', 'DPG',
  // Elements & Sensors
  'TE', 'FE', 'LE', 'PE', 'SE',
  // Switches & Alarms
  'PSH', 'PSL', 'TSH', 'TSL', 'LSH', 'LSL', 'FSH', 'FSL',
  'PALL', 'PAHH', 'TALL', 'TAHH', 'LALL', 'LAHH', 'FALL', 'FAHH',
  'PDI', 'PDIT', 'PDIS', 'WIT',
]);

/**
 * Checks whether an asset is a measurement/sensing instrument.
 * Instruments tap into process lines/vessels to measure variables.
 * They NEVER transport or discharge process fluid, so FROM = null and TO = null.
 *
 * Note: Control valves (CV, FV, PV, LV, TV) and relief valves (PSV, PRV, BDV)
 * are in-line piping valves through which fluid flows, so they DO have FROM and TO.
 */
export function isInstrumentAsset(assetType?: string | null, shortType?: string | null): boolean {
  const s = (shortType || '').trim().toUpperCase();
  if (INSTRUMENT_SHORT_CODES.has(s)) return true;
  const combined = `${assetType || ''} ${shortType || ''}`.trim().toUpperCase();
  if (
    combined.includes('INSTRUMENT') ||
    combined.includes('TRANSMITTER') ||
    combined.includes('GAUGE') ||
    combined.includes('INDICATOR') ||
    combined.includes('SENSOR') ||
    combined.includes('METER') ||
    combined.includes('THERMOCOUPLE') ||
    combined.includes('RTD')
  ) {
    // Exclude actual in-line valves that happen to have 'valve' in name or end with 'V'
    if (combined.includes('VALVE') || s.endsWith('V')) {
      return false;
    }
    return true;
  }
  return false;
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

  // Instrument Process Rule: Instruments never have fluid flow, so FROM and TO are strictly omitted
  const isInstrument = isInstrumentAsset(undefined, params.equipmentTypeShort);

  // 4. FROM (Origin)
  const fromClean = isInstrument ? null : cleanMdoFieldValue(params.fromValue);
  if (fromClean) {
    parts.push(`FROM ${fromClean.toUpperCase()}`);
  }

  // 5. TO (Destination)
  const toClean = isInstrument ? null : cleanMdoFieldValue(params.toValue);
  if (toClean) {
    parts.push(`TO ${toClean.toUpperCase()}`);
  }

  // 6. AT (Location / Specific Installation Point)
  const atClean = cleanMdoFieldValue(params.atValue);
  if (atClean) {
    parts.push(`AT ${atClean.toUpperCase()}`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
