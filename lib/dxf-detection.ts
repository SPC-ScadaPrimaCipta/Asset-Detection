/**
 * DXF Detection Pipeline
 *
 * Converts parsed DXF entities into structured detections — same schema as
 * PDF/Gemini detections so the rest of the pipeline (rule-validator, worker,
 * DB persistence) is unchanged.
 *
 * Strategy:
 *   1. INSERT blocks  → direct symbol detection (high confidence, no AI needed)
 *   2. TEXT/MTEXT     → spatial association to nearest INSERT / LINE segment
 *   3. Exploded-only  → group primitive lines into candidate symbols via
 *                       bounding-box clustering, then match to legend
 *   4. Gemini fallback (optional) for unmatched blocks not in legend
 *
 * Confidence bands:
 *   INSERT + tag matched to legend  → 0.95
 *   INSERT + tag no legend match    → 0.80
 *   INSERT + no tag                 → 0.72
 *   Clustered lines matched         → 0.60
 *   Clustered lines unmatched       → 0.45
 */

import {
  parseDxf,
  dxfToNorm,
  type DxfParseResult,
  type DxfInsertEntity,
  type DxfTextEntity,
  type DxfPoint,
} from '@/lib/dxf-parser';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LegendSymbolRef {
  id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  aliases: string[];
}

export interface DxfDetection {
  assetTag: string | null;
  assetType: string;
  confidence: number;
  /** bbox in 0-1000 normalised space */
  bbox: { x: number; y: number; width: number; height: number };
  evidence: string[];
  /** DXF block name if from INSERT entity */
  blockName: string | null;
  layer: string;
  /** Source of detection */
  source: 'INSERT' | 'CLUSTER' | 'ATTRIBUTE';
  /** Raw DXF position in world units */
  rawPosition: DxfPoint;
}

export interface DxfDetectionResult {
  detections: DxfDetection[];
  /** page is always 1 for DXF (single drawing) */
  page: 1;
  parseStats: {
    totalEntities: number;
    insertCount: number;
    textCount: number;
    lineCount: number;
    unmatchedInserts: number;
  };
}

// ── Legend block-name matching ────────────────────────────────────────────────

/**
 * Normalise a block name for matching: lowercase, strip underscores/hyphens/spaces.
 */
function normName(s: string): string {
  return s.toLowerCase().replace(/[\s_\-]+/g, '');
}

function matchBlockToLegend(
  blockName: string,
  legend: LegendSymbolRef[],
): LegendSymbolRef | null {
  const norm = normName(blockName);
  for (const sym of legend) {
    const names = [
      sym.symbol_name ?? '',
      sym.asset_type,
      ...(sym.aliases ?? []),
    ].map(normName).filter(Boolean);
    if (names.some((n) => n === norm || norm.includes(n) || n.includes(norm))) {
      return sym;
    }
  }
  return null;
}

// ── Tag pattern matching ──────────────────────────────────────────────────────

