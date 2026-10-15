/**
 * DXF → SVG Renderer
 *
 * Converts parsed DXF entities into an SVG string suitable for display in the
 * P&ID viewer.
 *
 * Design goals (AutoCAD-like appearance):
 *   - Dark background (#1a1a1a) matching AutoCAD Model Space default
 *   - Lines: white/light-grey by default; layer category gets distinct readable color
 *   - Pipes/process lines: cyan (#00bcd4) — prominent
 *   - Instrument/signal lines: yellow (#ffd600)
 *   - Equipment/symbol layers: light-green (#69f0ae)
 *   - Text/annotation layers: light-orange (#ffab40)
 *   - Other/unknown layers: light-grey (#e0e0e0)
 *   - INSERT blocks: expanded to actual block geometry (LINE, LWPOLYLINE, CIRCLE, ARC)
 *   - Text: small, clipped, readable on dark bg
 *   - Stroke width scaled relative to canvas for readability
 *
 * Coordinate mapping:
 *   DXF Y-axis = up (bottom-left origin)
 *   SVG Y-axis = down (top-left origin)
 *   Flip: svgY = (maxY - dxfY) * scale
 *
 * Output SVG: isotropic scale, preserving true aspect ratio.
 */

import {
  parseDxf,
  stripMtext,
  type DxfParseResult,
  type DxfEntity,
  type DxfPageExtents,
} from '@/lib/dxf-parser';

const SVG_TARGET_WIDTH = 2400; // target SVG width in pixels
const BG_COLOR = '#1a1a1a';

// ── Palettes ──────────────────────────────────────────────────────────────────
// dark  = AutoCAD Model Space (viewer). light = PDF-like (vision/YOLO input,
// trained on black-on-white renders).

export interface RenderPalette {
  bg: string;
  pipe: string;
  instrument: string;
  equipment: string;
  text: string;
  other: string;
  label: string; // legend-key text (dark theme only use)
}

const DARK_PALETTE: RenderPalette = {
  bg:         '#1a1a1a',
  pipe:       '#00bcd4',
  instrument: '#ffd600',
  equipment:  '#69f0ae',
  text:       '#ffab40',
  other:      '#b0bec5',
  label:      '#e0e0e0',
};

const LIGHT_PALETTE: RenderPalette = {
  bg:         '#ffffff',
  pipe:       '#0b6e7d',
  instrument: '#8a6d00',
  equipment:  '#14532d',
  text:       '#1a1a1a',
  other:      '#333333',
  label:      '#333333',
};

const CATEGORY_COLOR: Record<string, string> = {
  pipe:       DARK_PALETTE.pipe,
  instrument: DARK_PALETTE.instrument,
  equipment:  DARK_PALETTE.equipment,
  text:       DARK_PALETTE.text,
  other:      DARK_PALETTE.other,
};

// Layer-name based color: derive from category, not random hash
function layerColor(
  layer: string,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const cat = layerMap[layer] ?? 'other';
  return pal[cat as keyof RenderPalette] ?? pal.other;
}

// ── Coordinate normalisation ──────────────────────────────────────────────────

interface Scale {
  scale: number;
  minX: number;
  maxY: number;
  svgWidth: number;
  svgHeight: number;
}

function buildScale(ext: DxfParseResult['extents']): Scale {
  const dxfWidth  = ext.maxX - ext.minX;
  const dxfHeight = ext.maxY - ext.minY;
  const scale = dxfWidth > 0 ? SVG_TARGET_WIDTH / dxfWidth : 1;
  const svgWidth  = SVG_TARGET_WIDTH;
  const svgHeight = dxfHeight > 0 ? Math.round(dxfHeight * scale) : SVG_TARGET_WIDTH;
  return { scale, minX: ext.minX, maxY: ext.maxY, svgWidth, svgHeight };
}

function sx(x: number, sc: Scale): number {
  return Math.round((x - sc.minX) * sc.scale * 10) / 10;
}

function sy(y: number, sc: Scale): number {
  return Math.round((sc.maxY - y) * sc.scale * 10) / 10;
}

// ── Text height ───────────────────────────────────────────────────────────────

function textSizePx(dxfHeight: number, sc: Scale): number {
  if (dxfHeight <= 0) return 9;
  const raw = dxfHeight * sc.scale;
  return Math.max(8, Math.min(22, Math.round(raw)));
}

// ── XML escaping ──────────────────────────────────────────────────────────────

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── SVG element builders ──────────────────────────────────────────────────────

