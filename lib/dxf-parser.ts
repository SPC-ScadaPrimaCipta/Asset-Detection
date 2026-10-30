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

export interface DxfCircleEntity {
  kind: 'CIRCLE';
  center: DxfPoint;
  radius: number;
  layer: string;
}

export interface DxfArcEntity {
  kind: 'ARC';
  center: DxfPoint;
  radius: number;
  startAngle: number; // degrees
  endAngle: number;   // degrees
  layer: string;
}

export interface DxfSplineEntity {
  kind: 'SPLINE';
  /** Control points or fit points — approximation of the spline envelope */
  controlPoints: DxfPoint[];
  layer: string;
}

export interface DxfEllipseEntity {
  kind: 'ELLIPSE';
  center: DxfPoint;
  /** Semi-major axis length (half the major diameter) */
  majorAxisLength: number;
  /** Ratio of minor to major axis (0–1) */
  minorAxisRatio: number;
  layer: string;
}

export interface DxfAttDefEntity {
  kind: 'ATTDEF';
  /** Attribute tag name (key), e.g. "TAG", "DESCRIPTION" */
  tag: string;
  /** Default value specified in the block definition */
  defaultValue: string;
  /** Prompt string shown during block insertion */
  prompt: string;
  position: DxfPoint;
  layer: string;
}

export type DxfEntity =
  | DxfInsertEntity
  | DxfTextEntity
  | DxfLineEntity
  | DxfPolylineEntity
  | DxfCircleEntity
  | DxfArcEntity
  | DxfSplineEntity
  | DxfEllipseEntity
  | DxfAttDefEntity;

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
  /** Raw block definitions for geometry expansion in renderer */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks: Record<string, any>;
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

// ── MTEXT / TEXT formatting stripper ─────────────────────────────────────────

/**
 * Strip AutoCAD MTEXT inline formatting codes from a raw text string.
 *
 * AutoCAD MTEXT supports a rich set of inline codes inside curly-brace groups:
 *   \Fname|c0;   — font name
 *   \C256;       — colour index
 *   \W0.8;       — width factor
 *   \H3.5;       — text height
 *   \P            — paragraph break → replace with space
 *   \pxi,l,r;    — paragraph indent
 *   \A0;         — alignment
 *   \S a^b;      — stacked fraction
 *   \~           — non-breaking space
 *   \U+XXXX      — Unicode char
 *   %%d / %%p / %%c — degree / plus-minus / diameter symbols
 *   {{...}}      — nested groups
 *
 * The outer `{...}` wrapper is also removed.
 */