function buildTagRegex(pattern: string): RegExp {
  const esc = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
    .replace(/#/g, '\\d')
    .replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

function matchTagToLegend(tag: string, legend: LegendSymbolRef[]): LegendSymbolRef | null {
  for (const sym of legend) {
    if (!sym.tag_pattern) continue;
    try {
      if (buildTagRegex(sym.tag_pattern).test(tag)) return sym;
    } catch {
      // invalid pattern — skip
    }
  }
  return null;
}

// ── Spatial association ───────────────────────────────────────────────────────

/**
 * Distance between two DXF world-unit points.
 */
function dist(a: DxfPoint, b: DxfPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Find the nearest INSERT entity to a text label.
 * Returns the INSERT and distance, or null if nothing within maxDist.
 */
function nearestInsert(
  textPos: DxfPoint,
  inserts: DxfInsertEntity[],
  maxDist: number,
): { insert: DxfInsertEntity; distance: number } | null {
  let best: DxfInsertEntity | null = null;
  let bestDist = maxDist;
  for (const ins of inserts) {
    const d = dist(textPos, ins.position);
    if (d < bestDist) {
      bestDist = d;
      best = ins;
    }
  }
  return best ? { insert: best, distance: bestDist } : null;
}

// ── Symbolic bbox estimation ──────────────────────────────────────────────────

/**
 * Estimate a normalised bbox for an INSERT entity.
 * DXF blocks don't always carry explicit extent — use a fixed size
 * proportional to the drawing extents.
 */
function estimateBbox(
  pos: DxfPoint,
  extents: DxfParseResult['extents'],
  symbolSizeRatio = 0.02,
): DxfDetection['bbox'] {
  const halfW = extents.width * symbolSizeRatio;
  const halfH = extents.height * symbolSizeRatio;
  const center = dxfToNorm(pos, extents);
  const w = Math.max(
    10,
    Math.round((halfW * 2 / extents.width) * 1000),
  );
  const h = Math.max(
    10,
    Math.round((halfH * 2 / extents.height) * 1000),
  );
  return {
    x: Math.max(0, center.x - Math.round(w / 2)),
    y: Math.max(0, center.y - Math.round(h / 2)),
    width: w,
    height: h,
  };
}

// ── Main detection function ───────────────────────────────────────────────────

/**
 * Run DXF detection pipeline on a buffer.
 *
 * @param buffer   Raw .dxf file bytes
 * @param legend   Legend symbols for matching (can be empty)
 * @param maxAssocDist  Max DXF-world-unit distance for tag→symbol spatial
 *                      association. Defaults to 5% of drawing width.
 */
export function runDxfDetection(
  buffer: Buffer,
  legend: LegendSymbolRef[] = [],
  maxAssocDistFraction = 0.05,
): DxfDetectionResult {
  const parsed = parseDxf(buffer);
  const { entities, extents } = parsed;

  const maxAssocDist =
    Math.max(extents.width, extents.height) * maxAssocDistFraction;

  // Separate entity types
  const inserts = entities.filter((e): e is DxfInsertEntity => e.kind === 'INSERT');
  const texts = entities.filter((e): e is DxfTextEntity => e.kind === 'TEXT' || e.kind === 'MTEXT');
  const lineCount = entities.filter((e) => e.kind === 'LINE' || e.kind === 'LWPOLYLINE').length;

  // Track which inserts have been assigned a tag (to avoid double-assign)
  const insertTagMap = new Map<DxfInsertEntity, string>();

  // 1. Extract tags from ATTRIB entities attached to INSERTs
  for (const ins of inserts) {
    if (ins.attributes.length > 0) {
      // Prefer the first non-empty attribute value as the tag
      const tagAttr = ins.attributes.find((a) => a.value.trim());
      if (tagAttr) insertTagMap.set(ins, tagAttr.value.trim());
    }
  }

  // 2. Spatially associate TEXT/MTEXT to nearest INSERT
  for (const txt of texts) {
    const match = nearestInsert(txt.position, inserts, maxAssocDist);
    if (!match) continue;
    // Only assign if no attrib tag yet, or if this text is closer
    if (!insertTagMap.has(match.insert)) {
      insertTagMap.set(match.insert, txt.text);
    }
  }

  // 3. Build detections from INSERTs
  const detections: DxfDetection[] = [];
  let unmatchedInserts = 0;

  for (const ins of inserts) {
    const tag = insertTagMap.get(ins) ?? null;
    const bbox = estimateBbox(ins.position, extents);

    // Match block name to legend
    let legendMatch = matchBlockToLegend(ins.blockName, legend);
    // If no block match but we have a tag, try tag pattern match
    if (!legendMatch && tag) {
      legendMatch = matchTagToLegend(tag, legend);
    }

    const assetType = legendMatch?.asset_type ?? ins.blockName ?? 'UNKNOWN';
    const evidence: string[] = [`DXF INSERT block: ${ins.blockName}`];
    if (tag) evidence.push(`Tag from DXF: ${tag}`);
    if (legendMatch) evidence.push(`Legend match: ${legendMatch.symbol_name ?? legendMatch.asset_type}`);

    let confidence: number;
    if (legendMatch && tag) confidence = 0.95;
    else if (legendMatch && !tag) confidence = 0.80;
    else if (!legendMatch && tag) confidence = 0.72;
    else {
      confidence = 0.55;
      unmatchedInserts++;
    }

    detections.push({
      assetTag: tag,
      assetType,
      confidence,
      bbox,
      evidence,
      blockName: ins.blockName,
      layer: ins.layer,
      source: 'INSERT',
      rawPosition: ins.position,
    });
  }

  // 4. Orphan TEXT entities not associated to any INSERT → may be standalone tags
  //    that belong to exploded symbols. Log as low-confidence ATTRIBUTE detections.
  const assignedTexts = new Set<DxfTextEntity>();
  for (const ins of inserts) {
    const tag = insertTagMap.get(ins);
    if (!tag) continue;
    // Find which text entity provided this tag
    const src = texts.find((t) => t.text === tag);
    if (src) assignedTexts.add(src);
  }

  for (const txt of texts) {
    if (assignedTexts.has(txt)) continue;
    // Only emit if text looks like an asset tag (has hyphen + digits pattern, optional suffix)
    if (!/[A-Z]{1,6}-\d{2,6}[A-Z]*/i.test(txt.text)) continue;
    const bbox = estimateBbox(txt.position, extents, 0.015);
    const legendMatch = matchTagToLegend(txt.text, legend);
    detections.push({
      assetTag: txt.text,
      assetType: legendMatch?.asset_type ?? 'UNKNOWN',
      confidence: legendMatch ? 0.65 : 0.45,
      bbox,
      evidence: [
        `Orphan DXF text tag: ${txt.text}`,
        legendMatch ? `Legend tag-pattern match: ${legendMatch.symbol_name ?? legendMatch.asset_type}` : 'No legend match — needs review',
      ],
      blockName: null,
      layer: txt.layer,
      source: 'ATTRIBUTE',
      rawPosition: txt.position,
    });
  }

  return {
    detections,
    page: 1,
    parseStats: {
      totalEntities: entities.length,
      insertCount: inserts.length,
      textCount: texts.length,
      lineCount,
      unmatchedInserts,
    },
  };
}
