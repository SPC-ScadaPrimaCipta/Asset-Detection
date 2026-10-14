/**
 * DXF Entity Extractor — v2
 *
 * Parses .dxf files using dxf-parser and returns structured entities:
 *   - INSERT       : block references with position, scale, rotation
 *   - TEXT / MTEXT : text labels
 *   - LINE         : pipe segments
 *   - LWPOLYLINE   : polylines (pipes, outlines)
 *   - ARC          : arc geometry (common in P&ID symbols)
 *   - CIRCLE       : circle geometry (instrument bubbles, vessels)
 *   - ELLIPSE      : ellipse geometry
 *   - SPLINE       : spline curves (control points)
 *   - SOLID        : filled triangle/quad
 *   - HATCH        : hatch fill (rendered as lightweight boundary)
 *
 * Block Definitions:
 *   dxf.blocks contains named block definitions. Each block holds its own
 *   entity list. When an INSERT is rendered, its block definition is looked
 *   up and the geometry is transformed (translate + scale + rotate) to the
 *   INSERT position. This is what makes AutoCAD rendering look correct.
 *
 * Coordinate system: DXF uses real-world units (mm or inches).
 * Bbox is in DXF world units — caller normalises to 0-1000 space.
 */

import DxfParserModule from 'dxf-parser';

// Resolve constructor across Next.js ESM/Turbopack bundling, tsx, and Node CommonJS.
// In Next.js Turbopack/Webpack, require() or import may yield an ES namespace object { default: [Function: DxfParser] }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DxfParser: any =
  typeof DxfParserModule === 'function'
    ? DxfParserModule
    : (DxfParserModule as any)?.default ?? (DxfParserModule as any)?.DxfParser ?? DxfParserModule;


// ── Types ────────────────────────────────────────────────────────────────────

export interface DxfPoint {
  x: number;
  y: number;
}

export interface DxfInsertEntity {
  kind: 'INSERT';
  blockName: string;
  position: DxfPoint;
  layer: string;
  xScale: number;
  yScale: number;
  rotation: number; // degrees
  /** Attributes attached to this INSERT (ATTRIB entities) */
  attributes: Array<{ tag: string; value: string }>;
}

export interface DxfTextEntity {
  kind: 'TEXT' | 'MTEXT';
  text: string;
  position: DxfPoint;
  layer: string;
  height: number; // text height in DXF units
  color: number;  // ACI color index (0 = BYLAYER, 256 = BYBLOCK)
}

export interface DxfLineEntity {
  kind: 'LINE';
  start: DxfPoint;
  end: DxfPoint;
  layer: string;
  color: number;
}

export interface DxfPolylineEntity {
  kind: 'LWPOLYLINE';
  vertices: DxfPoint[];
  layer: string;
  closed: boolean;
  color: number;
}

export interface DxfArcEntity {
  kind: 'ARC';
  center: DxfPoint;
  radius: number;
  startAngle: number; // degrees
  endAngle: number;   // degrees
  layer: string;
  color: number;
}

export interface DxfCircleEntity {
  kind: 'CIRCLE';
  center: DxfPoint;
  radius: number;
  layer: string;
  color: number;
}

export interface DxfEllipseEntity {
  kind: 'ELLIPSE';
  center: DxfPoint;
  /** Major axis endpoint (relative to center) */
  majorAxis: DxfPoint;
  /** Ratio of minor to major axis */
  axisRatio: number;
  startAngle: number; // radians
  endAngle: number;   // radians
  layer: string;
  color: number;
}

export interface DxfSplineEntity {
  kind: 'SPLINE';
  /** Control points */
  controlPoints: DxfPoint[];
  layer: string;
  color: number;
}

export interface DxfSolidEntity {
  kind: 'SOLID';
  /** Corners (3 or 4) */
  points: DxfPoint[];
  layer: string;
  color: number;
}

export type DxfEntity =
  | DxfInsertEntity
  | DxfTextEntity
  | DxfLineEntity
  | DxfPolylineEntity
  | DxfArcEntity
  | DxfCircleEntity
  | DxfEllipseEntity
  | DxfSplineEntity
  | DxfSolidEntity;

