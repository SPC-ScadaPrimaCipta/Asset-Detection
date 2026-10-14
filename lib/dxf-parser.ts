/**
 * DXF Entity Extractor
 *
 * Parses .dxf files using dxf-parser and returns structured entities:
 *   - INSERT: block references (symbols) with position + block name
 *   - TEXT / MTEXT: text labels with position
 *   - LINE / LWPOLYLINE: pipe segments with start/end coords
 *
 * Coordinate system: DXF uses real-world units (mm or inches).
 * Bbox is expressed in DXF world units — caller normalises to 0-1000 space
 * using the page extents computed here.
 */

// dxf-parser exports the constructor as the module default (not a named export).
// `require('dxf-parser')` returns the constructor function directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DxfParser = require('dxf-parser');

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
}

export interface DxfLineEntity {
  kind: 'LINE';
  start: DxfPoint;
  end: DxfPoint;
  layer: string;
}

export interface DxfPolylineEntity {
  kind: 'LWPOLYLINE';
  vertices: DxfPoint[];
  layer: string;
  closed: boolean;
}

export type DxfEntity =
  | DxfInsertEntity
  | DxfTextEntity
  | DxfLineEntity
  | DxfPolylineEntity;

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
  /** All unique layer names found */
  layers: string[];
  /** Layer → category heuristic (pipe/instrument/text/other) */
  layerMap: Record<string, string>;
  /** Bounding box of all entities in DXF world units */
  extents: DxfPageExtents;
  /** Block definitions (name → list of sub-entities) */
  blockNames: string[];
  /** Raw DXF header variables useful for units conversion */
  units: number; // $INSUNITS DXF code: 0=unitless, 4=mm, 6=m, etc.
}

// ── Layer category heuristic ─────────────────────────────────────────────────

const PIPE_LAYER_PATTERNS = [/pipe/i, /piping/i, /process/i, /fluid/i, /flow/i, /line/i];
const INSTR_LAYER_PATTERNS = [/instr/i, /instrument/i, /tag/i, /signal/i, /control/i];
const TEXT_LAYER_PATTERNS = [/text/i, /annot/i, /label/i, /note/i, /dim/i];
const EQUIP_LAYER_PATTERNS = [/equip/i, /vessel/i, /pump/i, /valve/i, /symbol/i, /equip/i, /mech/i];

function categoriseLayer(name: string): string {
  if (PIPE_LAYER_PATTERNS.some((r) => r.test(name))) return 'pipe';
  if (INSTR_LAYER_PATTERNS.some((r) => r.test(name))) return 'instrument';
  if (TEXT_LAYER_PATTERNS.some((r) => r.test(name))) return 'text';
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
  if (x < ext.minX) ext.minX = x;
  if (y < ext.minY) ext.minY = y;
  if (x > ext.maxX) ext.maxX = x;
  if (y > ext.maxY) ext.maxY = y;
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a DXF file buffer and return structured entities.
 * Uses dxf-parser (npm) which handles ASCII DXF R12 through R2018.
 *
 * NOTE: Binary DXF (AutoCAD 2013+ option) is NOT supported.
 * When saving from AutoCAD, use "Save As" → DXF → select ASCII format.
 *
 * Encoding: DXF files from AutoCAD can be UTF-8 or Windows-1252/Latin-1.
 * Try UTF-8 first; if the parser throws, fall back to Latin-1.
 */
export function parseDxf(buffer: Buffer): DxfParseResult {
  // Binary DXF starts with "AutoCAD Binary DXF\r\n"
  const BINARY_MAGIC = 'AutoCAD Binary DXF';
  if (buffer.length > 20 && buffer.slice(0, 18).toString('ascii') === BINARY_MAGIC) {
    throw new Error(
      'Binary DXF format is not supported. Please re-save your DXF file in ASCII format: ' +
      'AutoCAD → Save As → Files of type: AutoCAD DXF (*.dxf) → Tools → Options → DXF Options → ASCII.'
    );
  }

  // Also check for other binary indicators (null bytes in first 128 bytes)
  const probe = buffer.slice(0, 128);
  let nullCount = 0;
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) nullCount++;
  }
  if (nullCount > 4) {
    throw new Error(
      'File appears to be binary (not ASCII DXF). Please export/save as ASCII DXF format.'
    );
  }

  const parser = new DxfParser();

  // Try UTF-8 first, then Latin-1 fallback (common for AutoCAD files with
  // non-ASCII layer names or title-block text).
  let dxf: ReturnType<typeof parser.parseSync> | null = null;
  const encodings: BufferEncoding[] = ['utf-8', 'latin1'];

  for (const enc of encodings) {
    try {
      const text = buffer.toString(enc);
      dxf = parser.parseSync(text);
      break;
    } catch (e) {
      if (enc === encodings[encodings.length - 1]) {
        throw new Error(
          `DXF parse failed (tried ${encodings.join(', ')}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  if (!dxf) {
    throw new Error('DXF parse returned empty result');
  }

  const entities: DxfEntity[] = [];
  const layerSet = new Set<string>();
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
      expandExtents(ext, pos.x, pos.y);

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
      expandExtents(ext, pos.x, pos.y);
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
      expandExtents(ext, start.x, start.y);
      expandExtents(ext, end.x, end.y);
      entities.push({ kind: 'LINE', start, end, layer });
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const verts = (e.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
      const pts: DxfPoint[] = verts.map(pt);
      pts.forEach((p) => expandExtents(ext, p.x, p.y));
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

  // Guard against empty drawing
  if (!isFinite(ext.minX)) {
    ext.minX = 0; ext.minY = 0; ext.maxX = 1000; ext.maxY = 1000;
  }

  const extents: DxfPageExtents = {
    minX: ext.minX,
    minY: ext.minY,
    maxX: ext.maxX,
    maxY: ext.maxY,
    width: ext.maxX - ext.minX,
    height: ext.maxY - ext.minY,
  };

  const layers = [...layerSet].sort();
  const layerMap: Record<string, string> = {};
  for (const l of layers) layerMap[l] = categoriseLayer(l);

  const blockNames = Object.keys(dxf?.blocks ?? {});
  const units = Number(dxf?.header?.$INSUNITS ?? 0);

  return { entities, layers, layerMap, extents, blockNames, units };
}

// ── Coordinate normalisation to 0-1000 space ─────────────────────────────────

/**
 * Convert a DXF world-unit point to 0-1000 normalised space
 * (same space used by PDF detection bbox).
 * DXF Y-axis is inverted relative to screen space.
 */
export function dxfToNorm(
  p: DxfPoint,
  extents: DxfPageExtents,
): DxfPoint {
  const x = extents.width > 0
    ? Math.round(((p.x - extents.minX) / extents.width) * 1000)
    : 0;
  // Invert Y: DXF origin bottom-left, screen origin top-left
  const y = extents.height > 0
    ? Math.round(((extents.maxY - p.y) / extents.height) * 1000)
    : 0;
  return { x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(1000, y)) };
}
