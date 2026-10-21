/**
 * Deterministic asset-type inference from detection evidence.
 *
 * Used only when the normal resolution chain produced UNKNOWN. It never
 * invents information: it re-reads text that is already in the evidence
 * (legend symbol match, OCR description, vision reason) and maps it to a type.
 * When nothing can be inferred the caller decides between a generic
 * "Equipment" fallback and dropping the detection.
 */
import { isJunkAssetType } from './duplicate-detection';

export interface LegendSymbolRef {
  symbol_name?: string | null;
  asset_type?: string | null;
  tag_pattern?: string | null;
}

export interface TypeInferenceInput {
  evidence: unknown;
  assetTag?: string | null;
  legendSymbols?: LegendSymbolRef[];
}

export interface TypeInferenceResult {
  assetType: string;
  reason: string;
}

/** Longer/more specific patterns first — the first hit wins. */
const KEYWORD_TYPES: Array<[RegExp, string]> = [
  [/\bflare\s*stack\b/i, 'Flare Stack'],
  [/\bvent\s*stack\b/i, 'Vent Stack'],
  [/\baerator\b/i, 'Aerator'],
  [/\bwaste\s*pit\b/i, 'Waste Pit'],
  [/\bshipping\s*tank\b/i, 'Tank'],
  [/\bhorizontal\s*vessel\b/i, 'Vessel'],
  [/\bvertical\s*vessel\b/i, 'Vessel'],
  [/\bspectacle\s*blind\b/i, 'Spectacle Blind'],
  [/\beccentric\s*reducer\b/i, 'Eccentric Reducer'],
  [/\bconcentric\s*reducer\b/i, 'Concentric Reducer'],
  [/\breducer\b/i, 'Reducer'],
  [/\bstrainer\b/i, 'Strainer'],
  [/\bthermowell\b/i, 'Thermowell'],
  [/\blevel\s*gauge\b/i, 'Level Gauge'],
  [/\brupture\s*disc\b/i, 'Rupture Disc'],
  [/\bstatic\s*mixer\b/i, 'Static Mixer'],
  [/\bflame\s*arrestor\b/i, 'Flame Arrestor'],
  [/\bpressure\s*(?:safety|relief)\s*valve\b/i, 'Pressure Safety Valve'],
  [/\bplate\s*heat\s*exchanger\b/i, 'Plate Heat Exchanger'],
  [/\bheat\s*exchanger\b/i, 'Heat Exchanger'],
  [/\bcentrifugal\s*pump\b/i, 'Centrifugal Pump'],
  [/\bpositive\s*displacement\s*pump\b/i, 'Positive Displacement Pump'],
  [/\breciprocating\s*compressor\b/i, 'Reciprocating Compressor'],
  [/\bcentrifugal\s*compressor\b/i, 'Centrifugal Compressor'],
  [/\bbutterfly\s*valve\b/i, 'Butterfly Valve'],
  [/\bneedle\s*valve\b/i, 'Needle Valve'],
  [/\bgate\s*valve\b/i, 'Gate Valve'],
  [/\bglobe\s*valve\b/i, 'Globe Valve'],
  [/\bball\s*valve\b/i, 'Ball Valve'],
  [/\bcheck\s*valve\b/i, 'Check Valve'],
  [/\bcontrol\s*valve\b/i, 'Control Valve'],
  [/\bplug\s*valve\b/i, 'Plug Valve'],
  [/\borifice\s*plate\b/i, 'Orifice Plate'],
  [/\borifice\b/i, 'Orifice'],
  [/\bseparator\b/i, 'Separator'],
  [/\bsilencer\b/i, 'Silencer'],
  [/\banaly[sz]er\b/i, 'Analyzer'],
  [/\bcentrifuge\b/i, 'Centrifuge'],
  [/\bcolumn\b/i, 'Column'],
  [/\btank\b/i, 'Tank'],
  [/\bvessel\b/i, 'Vessel'],
  [/\bpump\b/i, 'Pump'],
  [/\bcompressor\b/i, 'Compressor'],
  [/\bfilter\b/i, 'Filter'],
  [/\bblower\b/i, 'Blower'],
  [/\bmotor\b/i, 'Electric Motor'],
  [/\bfan\b/i, 'Fan'],
];

function evidenceText(evidence: unknown): string {
  if (Array.isArray(evidence)) return evidence.join('\n');
  if (typeof evidence === 'string') return evidence;
  if (evidence && typeof evidence === 'object') return JSON.stringify(evidence);
  return '';
}

function normalize(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titleish(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function typeFromTagPattern(tag: string | null | undefined, symbols: LegendSymbolRef[]): string | null {
  if (!tag) return null;
  const upper = tag.toUpperCase();
  for (const symbol of symbols) {
    const pattern = symbol.tag_pattern?.trim();
    const type = symbol.asset_type?.trim();
    if (!pattern || !type || isJunkAssetType(type)) continue;
    const prefix = pattern.split(/[-#*]/)[0]?.toUpperCase();
    if (prefix && prefix.length >= 1 && upper.startsWith(prefix)) return type;
  }
  return null;
}

/**
 * Infer a type from text already present in the evidence. Returns null when
 * the evidence contains no usable signal.
 */
export function inferAssetTypeFromEvidence(
  input: TypeInferenceInput,
): TypeInferenceResult | null {
  const text = normalize(evidenceText(input.evidence));
  if (!text) return null;

  // 1. Legend symbol / asset type explicitly named in the evidence.
  //    Longest first so "GATE VALVE" wins over "VALVE".
  const legendCandidates = (input.legendSymbols ?? [])
    .flatMap((s) => [
      { label: s.symbol_name, type: s.asset_type },
      { label: s.asset_type, type: s.asset_type },
    ])
    .map((c) => ({ label: normalize(c.label ?? ''), type: (c.type ?? '').trim() }))
    .filter((c) => c.label.length >= 5 && c.type && !isJunkAssetType(c.type))
    .sort((a, b) => b.label.length - a.label.length);

  for (const candidate of legendCandidates) {
    if (text.includes(candidate.label)) {
      return { assetType: candidate.type, reason: `legend match "${candidate.label}"` };
    }
  }

  // 2. Equipment keywords in visible descriptions / vision reasons.
  for (const [pattern, type] of KEYWORD_TYPES) {
    const hit = pattern.exec(text);
    if (hit) {
      return { assetType: type, reason: `evidence text "${hit[0]}"` };
    }
  }

  // 3. Tag prefix declared by the active legend.
  const fromTag = typeFromTagPattern(input.assetTag, input.legendSymbols ?? []);
  if (fromTag) return { assetType: titleish(fromTag), reason: `tag prefix "${input.assetTag}"` };

  return null;
}

/** Synthetic tags created by auto-tagging; never real asset tags. */
export function isSyntheticTag(tag: string | null | undefined): boolean {
  return !!tag && /^UNK[-_ ]?\d+$/i.test(tag.trim());
}

export const GENERIC_ASSET_TYPE = 'Equipment';