/** A named block definition containing its own entities */
export interface DxfBlockDef {
  name: string;
  /** Base point of the block (insertion origin) */
  base: DxfPoint;
  entities: DxfEntity[];
}

export interface DxfPageExtents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface DxfParseResult {
  entities: DxfEntity[];
  /** Named block definitions (INSERT geometry) */
  blocks: Record<string, DxfBlockDef>;
  /** All unique layer names found */
  layers: string[];
  /** Layer → category heuristic (pipe/instrument/text/other) */
  layerMap: Record<string, string>;
  /** Bounding box of all entities in DXF world units */
  extents: DxfPageExtents;
  /** Block definition names */
  blockNames: string[];
  /** Raw block definitions for geometry expansion in renderer */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks: Record<string, any>;
  /** Raw DXF header variables useful for units conversion */
  units: number; // $INSUNITS DXF code: 0=unitless, 4=mm, 6=m, etc.

}

// ── Layer category heuristic ─────────────────────────────────────────────────

const PIPE_LAYER_PATTERNS  = [/pipe/i, /piping/i, /process/i, /fluid/i, /flow/i, /line/i];
const INSTR_LAYER_PATTERNS = [/instr/i, /instrument/i, /tag/i, /signal/i, /control/i];
const TEXT_LAYER_PATTERNS  = [/text/i, /annot/i, /label/i, /note/i, /dim/i];
const EQUIP_LAYER_PATTERNS = [/equip/i, /vessel/i, /pump/i, /valve/i, /symbol/i, /mech/i];

function categoriseLayer(name: string): string {
  if (PIPE_LAYER_PATTERNS.some((r) => r.test(name)))  return 'pipe';
  if (INSTR_LAYER_PATTERNS.some((r) => r.test(name))) return 'instrument';
  if (TEXT_LAYER_PATTERNS.some((r) => r.test(name)))  return 'text';
  if (EQUIP_LAYER_PATTERNS.some((r) => r.test(name))) return 'equipment';
  return 'other';
}

// ── Coord helpers ─────────────────────────────────────────────────────────────

function pt(raw: { x?: number; y?: number } | undefined): DxfPoint {
  return { x: raw?.x ?? 0, y: raw?.y ?? 0 };
}

function expandExtents(
  ext: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number,
) {
  if (!isFinite(x) || !isFinite(y)) return;
  if (x < ext.minX) ext.minX = x;
  if (y < ext.minY) ext.minY = y;
  if (x > ext.maxX) ext.maxX = x;
  if (y > ext.maxY) ext.maxY = y;
}

// ── Entity parser helper ──────────────────────────────────────────────────────

/**
 * Parse a single raw entity object into a typed DxfEntity.
 * Returns null for unsupported types.
 */