function buildLine(
  e: Extract<DxfEntity, { kind: 'LINE' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const x1 = sx(e.start.x, sc), y1 = sy(e.start.y, sc);
  const x2 = sx(e.end.x, sc),   y2 = sy(e.end.y, sc);
  const col = layerColor(e.layer, layerMap, pal);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildCircle(
  e: Extract<DxfEntity, { kind: 'CIRCLE' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const r = Math.round(e.radius * sc.scale * 10) / 10;
  if (r < 0.3) return '';
  const col = layerColor(e.layer, layerMap, pal);
  return `<circle cx="${sx(e.center.x, sc)}" cy="${sy(e.center.y, sc)}" r="${r}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function arcSvgPath(
  cxSvg: number, cySvg: number, r: number,
  startAngleDeg: number, endAngleDeg: number,
): string {
  const sa = (startAngleDeg * Math.PI) / 180;
  const ea = (endAngleDeg * Math.PI) / 180;
  const x1a = cxSvg + r * Math.cos(sa);
  const y1a = cySvg - r * Math.sin(sa); // Y flipped
  const x2a = cxSvg + r * Math.cos(ea);
  const y2a = cySvg - r * Math.sin(ea);
  let diff = endAngleDeg - startAngleDeg;
  if (diff < 0) diff += 360;
  const largeArc = diff > 180 ? 1 : 0;
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(x1a)},${f(y1a)} A${r},${r} 0 ${largeArc},0 ${f(x2a)},${f(y2a)}`;
}

function buildArc(
  e: Extract<DxfEntity, { kind: 'ARC' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const r = Math.round(e.radius * sc.scale * 10) / 10;
  if (r < 0.3) return '';
  const col = layerColor(e.layer, layerMap, pal);
  const d = arcSvgPath(sx(e.center.x, sc), sy(e.center.y, sc), r, e.startAngle, e.endAngle);
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildEllipse(
  e: Extract<DxfEntity, { kind: 'ELLIPSE' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const rx = Math.round(e.majorAxisLength * sc.scale * 10) / 10;
  const ry = Math.round(e.majorAxisLength * e.minorAxisRatio * sc.scale * 10) / 10;
  if (rx < 0.3 || ry < 0.3) return '';
  const col = layerColor(e.layer, layerMap, pal);
  return `<ellipse cx="${sx(e.center.x, sc)}" cy="${sy(e.center.y, sc)}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildSpline(
  e: Extract<DxfEntity, { kind: 'SPLINE' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  if (e.controlPoints.length < 2) return '';
  const pts = e.controlPoints.map((p) => `${sx(p.x, sc)},${sy(p.y, sc)}`);
  const col = layerColor(e.layer, layerMap, pal);
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildPolyline(
  e: Extract<DxfEntity, { kind: 'LWPOLYLINE' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  if (e.vertices.length < 2) return '';
  const pts = e.vertices.map((v) => `${sx(v.x, sc)},${sy(v.y, sc)}`);
  const col = layerColor(e.layer, layerMap, pal);
  const tag = e.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildText(
  e: Extract<DxfEntity, { kind: 'TEXT' | 'MTEXT' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const px = sx(e.position.x, sc);
  const py = sy(e.position.y, sc);
  const fs = textSizePx(e.height, sc);
  const col = layerColor(e.layer, layerMap, pal);
  const rawText = stripMtext(e.text).slice(0, 60);
  if (!rawText) return '';
  const label = escXml(rawText);
  return `<text x="${px}" y="${py}" font-family="monospace,sans-serif" font-size="${fs}" fill="${col}" dominant-baseline="text-after-edge" opacity="0.9">${label}</text>`;
}

/**
 * Expand an INSERT entity into the actual geometry from its block definition.
 * Applies position, rotation, and scale transforms from the INSERT entity.
 * Falls back to a small cross marker if block has no geometry.
 */
function buildInsert(
  e: Extract<DxfEntity, { kind: 'INSERT' }>,
  sc: Scale,
  layerMap: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks: Record<string, any>,
  pal: RenderPalette = DARK_PALETTE,
): string {
  const col = layerColor(e.layer, layerMap, pal);
  const insX = e.position.x;
  const insY = e.position.y;
  const rot = Number(e.rotation || 0);
  const rotRad = (rot * Math.PI) / 180;
  const cosA = Math.cos(rotRad);
  const sinA = Math.sin(rotRad);
  const scaleX = Number(e.xScale ?? 1);
  const scaleY = Number(e.yScale ?? 1);

  // Transform a block-local point to DXF world coords
  const tfDxf = (lx: number, ly: number) => {
    const rx = (lx * cosA - ly * sinA) * scaleX;
    const ry = (lx * sinA + ly * cosA) * scaleY;
    return { x: insX + rx, y: insY + ry };
  };

  const blk = blocks?.[e.blockName];
  const subEntities = blk?.entities as unknown[] | undefined;

  if (Array.isArray(subEntities) && subEntities.length > 0) {
    const parts: string[] = [];
    for (const raw of subEntities) {
      const sub = raw as Record<string, unknown>;
      const subType = String(sub.type ?? '').toUpperCase();
      // Inherit parent color if sub-entity is on layer '0' (standard CAD practice)
      const subLayer = String(sub.layer ?? '0');
      const subCol = (subLayer !== '0' && subLayer !== '')
        ? layerColor(subLayer, layerMap, pal)
        : col;

      if (subType === 'LINE') {
        // dxf-parser v1.x: LINE sebagai { vertices: [start, end] } — fallback.
        const sVerts = (sub.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
        const s = (sub.start as { x?: number; y?: number } | undefined) ?? sVerts[0];
        const en = (sub.end as { x?: number; y?: number } | undefined) ?? sVerts[sVerts.length - 1];
        if (!s || !en) continue;
        const p1 = tfDxf(s.x ?? 0, s.y ?? 0);
        const p2 = tfDxf(en.x ?? 0, en.y ?? 0);
        parts.push(`<line x1="${sx(p1.x, sc)}" y1="${sy(p1.y, sc)}" x2="${sx(p2.x, sc)}" y2="${sy(p2.y, sc)}" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      } else if (subType === 'LWPOLYLINE' || subType === 'POLYLINE') {
        const verts = (sub.vertices as Array<{ x?: number; y?: number }> | undefined) ?? [];
        if (verts.length < 2) continue;
        const pts = verts.map((v) => {
          const p = tfDxf(v.x ?? 0, v.y ?? 0);
          return `${sx(p.x, sc)},${sy(p.y, sc)}`;
        });
        const tag = (sub.closed) ? 'polygon' : 'polyline';
        parts.push(`<${tag} points="${pts.join(' ')}" fill="none" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      } else if (subType === 'CIRCLE') {
        const c = sub.center as { x?: number; y?: number } | undefined;
        if (!c) continue;
        const cp = tfDxf(c.x ?? 0, c.y ?? 0);
        const r = Math.round(Number(sub.radius ?? 1) * Math.abs(scaleX) * sc.scale * 10) / 10;
        if (r < 0.1) continue;
        parts.push(`<circle cx="${sx(cp.x, sc)}" cy="${sy(cp.y, sc)}" r="${r}" fill="none" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      } else if (subType === 'ARC') {
        const c = sub.center as { x?: number; y?: number } | undefined;
        if (!c) continue;
        const cp = tfDxf(c.x ?? 0, c.y ?? 0);
        const r = Math.round(Number(sub.radius ?? 1) * Math.abs(scaleX) * sc.scale * 10) / 10;
        if (r < 0.1) continue;
        const startAngle = Number(sub.startAngle ?? 0);
        const endAngle   = Number(sub.endAngle   ?? 360);
        // Convert DXF arc angles (CCW from +X) to SVG path
        const sa = ((startAngle + rot) * Math.PI) / 180;
        const ea = ((endAngle   + rot) * Math.PI) / 180;
        const cxSvg = sx(cp.x, sc);
        const cySvg = sy(cp.y, sc);
        // Note: SVG Y is flipped, so arc direction reverses
        const x1a = cxSvg + r * Math.cos(sa);
        const y1a = cySvg - r * Math.sin(sa); // Y flipped
        const x2a = cxSvg + r * Math.cos(ea);
        const y2a = cySvg - r * Math.sin(ea);
        let diff = endAngle - startAngle;
        if (diff < 0) diff += 360;
        const largeArc = diff > 180 ? 1 : 0;
        // In SVG (Y-down), CCW DXF = clockwise sweep, so sweep-flag=0
        parts.push(`<path d="M${x1a},${y1a} A${r},${r} 0 ${largeArc},0 ${x2a},${y2a}" fill="none" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      }
    }
    if (parts.length > 0) return parts.join('\n');
  }

  // Fallback: small cross marker at position (block has no renderable geometry)
  const px = sx(insX, sc), py = sy(insY, sc);
  const r = 4;
  return [
    `<line x1="${px - r}" y1="${py}" x2="${px + r}" y2="${py}" stroke="${col}" stroke-width="1" opacity="0.6" vector-effect="non-scaling-stroke"/>`,
    `<line x1="${px}" y1="${py - r}" x2="${px}" y2="${py + r}" stroke="${col}" stroke-width="1" opacity="0.6" vector-effect="non-scaling-stroke"/>`,
  ].join('\n');
}

// ── Main render function ──────────────────────────────────────────────────────

/**
 * Render a DXF buffer to an SVG string.
 *
 * The returned SVG uses a width matching the true DXF aspect ratio (target ~2400px wide).
 * For very large DXF files (>20 000 entities) lines are sampled to keep the SVG DOM size manageable.
 *
 * Styling: dark background (#1a1a1a) with layer-category colors — matches
 * AutoCAD Model Space default appearance.
 */
export function renderDxfToSvg(buffer: Buffer): {
  svg: string;
  extents: DxfParseResult['extents'];
  entityCount: number;
} {
  const parsed = parseDxf(buffer);
  const { entities, extents, layerMap, blocks } = parsed;

  // Add 1% margin so nothing is clipped at edges
  const MARGIN = 0.01;
  const mx = (extents.maxX - extents.minX) * MARGIN;
  const my = (extents.maxY - extents.minY) * MARGIN;
  const paddedExtents = {
    minX: extents.minX - mx,
    minY: extents.minY - my,
    maxX: extents.maxX + mx,
    maxY: extents.maxY + my,
    width:  (extents.maxX - extents.minX) + mx * 2,
    height: (extents.maxY - extents.minY) + my * 2,
  };

  const sc = buildScale(paddedExtents);
  const { svgWidth, svgHeight } = sc;

  const MAX_LINES   = 15_000;
  const MAX_TEXTS   = 4_000;
  const MAX_INSERTS = 3_000;

  let lineCount   = 0;
  let textCount   = 0;
  let insertCount = 0;

  // Render order: lines first (background), then inserts (symbols), then text (labels on top)
  const lineParts:   string[] = [];
  const insertParts: string[] = [];
  const textParts:   string[] = [];

  for (const e of entities) {
    if (e.kind === 'LINE') {
      if (lineCount >= MAX_LINES) continue;
      lineParts.push(buildLine(e, sc, layerMap));
      lineCount++;
    } else if (e.kind === 'LWPOLYLINE') {
      if (lineCount >= MAX_LINES) continue;
      const s = buildPolyline(e, sc, layerMap);
      if (s) lineParts.push(s);
      lineCount += e.vertices.length;
    } else if (e.kind === 'TEXT' || e.kind === 'MTEXT') {
      if (textCount >= MAX_TEXTS) continue;
      const s = buildText(e, sc, layerMap);
      if (s) textParts.push(s);
      textCount++;
    } else if (e.kind === 'INSERT') {
      if (insertCount >= MAX_INSERTS) continue;
      insertParts.push(buildInsert(e, sc, layerMap, blocks));
      insertCount++;
    }
  }

  // Build layer legend (small key, bottom-left corner)
  const usedCategories = new Set<string>(Object.values(layerMap));
  const legendItems: string[] = [];
  let ly = svgHeight - 20;
  for (const cat of ['pipe', 'instrument', 'equipment', 'text', 'other']) {
    if (!usedCategories.has(cat)) continue;
    const col = CATEGORY_COLOR[cat];
    legendItems.push(
      `<rect x="10" y="${ly - 8}" width="16" height="8" fill="${col}" opacity="0.8"/>`,
      `<text x="30" y="${ly}" font-family="monospace,sans-serif" font-size="11" fill="#e0e0e0" opacity="0.7">${escXml(cat)}</text>`,
    );
    ly -= 16;
  }

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     viewBox="0 0 ${svgWidth} ${svgHeight}"`,
    `     width="${svgWidth}" height="${svgHeight}"`,
    `     style="background:${BG_COLOR};">`,
    `  <!-- DXF render: ${entities.length} entities, ${parsed.layers.length} layers -->`,
    `  <!-- Extents: ${Math.round(extents.width)}x${Math.round(extents.height)} ${parsed.units === 4 ? 'mm' : parsed.units === 6 ? 'm' : 'units'} -->`,
    `  <!-- Lines:${lineCount} Inserts:${insertCount} Texts:${textCount} -->`,
    `  <rect width="${svgWidth}" height="${svgHeight}" fill="${BG_COLOR}"/>`,
    `  <g id="dxf-lines">`,
    ...lineParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <g id="dxf-inserts">`,
    ...insertParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <g id="dxf-text">`,
    ...textParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <g id="dxf-legend" opacity="0.85">`,
    ...legendItems.map((p) => `    ${p}`),
    `  </g>`,
    `</svg>`,
  ].join('\n');

  return { svg, extents, entityCount: entities.length };
}

// ── Region render for vision input (Blok 3.1) ─────────────────────────────────
//
// Renders ONE sheet region with a PDF-like light theme so vision models
// (YOLO trained on black-on-white P&ID renders, tesseract, Gemini) see a
// familiar domain. Includes ALL vector kinds (circles/arcs/ellipses/splines
// were missing from the viewer-oriented renderer above).

export interface DxfRegionRenderOptions {
  /** 'light' (vision, default) or 'dark' (viewer-like). */
  theme?: 'light' | 'dark';
  /** Target SVG/PNG width in px. */
  targetWidth?: number;
  /** Max entities per kind (safety cap for giant sheets). */
  maxEntities?: number;
  /** Draw layer-key box (default false — pollutes detection input). */
  legendKey?: boolean;
}

export function renderDxfRegionToSvg(
  parsed: DxfParseResult,
  region: { entities: DxfEntity[]; extents: DxfPageExtents },
  options: DxfRegionRenderOptions = {},
): { svg: string; width: number; height: number; view: DxfPageExtents } {
  const { theme = 'light', targetWidth = 2400, maxEntities = 30_000, legendKey = false } = options;
  const pal = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
  const { layerMap, blocks } = parsed;

  const MARGIN = 0.01;
  const mx = region.extents.width * MARGIN;
  const my = region.extents.height * MARGIN;
  const view = {
    minX: region.extents.minX - mx,
    minY: region.extents.minY - my,
    maxX: region.extents.maxX + mx,
    maxY: region.extents.maxY + my,
    width: region.extents.width + mx * 2,
    height: region.extents.height + my * 2,
  };
  const scale = view.width > 0 ? targetWidth / view.width : 1;
  const svgWidth = targetWidth;
  const svgHeight = Math.max(1, Math.round(view.height * scale));
  const sc: Scale = { scale, minX: view.minX, maxY: view.maxY, svgWidth, svgHeight };
  const viewExtents: DxfPageExtents = {
    minX: view.minX, minY: view.minY, maxX: view.maxX, maxY: view.maxY,
    width: view.width, height: view.height,
  };

  const parts: string[] = [];
  let n = 0;
  for (const e of region.entities) {
    if (n >= maxEntities) break;
    let s = '';
    if (e.kind === 'LINE') s = buildLine(e, sc, layerMap, pal);
    else if (e.kind === 'LWPOLYLINE') s = buildPolyline(e, sc, layerMap, pal);
    else if (e.kind === 'CIRCLE') s = buildCircle(e, sc, layerMap, pal);
    else if (e.kind === 'ARC') s = buildArc(e, sc, layerMap, pal);
    else if (e.kind === 'ELLIPSE') s = buildEllipse(e, sc, layerMap, pal);
    else if (e.kind === 'SPLINE') s = buildSpline(e, sc, layerMap, pal);
    else if (e.kind === 'TEXT' || e.kind === 'MTEXT') s = buildText(e, sc, layerMap, pal);
    else if (e.kind === 'INSERT') s = buildInsert(e, sc, layerMap, blocks, pal);
    if (s) { parts.push(s); n++; }
  }

  const key = legendKey
    ? [`<g id="dxf-legend" opacity="0.85">`,
       `<rect x="10" y="${svgHeight - 28}" width="16" height="8" fill="${pal.equipment}" opacity="0.8"/>`,
       `<text x="30" y="${svgHeight - 20}" font-family="monospace,sans-serif" font-size="11" fill="${pal.label}" opacity="0.7">dxf-region</text>`,
       `</g>`].join('\n')
    : '';

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     viewBox="0 0 ${svgWidth} ${svgHeight}"`,
    `     width="${svgWidth}" height="${svgHeight}"`,
    `     style="background:${pal.bg};">`,
    `  <rect width="${svgWidth}" height="${svgHeight}" fill="${pal.bg}"/>`,
    `  <g id="dxf-region">`,
    ...parts.map((p) => `    ${p}`),
    `  </g>`,
    key,
    `</svg>`,
  ].join('\n');

  return { svg, width: svgWidth, height: svgHeight, view: viewExtents };
}

/**
 * Render one DXF sheet region to a PNG buffer (vision-model input).
 * Requires `sharp` (already a dependency).
 */
export async function renderDxfRegionToPng(
  parsed: DxfParseResult,
  region: { entities: DxfEntity[]; extents: DxfPageExtents },
  options: DxfRegionRenderOptions = {},
): Promise<{ png: Buffer; width: number; height: number; view: DxfPageExtents }> {
  const { svg, width, height, view } = renderDxfRegionToSvg(parsed, region, options);
  const sharp = (await import('sharp')).default;
  const png = await sharp(Buffer.from(svg, 'utf-8')).png().toBuffer();
  return { png, width, height, view };
}
