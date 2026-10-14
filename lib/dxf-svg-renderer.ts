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

import { parseDxf, type DxfParseResult, type DxfEntity } from '@/lib/dxf-parser';

const SVG_TARGET_WIDTH = 2400; // target SVG width in pixels
const BG_COLOR = '#1a1a1a';

// ── Layer category → color (AutoCAD-inspired palette on dark background) ──────

const CATEGORY_COLOR: Record<string, string> = {
  pipe:       '#00bcd4', // cyan — process/pipe lines
  instrument: '#ffd600', // yellow — instrument/signal
  equipment:  '#69f0ae', // light-green — equipment/symbols
  text:       '#ffab40', // amber — annotation/text layers
  other:      '#b0bec5', // blue-grey — unknown/default
};

// Layer-name based color: derive from category, not random hash
function layerColor(layer: string, layerMap: Record<string, string>): string {
  const cat = layerMap[layer] ?? 'other';
  return CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.other;
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
): string {
  const x1 = sx(e.start.x, sc), y1 = sy(e.start.y, sc);
  const x2 = sx(e.end.x, sc),   y2 = sy(e.end.y, sc);
  const col = layerColor(e.layer, layerMap);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildPolyline(
  e: Extract<DxfEntity, { kind: 'LWPOLYLINE' }>,
  sc: Scale,
  layerMap: Record<string, string>,
): string {
  if (e.vertices.length < 2) return '';
  const pts = e.vertices.map((v) => `${sx(v.x, sc)},${sy(v.y, sc)}`);
  const col = layerColor(e.layer, layerMap);
  const tag = e.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
}

function buildText(
  e: Extract<DxfEntity, { kind: 'TEXT' | 'MTEXT' }>,
  sc: Scale,
  layerMap: Record<string, string>,
): string {
  const px = sx(e.position.x, sc);
  const py = sy(e.position.y, sc);
  const fs = textSizePx(e.height, sc);
  const col = layerColor(e.layer, layerMap);
  const rawText = e.text
    .replace(/\\[A-Za-z;][^;]*;/g, '') // strip MTEXT formatting codes like \fArial;
    .replace(/[{}]/g, '')               // strip MTEXT group brackets
    .slice(0, 60)
    .trim();
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
): string {
  const col = layerColor(e.layer, layerMap);
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
        ? layerColor(subLayer, layerMap)
        : col;

      if (subType === 'LINE') {
        const s = sub.start as { x?: number; y?: number } | undefined;
        const en = sub.end as { x?: number; y?: number } | undefined;
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