function parseEntity(
  e: Record<string, unknown>,
  ext: { minX: number; minY: number; maxX: number; maxY: number },
): DxfEntity | null {
  const type  = String(e.type  ?? '').toUpperCase();
  const layer = String(e.layer ?? '0');
  // ACI color: 0 = BYLAYER (inherit), 256 = BYBLOCK
  const color = Number(e.colorIndex ?? e.color ?? 0);

  if (type === 'INSERT') {
    const pos = pt(e.position as { x?: number; y?: number });
    expandExtents(ext, pos.x, pos.y);

    const attrs: DxfInsertEntity['attributes'] = [];
    const attribs = e.attribs as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(attribs)) {
      for (const a of attribs) {
        attrs.push({
          tag:   String(a.tag   ?? ''),
          value: String(a.value ?? a.text ?? ''),
        });
      }
    }

    return {
      kind:       'INSERT',
      blockName:  String(e.name ?? e.block ?? ''),
      position:   pos,
      layer,
      xScale:     Number(e.xScale   ?? 1),
      yScale:     Number(e.yScale   ?? 1),
      rotation:   Number(e.rotation ?? 0),
      attributes: attrs,
    };
  }

  if (type === 'TEXT' || type === 'MTEXT') {
    const pos    = pt((e.position ?? e.insertionPoint) as { x?: number; y?: number });
    const rawText = String(e.text ?? e.string ?? '').trim();
    if (!rawText) return null;
    expandExtents(ext, pos.x, pos.y);
    return {
      kind:     type as 'TEXT' | 'MTEXT',
      text:     rawText,
      position: pos,
      layer,
      height:   Number(e.textHeight ?? e.height ?? 0),
      color,
    };
  }

  if (type === 'LINE') {
    const start = pt(e.start as { x?: number; y?: number });
    const end   = pt(e.end   as { x?: number; y?: number });
    expandExtents(ext, start.x, start.y);
    expandExtents(ext, end.x,   end.y);
    return { kind: 'LINE', start, end, layer, color };
  }

  if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    const verts = (e.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
    const pts: DxfPoint[] = verts.map(pt);
    pts.forEach((p) => expandExtents(ext, p.x, p.y));
    if (pts.length < 2) return null;
    return {
      kind:     'LWPOLYLINE',
      vertices: pts,
      layer,
      closed:   Boolean(e.closed ?? false),
      color,
    };
  }

  if (type === 'ARC') {
    const center = pt(e.center as { x?: number; y?: number });
    const r      = Number(e.radius ?? 0);
    expandExtents(ext, center.x - r, center.y - r);
    expandExtents(ext, center.x + r, center.y + r);
    return {
      kind:       'ARC',
      center,
      radius:     r,
      startAngle: Number(e.startAngle ?? 0),
      endAngle:   Number(e.endAngle   ?? 360),
      layer,
      color,
    };
  }

  if (type === 'CIRCLE') {
    const center = pt(e.center as { x?: number; y?: number });
    const r      = Number(e.radius ?? 0);
    expandExtents(ext, center.x - r, center.y - r);
    expandExtents(ext, center.x + r, center.y + r);
    return { kind: 'CIRCLE', center, radius: r, layer, color };
  }

  if (type === 'ELLIPSE') {
    const center    = pt(e.center    as { x?: number; y?: number });
    const majorAxis = pt(e.majorAxis as { x?: number; y?: number });
    const majorLen  = Math.hypot(majorAxis.x, majorAxis.y);
    expandExtents(ext, center.x - majorLen, center.y - majorLen);
    expandExtents(ext, center.x + majorLen, center.y + majorLen);
    return {
      kind:       'ELLIPSE',
      center,
      majorAxis,
      axisRatio:  Number(e.axisRatio  ?? 1),
      startAngle: Number(e.startAngle ?? 0),
      endAngle:   Number(e.endAngle   ?? Math.PI * 2),
      layer,
      color,
    };
  }

  if (type === 'SPLINE') {
    const cps = (e.controlPoints as Array<{ x?: number; y?: number }> | undefined) ?? [];
    const ctrlPts: DxfPoint[] = cps.map(pt);
    ctrlPts.forEach((p) => expandExtents(ext, p.x, p.y));
    if (ctrlPts.length < 2) return null;
    return { kind: 'SPLINE', controlPoints: ctrlPts, layer, color };
  }

  if (type === 'SOLID' || type === '3DFACE') {
    const corners: DxfPoint[] = [];
    const keys = ['corner1', 'corner2', 'corner3', 'corner4'];
    for (const k of keys) {
      if (e[k]) {
        const p = pt(e[k] as { x?: number; y?: number });
        corners.push(p);
        expandExtents(ext, p.x, p.y);
      }
    }
    if (corners.length < 3) return null;
    return { kind: 'SOLID', points: corners, layer, color };
  }

  return null;
}

// ── Block definition extractor ────────────────────────────────────────────────

