/**
 * Detection V2 — canonical Legend reference model (TypeScript mirror).
 *
 * Python source: services/cv/legend_model.py. JSON keys IDENTICAL.
 * The ORIGINAL legend label is preserved verbatim — it is NOT an asset type.
 */
import type { PageBox } from '@/lib/detection/geometry/coordinate-transform';

export interface LegendGeometry {
  aspectRatio: number;
  relativeArea: number;
  width: number;
  height: number;
}

export interface LegendVisualFeatures {
  huMoments: number[];
  edgeDensity: number;
  lineCount: number;
  componentCount: number;
  contourCount: number;
  templateSize: number[];
}

export interface LegendTemplateVariant {
  variantId: string;
  bbox: PageBox;
  aspectRatio: number;
  area: number;
  normalizedPng: string;
  huMoments: number[];
  edgeDensity: number;
  lineCount: number;
  source: string;
}

export type LegendValidationStatus = 'validated' | 'review' | 'rejected';

export interface LegendDefinitionSource {
  documentId?: string;
  pageNumber: number;
  regionId?: string;
  rowId?: string;
  bbox: PageBox;
}

export interface LegendDefinitionSymbol {
  bbox: PageBox;
  center?: { x: number; y: number };
  rawCropPath?: string;
  normalizedCropPath?: string;
  width?: number;
  height?: number;
}

export interface LegendDefinitionText {
  value: string;
  normalizedValue: string;
  bbox: PageBox;
  confidence?: number;
}

export interface LegendDefinition {
  id?: string;
  legendId: string;
  symbolId: string;
  classId?: string;
  /** Original legend label, verbatim — never treated as asset type here. */
  label: string;
  /** Normalized, browser-safe label used for semantic grouping / dedupe. */
  normalizedLabel?: string;
  /** Explicit/configurable aliases only — never invented by matching. */
  aliases: string[];
  category: string;
  bbox: PageBox;
  geometry: LegendGeometry;
  visualFeatures: LegendVisualFeatures;
  variants: LegendTemplateVariant[];
  sourcePage: number;
  source?: LegendDefinitionSource;
  symbol?: LegendDefinitionSymbol;
  text?: LegendDefinitionText;
  status?: LegendValidationStatus;
  rotationInvariant: boolean;
  provenance: string[];
  version: string;
}

export function normalizeLegendLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function coerceLegendDefinition(raw: Partial<LegendDefinition> = {}): LegendDefinition {
  const label = String(raw.label ?? raw.text?.value ?? raw.symbol?.rawCropPath ?? '').trim();
  const normalizedLabel = normalizeLegendLabel(raw.normalizedLabel ?? label);
  const width = Number(raw.bbox?.width ?? raw.symbol?.bbox?.width ?? raw.source?.bbox?.width ?? 0);
  const height = Number(raw.bbox?.height ?? raw.symbol?.bbox?.height ?? raw.source?.bbox?.height ?? 0);
  const x = Number(raw.bbox?.x ?? raw.symbol?.bbox?.x ?? raw.source?.bbox?.x ?? 0);
  const y = Number(raw.bbox?.y ?? raw.symbol?.bbox?.y ?? raw.source?.bbox?.y ?? 0);
  const symbolBox: PageBox = { x, y, width, height };

  const pageNumber = Number(raw.sourcePage ?? raw.source?.pageNumber ?? 1);
  const resolvedStatus = (() => {
    const explicit = String(raw.status ?? '').toLowerCase();
    if (explicit === 'rejected' || explicit === 'review' || explicit === 'validated') {
      return explicit as LegendValidationStatus;
    }
    if (!label) return 'rejected';
    if (width <= 0 || height <= 0) return 'rejected';
    if (Number(raw.geometry?.aspectRatio ?? 0) <= 0 || Number(raw.geometry?.relativeArea ?? 0) <= 0) return 'review';
    return 'validated';
  })();

  const def: LegendDefinition = {
    id: String(raw.id ?? raw.symbolId ?? ''),
    legendId: String(raw.legendId ?? ''),
    symbolId: String(raw.symbolId ?? raw.id ?? 'symbol-missing'),
    classId: String(raw.classId ?? raw.symbolId ?? raw.id ?? 'class-missing'),
    label,
    normalizedLabel,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
    category: String(raw.category ?? ''),
    bbox: symbolBox,
    geometry: {
      aspectRatio: Number(raw.geometry?.aspectRatio ?? 0),
      relativeArea: Number(raw.geometry?.relativeArea ?? 0),
      width: Number(raw.geometry?.width ?? width),
      height: Number(raw.geometry?.height ?? height),
    },
    visualFeatures: {
      huMoments: Array.isArray(raw.visualFeatures?.huMoments) ? raw.visualFeatures.huMoments.map(Number) : [],
      edgeDensity: Number(raw.visualFeatures?.edgeDensity ?? 0),
      lineCount: Number(raw.visualFeatures?.lineCount ?? 0),
      componentCount: Number(raw.visualFeatures?.componentCount ?? 0),
      contourCount: Number(raw.visualFeatures?.contourCount ?? 0),
      templateSize: Array.isArray(raw.visualFeatures?.templateSize) ? raw.visualFeatures.templateSize.map(Number) : [128, 128],
    },
    variants: Array.isArray(raw.variants) ? raw.variants as LegendTemplateVariant[] : [],
    sourcePage: Number.isFinite(pageNumber) ? pageNumber : 1,
    source: raw.source ?? {
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : 1,
      bbox: symbolBox,
    },
    symbol: raw.symbol ?? {
      bbox: symbolBox,
      center: { x: x + width / 2, y: y + height / 2 },
      width,
      height,
    },
    text: raw.text ?? {
      value: label,
      normalizedValue: normalizedLabel,
      bbox: symbolBox,
      confidence: 1,
    },
    status: resolvedStatus,
    rotationInvariant: Boolean(raw.rotationInvariant),
    provenance: Array.isArray(raw.provenance) ? raw.provenance.map(String) : [],
    version: String(raw.version ?? 'legacy'),
  };

  def.source = { ...def.source, bbox: def.bbox, pageNumber: def.sourcePage };
  def.symbol = { ...def.symbol, bbox: def.bbox, width: def.bbox.width, height: def.bbox.height };
  def.text = { ...def.text, value: def.label, normalizedValue: def.normalizedLabel ?? normalizeLegendLabel(def.label), bbox: def.bbox };
  return def;
}