export function stripMtext(raw: string): string {
  let s = raw;

  // ── Normalize double-escaped backslashes ──────────────────────────────────
  // The dxf-parser npm library returns MTEXT strings with double-escaped
  // backslashes (\\F, \\W, \\C) because it reads the raw DXF text verbatim
  // where backslash is an escape character. Normalize to single backslash
  // so all subsequent regex patterns work consistently.
  // Only normalize \\ sequences that are followed by a letter or special char
  // that AutoCAD MTEXT uses — avoids corrupting legitimate double-backslash content.
  s = s.replace(/\\\\([A-Za-z~Ppn])/g, '\\$1');

  // Remove outer braces wrapping the whole string
  // Handle both single-level {content} and nested {{content}}
  while (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1);
    // Only unwrap if it's the sole outer wrapper (balanced)
    let depth = 0, balanced = true;
    for (const ch of inner) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0) { balanced = false; break; } }
    }
    if (balanced && depth === 0) { s = inner; } else break;
  }

  // Replace \P (paragraph break) and \n with a space before stripping
  s = s.replace(/\\P/gi, ' ').replace(/\\n/gi, ' ');

  // Replace %%d/%%p/%%c with readable chars
  s = s.replace(/%%d/gi, '°').replace(/%%p/gi, '±').replace(/%%c/gi, 'Ø');

  // Replace \U+XXXX unicode escapes
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );

  // Strip format codes: \X...; where X is any letter, followed by optional content up to ;
  // Covers: \F, \C, \W, \H, \A, \f, \c, \w, \h, \a, \pxi,l,r; etc.
  // Handles both \Fname|c0; and \C256; styles
  // eslint-disable-next-line no-control-regex
  s = s.replace(/\\[A-Za-z][^;\\{}]*;?/g, '');

  // Strip \~ (non-breaking space) → space
  s = s.replace(/\\~/g, ' ');

  // Remove remaining backslash-escape sequences
  s = s.replace(/\\./g, '');

  // Remove remaining curly braces (group delimiters)
  s = s.replace(/[{}]/g, '');

  // Collapse multiple spaces / trim
  return s.replace(/\s{2,}/g, ' ').trim();
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
      let text = buffer.toString(enc);
      if (enc === 'utf-8') {
        text = text.replace(/^\uFEFF/, '');
      }
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
      // dxf-parser uses different field names per entity type:
      //   MTEXT  → .position
      //   TEXT   → .startPoint  (primary) or .insertionPoint (fallback)
      const pos = pt(
        (e.position ?? e.startPoint ?? e.insertionPoint) as { x?: number; y?: number }
      );
      const rawText = String(e.text ?? e.string ?? '').trim();
      const cleanText = stripMtext(rawText);
      if (cleanText) {
        entities.push({
          kind: type as 'TEXT' | 'MTEXT',
          text: cleanText,
          position: pos,
          layer,
          height: Number(e.textHeight ?? e.height ?? 0),
        });
      }
    } else if (type === 'LINE') {
      // dxf-parser v1.x mengembalikan LINE sebagai { vertices: [start, end] },
      // bukan { start, end } — dukung keduanya agar LINE tidak terbuang diam-diam.
      const verts = (e.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
      const startRaw = (e.start as { x?: number; y?: number } | undefined) ?? verts[0];
      const endRaw = (e.end as { x?: number; y?: number } | undefined) ?? verts[verts.length - 1];
      if (!startRaw || !endRaw) continue;
      const start = pt(startRaw);
      const end = pt(endRaw);
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
    } else if (type === 'CIRCLE') {
      const center = pt(e.center as { x?: number; y?: number });
      const radius = Number(e.radius ?? 0);
      if (radius > 0) {
        entities.push({ kind: 'CIRCLE', center, radius, layer });
      }
    } else if (type === 'ARC') {
      const center = pt(e.center as { x?: number; y?: number });
      const radius = Number(e.radius ?? 0);
      if (radius > 0) {
        entities.push({
          kind: 'ARC',
          center,
          radius,
          startAngle: Number(e.startAngle ?? 0),
          endAngle: Number(e.endAngle ?? 360),
          layer,
        });
      }
    } else if (type === 'SPLINE') {
      // Use control points if available, fall back to fit points
      const rawCp = (e.controlPoints ?? e.fitPoints ?? []) as Array<{ x?: number; y?: number }>;
      const controlPoints: DxfPoint[] = rawCp.map(pt);
      if (controlPoints.length >= 2) {
        entities.push({ kind: 'SPLINE', controlPoints, layer });
      }
    } else if (type === 'ELLIPSE') {
      const center = pt(e.center as { x?: number; y?: number });
      // majorAxis vector → length
      const majVec = e.majorAxis as { x?: number; y?: number } | undefined;
      const majorAxisLength = majVec
        ? Math.hypot(majVec.x ?? 0, majVec.y ?? 0)
        : Number(e.majorAxisLength ?? 0);
      const minorAxisRatio = Number(e.axisRatio ?? e.minorAxisRatio ?? 0.5);
      if (majorAxisLength > 0) {
        entities.push({ kind: 'ELLIPSE', center, majorAxisLength, minorAxisRatio, layer });
      }
    } else if (type === 'ATTDEF') {
      const pos = pt(
        (e.startPoint ?? e.position ?? e.insertionPoint) as { x?: number; y?: number }
      );
      const tagName = String(e.tag ?? '').trim().toUpperCase();
      const defaultValue = stripMtext(String(e.defaultValue ?? e.text ?? '').trim());
      const prompt = String(e.prompt ?? '').trim();
      if (tagName) {
        entities.push({ kind: 'ATTDEF', tag: tagName, defaultValue, prompt, position: pos, layer });
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
    } else if (entity.kind === 'CIRCLE') {
      // Use AABB of the circle
      allPts.push(
        { x: entity.center.x - entity.radius, y: entity.center.y },
        { x: entity.center.x + entity.radius, y: entity.center.y },
        { x: entity.center.x, y: entity.center.y - entity.radius },
        { x: entity.center.x, y: entity.center.y + entity.radius },
      );
    } else if (entity.kind === 'ARC') {
      // Conservative: use center ± radius (covers full arc extent)
      allPts.push(
        { x: entity.center.x - entity.radius, y: entity.center.y },
        { x: entity.center.x + entity.radius, y: entity.center.y },
        { x: entity.center.x, y: entity.center.y - entity.radius },
        { x: entity.center.x, y: entity.center.y + entity.radius },
      );
    } else if (entity.kind === 'SPLINE') {
      allPts.push(...entity.controlPoints);
    } else if (entity.kind === 'ELLIPSE') {
      const r = entity.majorAxisLength;
      allPts.push(
        { x: entity.center.x - r, y: entity.center.y },
        { x: entity.center.x + r, y: entity.center.y },
        { x: entity.center.x, y: entity.center.y - r * entity.minorAxisRatio },
        { x: entity.center.x, y: entity.center.y + r * entity.minorAxisRatio },
      );
    } else if (entity.kind === 'ATTDEF') {
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
    width: ext.maxX - ext.minX,
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

// ── Sheet / region splitting ─────────────────────────────────────────────────
// Satu file DXF bisa berisi N gambar P&ID (multi-sheet): tiap sheet digambar di
// area koordinat sendiri, dipisah gap kosong / frame title-block. Tanpa split,
// semua sheet dipaksa 1 page → dedup salah, pid_page salah, skala bbox global.
//
// Algoritma: proyeksi semua entity ke sumbu dominan (span terbesar), urutkan,
// potong di gap terbesar yang melebihi ambang. Rekursif tidak perlu — 1 pass
// dengan semua gap signifikan sudah cukup untuk layout grid/strip.

export interface DxfRegion {
  /** 0-based index; pid_page = index + 1 */
  index: number;
  /** Extents region ini saja (untuk statistik, bukan normalisasi bbox). */
  extents: DxfPageExtents;
  /** Subset entities milik region (berbagi referensi, tanpa copy geometri). */
  entities: DxfEntity[];
}

/** Titik representatif satu entity untuk clustering region. */
export function entityRepPoint(e: DxfEntity): DxfPoint {
  switch (e.kind) {
    case 'LINE': return { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 };
    case 'LWPOLYLINE': {
      const n = e.vertices.length || 1;
      return {
        x: e.vertices.reduce((a, v) => a + v.x, 0) / n,
        y: e.vertices.reduce((a, v) => a + v.y, 0) / n,
      };
    }
    case 'INSERT': return e.position;
    case 'TEXT':
    case 'MTEXT': return e.position;
    case 'CIRCLE':
    case 'ARC': return e.center;
    case 'SPLINE': {
      const n = e.controlPoints.length || 1;
      return {
        x: e.controlPoints.reduce((a, p) => a + p.x, 0) / n,
        y: e.controlPoints.reduce((a, p) => a + p.y, 0) / n,
      };
    }
    case 'ELLIPSE': return e.center;
    case 'ATTDEF': return e.position;
  }
}

function regionExtentsOf(points: DxfPoint[]): DxfPageExtents {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1000; maxY = 1000; }
  // Guard lebar/nol — region garis tunggal tetap valid
  if (maxX - minX < 1) maxX = minX + 1;
  if (maxY - minY < 1) maxY = minY + 1;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

const MAX_REGIONS = 12;
const MIN_REGION_ENTITIES = 5; // region lebih kecil dari ini digabung ke tetangga terbesar

/**
 * Pecah hasil parse menjadi region-region sheet.
 * Selalu kembalikan ≥1 region (fallback = seluruh drawing).
 * Deterministik: tidak ada randomness, tidak ada I/O.
 */
export function splitDxfRegions(parsed: DxfParseResult): DxfRegion[] {
  const { entities, extents } = parsed;
  if (entities.length === 0) {
    return [{ index: 0, extents, entities: [] }];
  }

  const spanX = extents.width, spanY = extents.height;
  const horizontal = spanX >= spanY; // sumbu dominan
  const span = horizontal ? spanX : spanY;
  if (span <= 0) return [{ index: 0, extents, entities }];

  const order = entities
    .map((e, i) => ({ i, v: horizontal ? entityRepPoint(e).x : entityRepPoint(e).y }))
    .sort((a, b) => a.v - b.v);

  // Gap CLUSTERING (bukan ambang fraksi tetap): celah antar-sheet berorde
  // jauh lebih besar dari spasi normal dalam-sheet. Syarat ganda:
  //   (a) > 4× gap persentil-90 (adaptif ke densitas gambar), DAN
  //   (b) > 1% span dominan (floor absolut lawan noise/micro-gap).
  // Median tidak dipakai — runtuh saat banyak gap nol (titik berhimpit).
  const gapSizes = order.slice(1).map((o, k) => ({ rank: k + 1, size: o.v - order[k].v }));
  const sortedSizes = gapSizes.map((g) => g.size).sort((a, b) => a - b);
  const p90Gap = sortedSizes.length > 0 ? sortedSizes[Math.min(sortedSizes.length - 1, Math.floor(sortedSizes.length * 0.9))] : 0;
  const sepThreshold = Math.max(p90Gap * 4, span * 0.01, 1e-9);
  let cuts: number[] = gapSizes.filter((g) => g.size > sepThreshold).map((g) => g.rank);
  if (cuts.length === 0) return [{ index: 0, extents, entities }];
  if (cuts.length >= MAX_REGIONS) {
    // Terlalu banyak gap (noise) — ambil MAX_REGIONS-1 gap terbesar saja
    const gaps = cuts.map((c) => ({ c, size: order[c].v - order[c - 1].v }));
    gaps.sort((a, b) => b.size - a.size);
    const top = new Set(gaps.slice(0, MAX_REGIONS - 1).map((g) => g.c));
    cuts.splice(0, cuts.length, ...[...top].sort((a, b) => a - b));
  }

  // Bentuk grup
  const groups: number[][] = [];
  let start = 0;
  for (const c of cuts) { groups.push(order.slice(start, c).map((o) => o.i)); start = c; }
  groups.push(order.slice(start).map((o) => o.i));

  // Region mungil (artefak) digabung ke tetangga dengan entity terbanyak
  const regions: DxfRegion[] = [];
  const pending: number[] = [];
  const flush = (idxs: number[]) => {
    const pts = idxs.map((i) => entityRepPoint(entities[i]));
    regions.push({ index: regions.length, entities: idxs.map((i) => entities[i]), extents: regionExtentsOf(pts) });
  };
  for (const g of groups) {
    if (g.length < MIN_REGION_ENTITIES) { pending.push(...g); continue; }
    if (pending.length > 0) { g.unshift(...pending); pending.length = 0; }
    flush(g);
  }
  if (pending.length > 0) {
    if (regions.length > 0) {
      // Tempel ke region terakhir
      const last = regions[regions.length - 1];
      const extra = pending.map((i) => entities[i]);
      const pts = [...last.entities, ...extra].map(entityRepPoint);
      last.entities.push(...extra);
      last.extents = regionExtentsOf(pts);
    } else {
      flush(pending);
    }
  }
  if (regions.length === 0) return [{ index: 0, extents, entities }];

  // Urutan stabil: kiri→kanan (atau bawah→atas bila sumbu dominan vertikal)
  regions.sort((a, b) => horizontal ? a.extents.minX - b.extents.minX : a.extents.minY - b.extents.minY);

  // Strip kurus (markup/revision di sela sheet) digabung ke tetangga:
  // sheet P&ID asli memakai frame berukuran sama — region yang sempit
  // (<35% median lebar) DAN miskin entity (<200) bukan sheet.
  if (regions.length > 1) {
    const widths = regions.map((r) => r.extents.width).sort((x, y) => x - y);
    const medW = widths[Math.floor(widths.length / 2)] || 1;
    for (let i = regions.length - 1; i >= 0 && regions.length > 1; i--) {
      const r = regions[i];
      if (r.extents.width < medW * 0.35 && r.entities.length < 200) {
        // Tetangga kiri/kanan yang lebih padat menang
        const left = i > 0 ? regions[i - 1] : null;
        const right = i < regions.length - 1 ? regions[i + 1] : null;
        const target = left && right
          ? (left.entities.length >= right.entities.length ? left : right)
          : (left ?? right);
        if (target) {
          const pts = [...target.entities, ...r.entities].map(entityRepPoint);
          target.entities.push(...r.entities);
          target.extents = regionExtentsOf(pts);
          regions.splice(i, 1);
        }
      }
    }
  }

  regions.forEach((r, i) => { r.index = i; });
  return regions;
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