function extractBlocks(
  rawBlocks: Record<string, unknown>,
): Record<string, DxfBlockDef> {
  const result: Record<string, DxfBlockDef> = {};
  const dummyExt = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (const [name, rawBlock] of Object.entries(rawBlocks)) {
    // Skip AutoCAD internal blocks (paper space, model space)
    if (name.startsWith('*')) continue;

    const b = rawBlock as Record<string, unknown>;
    const base = pt(b.position as { x?: number; y?: number });

    const rawEntities = (b.entities ?? []) as Array<Record<string, unknown>>;
    const entities: DxfEntity[] = [];

    for (const raw of rawEntities) {
      const parsed = parseEntity(raw, dummyExt);
      if (parsed) entities.push(parsed);
    }

    result[name] = { name, base, entities };
  }

  return result;
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a DXF file buffer and return structured entities + block definitions.
 *
 * Supports: LINE, LWPOLYLINE/POLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE, SOLID,
 *           3DFACE, INSERT (with ATTRIB), TEXT, MTEXT.
 *
 * NOTE: Binary DXF (AutoCAD 2013+ option) is NOT supported — save as ASCII DXF.
 */
export function parseDxf(buffer: Buffer): DxfParseResult {
  // Binary DXF guard
  const BINARY_MAGIC = 'AutoCAD Binary DXF';
  if (buffer.length > 20 && buffer.slice(0, 18).toString('ascii') === BINARY_MAGIC) {
    throw new Error(
      'Binary DXF format is not supported. Re-save as ASCII: ' +
      'AutoCAD → Save As → AutoCAD DXF (*.dxf) → Tools → DXF Options → ASCII.',
    );
  }
  const probe     = buffer.slice(0, 128);
  let nullCount   = 0;
  for (let i = 0; i < probe.length; i++) if (probe[i] === 0) nullCount++;
  if (nullCount > 4) {
    throw new Error('File appears to be binary. Please export/save as ASCII DXF format.');
  }

  const parser = new DxfParser();
  let dxf: ReturnType<typeof parser.parseSync> | null = null;
  const encodings: BufferEncoding[] = ['utf-8', 'latin1'];

  for (const enc of encodings) {
    try {
      let text = buffer.toString(enc);
      if (enc === 'utf-8') {
        text = text.replace(/^\uFEFF/, '');
      }
      dxf = parser.parseSync(text);

      break;
    } catch (e) {
      if (enc === encodings[encodings.length - 1]) {
        throw new Error(
          `DXF parse failed (tried ${encodings.join(', ')}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  if (!dxf) throw new Error('DXF parse returned empty result');

  const entities: DxfEntity[] = [];
  const layerSet = new Set<string>();
  // Two-pass: first collect all entities, then compute clean extents
  // filtering out degenerate origin-area artifacts.
  const ext = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  // ── Process entities ────────────────────────────────────────────────────────
  const rawEntities: unknown[] = dxf?.entities ?? [];

  for (const raw of rawEntities) {
    const e = raw as Record<string, unknown>;
    const type = String(e.type ?? '').toUpperCase();
    const layer = String(e.layer ?? '0');
    layerSet.add(layer);

    if (type === 'INSERT') {
      const pos = pt(e.position as { x?: number; y?: number });

      // Collect ATTRIB children if present
      const attrs: DxfInsertEntity['attributes'] = [];
      const attribs = e.attribs as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(attribs)) {
        for (const a of attribs) {
          attrs.push({
            tag: String(a.tag ?? ''),
            value: String(a.value ?? a.text ?? ''),
          });
        }
      }

      entities.push({
        kind: 'INSERT',
        blockName: String(e.name ?? e.block ?? ''),
        position: pos,
        layer,
        xScale: Number(e.xScale ?? 1),
        yScale: Number(e.yScale ?? 1),
        rotation: Number(e.rotation ?? 0),
        attributes: attrs,
      });
    } else if (type === 'TEXT' || type === 'MTEXT') {
      const pos = pt((e.position ?? e.insertionPoint) as { x?: number; y?: number });
      const rawText = String(e.text ?? e.string ?? '').trim();
      if (rawText) {
        entities.push({
          kind: type as 'TEXT' | 'MTEXT',
          text: rawText,
          position: pos,
          layer,
          height: Number(e.textHeight ?? e.height ?? 0),
        });
      }
    } else if (type === 'LINE') {
      const start = pt(e.start as { x?: number; y?: number });
      const end = pt(e.end as { x?: number; y?: number });
      // Skip degenerate zero-length lines
      if (Math.hypot(start.x - end.x, start.y - end.y) < 0.0001) continue;
      entities.push({ kind: 'LINE', start, end, layer });
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const verts = (e.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
      const pts: DxfPoint[] = verts.map(pt);
      if (pts.length >= 2) {
        entities.push({
          kind: 'LWPOLYLINE',
          vertices: pts,
          layer,
          closed: Boolean(e.closed ?? false),
        });
      }
    }
  }

  }

  // ── Compute extents (origin-artifact-resistant) ──────────────────────────────
  // Collect candidate bounds from all entities, then reject outliers that are
  // far (>10x median distance) from the drawing centroid. This removes stray
  // lines/inserts at (0,0) that are artefacts of CAD templates.
  type Pt = { x: number; y: number };
  const allPts: Pt[] = [];
  for (const entity of entities) {
    if (entity.kind === 'LINE') {
      allPts.push(entity.start, entity.end);
    } else if (entity.kind === 'LWPOLYLINE') {
      allPts.push(...entity.vertices);
    } else if (entity.kind === 'INSERT' || entity.kind === 'TEXT' || entity.kind === 'MTEXT') {
      allPts.push(entity.position);
    }
  }

  if (allPts.length > 0) {
    // Compute median centroid (robust to outliers)
    const xs = allPts.map((p) => p.x).sort((a, b) => a - b);
    const ys = allPts.map((p) => p.y).sort((a, b) => a - b);
    const medX = xs[Math.floor(xs.length / 2)];
    const medY = ys[Math.floor(ys.length / 2)];

    // Compute median deviation in each axis
    const dxs = allPts.map((p) => Math.abs(p.x - medX)).sort((a, b) => a - b);
    const dys = allPts.map((p) => Math.abs(p.y - medY)).sort((a, b) => a - b);
    const madX = dxs[Math.floor(dxs.length / 2)] || 1;
    const madY = dys[Math.floor(dys.length / 2)] || 1;

    // Reject points more than 15× MAD from median (very aggressive outlier removal)
    const OUTLIER_FACTOR = 15;
    for (const p of allPts) {
      if (
        Math.abs(p.x - medX) <= OUTLIER_FACTOR * madX &&
        Math.abs(p.y - medY) <= OUTLIER_FACTOR * madY
      ) {
        expandExtents(ext, p.x, p.y);
      }
    }
  }

  // Guard against empty drawing
  if (!isFinite(ext.minX)) {
    ext.minX = 0; ext.minY = 0; ext.maxX = 1000; ext.maxY = 1000;
  }

  const extents: DxfPageExtents = {
    minX: ext.minX,
    minY: ext.minY,
    maxX: ext.maxX,
    maxY: ext.maxY,
    width:  ext.maxX - ext.minX,
    height: ext.maxY - ext.minY,
  };

  const layers = [...layerSet].sort();
  const layerMap: Record<string, string> = {};
  for (const l of layers) layerMap[l] = categoriseLayer(l);

  const blockNames = Object.keys(dxf?.blocks ?? {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: Record<string, any> = dxf?.blocks ?? {};
  const units = Number(dxf?.header?.$INSUNITS ?? 0);

  return { entities, layers, layerMap, extents, blockNames, blocks, units };

}

// ── Coordinate normalisation to 0-1000 space ─────────────────────────────────

/**
 * Convert a DXF world-unit point to 0-1000 normalised space.
 * DXF Y-axis is inverted relative to screen space (origin bottom-left).
 */
export function dxfToNorm(
  p: DxfPoint,
  extents: DxfPageExtents,
): DxfPoint {
  const x = extents.width  > 0
    ? Math.round(((p.x - extents.minX) / extents.width)  * 1000) : 0;
  const y = extents.height > 0
    ? Math.round(((extents.maxY - p.y) / extents.height) * 1000) : 0;
  return {
    x: Math.max(0, Math.min(1000, x)),
    y: Math.max(0, Math.min(1000, y)),
  };
}