export function summarizeLegendDefinitions(defs: Array<Partial<LegendDefinition>>): {
  validated: number;
  review: number;
  rejected: number;
  uniqueClasses: number;
  duplicateReferences: number;
} {
  const coerced = defs.map((d) => coerceLegendDefinition(d));
  const counts = { validated: 0, review: 0, rejected: 0 };
  const classMap = new Map<string, number>();
  const seenByLabel = new Map<string, number>();

  for (const d of coerced) {
    const status = d.status ?? 'validated';
    counts[status] += 1;
    const key = (d.normalizedLabel || normalizeLegendLabel(d.label) || d.symbolId).trim();
    if (key) {
      classMap.set(key, (classMap.get(key) ?? 0) + 1);
      seenByLabel.set(key, (seenByLabel.get(key) ?? 0) + 1);
    }
  }

  const duplicateCount = Array.from(seenByLabel.values()).reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  return {
    ...counts,
    uniqueClasses: classMap.size,
    duplicateReferences: duplicateCount,
  };
}

export interface LegendMatchFeatures {
  geometryScore: number;
  contourScore: number;
  templateScore: number;
  edgeScore: number;
  scaleScore: number;
  rotationScore: number;
}

export interface LegendMatch {
  legendSymbolId: string;
  legendId: string;
  selectedLegendId?: string;
  label: string;
  variantId: string;
  features: LegendMatchFeatures;
  score: number;
  reasons: string[];
}

export interface LegendMatchResult {
  candidateId: string;
  matches: LegendMatch[];
  warning?: string;
  matchFrom?: string;
  queryBox?: { x: number; y: number; width: number; height: number };
  direct?: LegendMatch[] | null;
  reconstructed?: LegendMatch[] | null;
  reconstruction?: { used: boolean; reason: string; [key: string]: unknown };
  refineNotes?: string[];
}

export interface MatchInstrumentation {
  attempted: number;
  skippedGeometry: number;
  skippedContour: number;
  fullComparisons: number;
  accepted: number;
  timings: Record<string, number>;
}

/** Initial engineering thresholds — Phase 6 calibrates, never final. */
export interface LegendMatchThresholds {
  minGeometry: number;
  minContour: number;
  minTemplate: number;
  maxCandidates: number;
}

export const DEFAULT_LEGEND_THRESHOLDS: LegendMatchThresholds = {
  minGeometry: 0.3,
  minContour: 0.3,
  minTemplate: 0.2,
  maxCandidates: 5,
};
