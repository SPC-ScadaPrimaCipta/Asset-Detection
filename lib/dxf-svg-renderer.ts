/**
 * DXF → SVG Renderer — v3
 *
 * Correct world-space block instance rendering:
 *   Block entities are in block-local coordinates.
 *   To render, each point is transformed to world space:
 *     worldPt = INSERT.position + rotate(scale(blockPt - block.base), rotation)
 *   Then mapped to SVG via toSvgX/toSvgY as normal world coordinates.
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
 *
 * This is correct for ALL cases including scale=1, rotation=0 (most common in P&IDs).

 */

import { parseDxf, type DxfParseResult, type DxfEntity, type DxfBlockDef, type DxfPoint } from '@/lib/dxf-parser';

const SVG_TARGET_WIDTH = 2400; // target SVG width in pixels
const SVG_BASE = 2000;
const BG_COLOR = '#1a1a1a';


const SVG_BASE = 2000;
const BG_COLOR = '#1e1e1e';

// ── AutoCAD Color Index (ACI) → RGB ──────────────────────────────────────────

const ACI_COLORS: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
  5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0',
};

const CATEGORY_COLOR: Record<string, string> = {
  pipe:       '#00bcd4',
  instrument: '#ffd600',
  equipment:  '#69f0ae',
  text:       '#ffab40',
  other:      '#b0bec5',
};

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

function resolveColor(aciColor: number, layer: string, layerMap: Record<string, string>): string {
  if (!aciColor || aciColor === 0 || aciColor === 256) {
    return CATEGORY_COLOR[layerMap[layer] ?? 'other'] ?? CATEGORY_COLOR.other;
  }
  if (ACI_COLORS[aciColor]) return ACI_COLORS[aciColor];
  const hue = Math.round(((aciColor - 10) / 240) * 360) % 360;
  return `hsl(${Math.max(0, hue)},90%,65%)`;
}

function textSizePx(dxfHeight: number, sc: Scale): number {
  if (dxfHeight <= 0) return 9;
  const raw = dxfHeight * sc.scale;
  return Math.max(8, Math.min(22, Math.round(raw)));
}

}

// ── XML escaping ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── MTEXT strip ───────────────────────────────────────────────────────────────

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

function stripMtext(raw: string): string {
  return raw
    .replace(/\\P/g, ' ').replace(/\\~/g, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\S[^;]+;/g, '')
    .replace(/\\U\+[0-9A-Fa-f]{4}/g, '').replace(/[{}]/g, '').replace(/\\./g, '').trim();
}

interface VB { svgW: number; svgH: number; ext: DxfParseResult['extents'] }

function toSvgX(wx: number, vb: VB): number {
  return (wx - vb.ext.minX) / vb.ext.width * vb.svgW;
}
function toSvgY(wy: number, vb: VB): number {
  return (vb.ext.maxY - wy) / vb.ext.height * vb.svgH;
}
function scaleW(len: number, vb: VB): number {
  return len / vb.ext.width * vb.svgW;
}
function scaleH(len: number, vb: VB): number {
  return len / vb.ext.height * vb.svgH;
}

}
function scaleH(len: number, vb: VB): number {
  return len / vb.ext.height * vb.svgH;
}
function r(n: number): number { return Math.round(n * 10) / 10; }

// ── World-space block transform ───────────────────────────────────────────────

/**
 * Transform a block-local point to world space.
 *
/**
 * Transform a block-local point to world space.
 *
 * Formula:
 *   local = pt - block.base           (subtract block base point)
 *   scaled = { x: local.x * sx, y: local.y * sy }
 *   rotated = rotate(scaled, rotRad)  (CCW rotation in world space)
 *   world = INSERT.position + rotated
 *
 * The returned SVG uses a width matching the true DXF aspect ratio (target ~2400px wide).
 * For very large DXF files (>20 000 entities) lines are sampled to keep the SVG DOM size manageable.
 *
 * Styling: dark background (#1a1a1a) with layer-category colors — matches
 * AutoCAD Model Space default appearance.
 */
function blockPtToWorld(
  pt: DxfPoint,

 */
function blockPtToWorld(
  pt: DxfPoint,
  base: DxfPoint,
  ins: { position: DxfPoint; xScale: number; yScale: number; rotation: number },
): DxfPoint {
  const sx  = isFinite(ins.xScale)   && ins.xScale   ? ins.xScale   : 1;
  const sy  = isFinite(ins.yScale)   && ins.yScale   ? ins.yScale   : 1;
  const rot = isFinite(ins.rotation) && ins.rotation ? ins.rotation : 0;
  const rad = (rot * Math.PI) / 180;

  const lx = (pt.x - base.x) * sx;
  const ly = (pt.y - base.y) * sy;

  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  return {
    x: ins.position.x + lx * cosR - ly * sinR,
    y: ins.position.y + lx * sinR + ly * cosR,
  };
}

/** Transform all points of a DxfEntity from block-local to world space. */
function transformEntityToWorld(
  e: DxfEntity,
  base: DxfPoint,
  ins: { position: DxfPoint; xScale: number; yScale: number; rotation: number },
): DxfEntity {
  const t = (p: DxfPoint) => blockPtToWorld(p, base, ins);

  switch (e.kind) {
    case 'LINE':
      return { ...e, start: t(e.start), end: t(e.end) };
    case 'LWPOLYLINE':
      return { ...e, vertices: e.vertices.map(t) };
    case 'ARC':
    case 'CIRCLE':
      return { ...e, center: t(e.center) };
    case 'ELLIPSE':
      return { ...e, center: t(e.center) };
    case 'SPLINE':
      return { ...e, controlPoints: e.controlPoints.map(t) };
    case 'SOLID':
      return { ...e, points: e.points.map(t) };
    case 'TEXT':
    case 'MTEXT':
      return { ...e, position: t(e.position) };
    default:
      return e;
  }
}

// ── SVG Arc path ──────────────────────────────────────────────────────────────

function arcPath(cx: number, cy: number, rx: number, ry: number, startDeg: number, endDeg: number): string {
  const sa = ((startDeg % 360) + 360) % 360;
  const ea = ((endDeg   % 360) + 360) % 360;

  let angleDiff = ea - sa;
  if (angleDiff <= 0) angleDiff += 360;

  // Full circle
  if (Math.abs(angleDiff - 360) < 0.5) {
    return `M ${r(cx - rx)} ${r(cy)} a ${r(rx)} ${r(ry)} 0 1 0 ${r(rx * 2)} 0 a ${r(rx)} ${r(ry)} 0 1 0 ${r(-rx * 2)} 0`;
  }

  // After Y-flip: negate angles
  const sRad = ((-sa) * Math.PI) / 180;
  const eRad = ((-ea) * Math.PI) / 180;

  const x1 = cx + rx * Math.cos(sRad);
  const y1 = cy + ry * Math.sin(sRad);
  const x2 = cx + rx * Math.cos(eRad);
  const y2 = cy + ry * Math.sin(eRad);

  const largeArc = angleDiff > 180 ? 1 : 0;
  // sweep=0 = CCW in SVG screen space = CW in DXF world (after Y-flip)
  return `M ${r(x1)} ${r(y1)} A ${r(rx)} ${r(ry)} 0 ${largeArc} 0 ${r(x2)} ${r(y2)}`;
}

// ── SVG element builders (world-space coords via toSvgX/toSvgY) ──────────────

function renderLine(e: Extract<DxfEntity, { kind: 'LINE' }>, vb: VB, lm: Record<string,string>, sw: number): string {
  const col = resolveColor(e.color, e.layer, lm);
  return `<line x1="${r(toSvgX(e.start.x,vb))}" y1="${r(toSvgY(e.start.y,vb))}" x2="${r(toSvgX(e.end.x,vb))}" y2="${r(toSvgY(e.end.y,vb))}" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
}

function renderPolyline(e: Extract<DxfEntity, { kind: 'LWPOLYLINE' }>, vb: VB, lm: Record<string,string>, sw: number): string {
  if (e.vertices.length < 2) return '';
  const pts = e.vertices.map(v => `${r(toSvgX(v.x,vb))},${r(toSvgY(v.y,vb))}`).join(' ');
  const col = resolveColor(e.color, e.layer, lm);
  return `<${e.closed ? 'polygon' : 'polyline'} points="${pts}" fill="none" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
}

function renderArc(e: Extract<DxfEntity, { kind: 'ARC' }>, vb: VB, lm: Record<string,string>, sw: number): string {
  const cx = r(toSvgX(e.center.x, vb));
  const cy = r(toSvgY(e.center.y, vb));
  const rx = r(scaleW(e.radius, vb));
  const ry = r(scaleH(e.radius, vb));
  if (rx < 0.3 || ry < 0.3) return '';
  const col = resolveColor(e.color, e.layer, lm);
  return `<path d="${arcPath(cx,cy,rx,ry,e.startAngle,e.endAngle)}" fill="none" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
}

function renderCircle(e: Extract<DxfEntity, { kind: 'CIRCLE' }>, vb: VB, lm: Record<string,string>, sw: number): string {
  const cx = r(toSvgX(e.center.x, vb));
  const cy = r(toSvgY(e.center.y, vb));
  const rx = r(scaleW(e.radius, vb));
  const ry = r(scaleH(e.radius, vb));
  if (rx < 0.3 || ry < 0.3) return '';
  const col = resolveColor(e.color, e.layer, lm);
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
}

function renderEllipse(e: Extract<DxfEntity, { kind: 'ELLIPSE' }>, vb: VB, lm: Record<string,string>, sw: number): string {
  const cx = r(toSvgX(e.center.x, vb));
  const cy = r(toSvgY(e.center.y, vb));
  const majorLen = Math.hypot(e.majorAxis.x, e.majorAxis.y);
  const minorLen = majorLen * e.axisRatio;
  const rx = r(scaleW(majorLen, vb));
  const ry = r(scaleH(minorLen, vb));
  if (rx < 0.3 || ry < 0.3) return '';
  const rotDeg = r(-(Math.atan2(e.majorAxis.y, e.majorAxis.x) * 180) / Math.PI);
  const col = resolveColor(e.color, e.layer, lm);
  const isFullEllipse = Math.abs(e.endAngle - e.startAngle) >= Math.PI * 2 - 0.01 || (e.startAngle === 0 && e.endAngle === 0);
  if (isFullEllipse) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${sw}" transform="rotate(${rotDeg},${cx},${cy})" vector-effect="non-scaling-stroke"/>`;
  }
  // Partial: sample as polyline
  const steps = 24;
  const cosR = Math.cos(rotDeg * Math.PI/180), sinR = Math.sin(rotDeg * Math.PI/180);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = e.startAngle + (e.endAngle - e.startAngle) * (i / steps);
    const lx = Math.cos(t) * rx, ly = -Math.sin(t) * ry;
    pts.push(`${r(cx + lx*cosR - ly*sinR)},${r(cy + lx*sinR + ly*cosR)}`);
  }
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
}

function renderSpline(e: Extract<DxfEntity, { kind: 'SPLINE' }>, vb: VB, lm: Record<string,string>, sw: number): string {
  if (e.controlPoints.length < 2) return '';
  const col = resolveColor(e.color, e.layer, lm);
  const pts = e.controlPoints.map(p => ({ x: toSvgX(p.x,vb), y: toSvgY(p.y,vb) }));
  if (pts.length === 2) {
    return `<line x1="${r(pts[0].x)}" y1="${r(pts[0].y)}" x2="${r(pts[1].x)}" y2="${r(pts[1].y)}" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
  }
  let d = `M ${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0,i-1)], p1 = pts[i], p2 = pts[Math.min(pts.length-1,i+1)], p3 = pts[Math.min(pts.length-1,i+2)];
    const c1x = p1.x+(p2.x-p0.x)/6, c1y = p1.y+(p2.y-p0.y)/6;
    const c2x = p2.x-(p3.x-p1.x)/6, c2y = p2.y-(p3.y-p1.y)/6;
    d += ` C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(p2.x)} ${r(p2.y)}`;
  }
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
}

function renderSolid(e: Extract<DxfEntity, { kind: 'SOLID' }>, vb: VB, lm: Record<string,string>): string {
  if (e.points.length < 3) return '';
  const col = resolveColor(e.color, e.layer, lm);
  const ordered = [...e.points];
  if (ordered.length === 4) [ordered[2], ordered[3]] = [ordered[3], ordered[2]];
  const pts = ordered.map(p => `${r(toSvgX(p.x,vb))},${r(toSvgY(p.y,vb))}`).join(' ');
  return `<polygon points="${pts}" fill="${col}" fill-opacity="0.5" stroke="${col}" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
}

function renderText(e: Extract<DxfEntity, { kind: 'TEXT'|'MTEXT' }>, vb: VB, lm: Record<string,string>): string {
  const x = r(toSvgX(e.position.x, vb));
  const y = r(toSvgY(e.position.y, vb));
  const col = resolveColor(e.color, e.layer, lm);
  const txt = (e.kind === 'MTEXT' ? stripMtext(e.text) : e.text).slice(0,80).trim();
  if (!txt) return '';
  let fs = 10;
  if (e.height > 0 && vb.ext.height > 0) fs = Math.max(7, Math.min(22, Math.round(e.height / vb.ext.height * vb.svgH)));
  return `<text x="${x}" y="${y}" font-family="Arial,monospace" font-size="${fs}" fill="${col}" dominant-baseline="text-after-edge">${esc(txt)}</text>`;
}

/** Render one entity (already in world space) to SVG string. */
function renderEntity(e: DxfEntity, vb: VB, lm: Record<string,string>, sw: number): string {
  switch (e.kind) {
    case 'LINE':       return renderLine(e, vb, lm, sw);
    case 'LWPOLYLINE': return renderPolyline(e, vb, lm, sw);
    case 'ARC':        return renderArc(e, vb, lm, sw);
    case 'CIRCLE':     return renderCircle(e, vb, lm, sw);
    case 'ELLIPSE':    return renderEllipse(e, vb, lm, sw);
    case 'SPLINE':     return renderSpline(e, vb, lm, sw);
    case 'SOLID':      return renderSolid(e, vb, lm);
    case 'TEXT':
    case 'MTEXT':      return renderText(e, vb, lm);
    default:           return '';
  }
}

// ── INSERT dot marker (fallback when block has no geometry) ───────────────────

function renderInsertMarker(
  ins: Extract<DxfEntity, { kind: 'INSERT' }>,
  vb: VB, lm: Record<string,string>,
): string {
  const px = r(toSvgX(ins.position.x, vb));
  const py = r(toSvgY(ins.position.y, vb));
  const col = resolveColor(0, ins.layer, lm);
  const label = esc((ins.blockName || 'BLK').replace(/^[*_]/, '').slice(0,20));
  const parts = [
    `<circle cx="${px}" cy="${py}" r="5" fill="${col}" fill-opacity="0.2" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
    `<circle cx="${px}" cy="${py}" r="2" fill="${col}"/>`,
    `<text x="${px+8}" y="${py+4}" font-family="Arial,monospace" font-size="9" fill="${col}" opacity="0.85">${label}</text>`,
  ];
  if (ins.attributes.length > 0) {
    const tag = esc(ins.attributes.map(a => a.value.trim()).filter(Boolean).slice(0,2).join(' ').slice(0,24));
    if (tag) parts.push(`<text x="${px+8}" y="${py+15}" font-family="Arial,monospace" font-size="11" fill="${col}" font-weight="bold">${tag}</text>`);
  }
  return parts.join('');
}

// ── Main render ───────────────────────────────────────────────────────────────

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

  const aspect = extents.height > 0 ? extents.width / extents.height : 1;
  const svgW = SVG_TARGET_WIDTH;
  const svgH = Math.max(200, Math.round(svgW / aspect));
  const vb: VB = { svgW, svgH, ext: extents };

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

      insertCount++;

      const block = blocks[e.blockName];
      if (block && block.entities.length > 0) {
        // Transform block entities to world space, then render normally
        const group: string[] = [];
        for (const be of block.entities) {
          if (be.kind === 'INSERT') continue; // skip nested for now
          const worldEntity = transformEntityToWorld(be, block.base, {
            position: e.position,
            xScale:   e.xScale,
            yScale:   e.yScale,
            rotation: e.rotation,
          });
          const s = renderEntity(worldEntity, vb, layerMap, sw);
          if (s) group.push(s);
        }
        if (group.length > 0) {
          insertParts.push(group.join(''));
        } else {
          insertParts.push(renderInsertMarker(e, vb, layerMap));
        }
      } else {
        insertParts.push(renderInsertMarker(e, vb, layerMap));
      }
      continue;
    }

    // Lines, arcs, circles, etc.
    if (lineCount < MAX_LINES) {
      const s = renderEntity(e, vb, layerMap, sw);
      if (s) lineParts.push(s);
      lineCount++;
    }
  }

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
    ly -= 14;
  }

    );
    ly -= 14;
  }

  const unitLabel = parsed.units === 4 ? 'mm' : parsed.units === 6 ? 'm' : parsed.units === 1 ? 'in' : 'u';

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="background:${BG_COLOR}">`,
    `  <!-- DXF v3: ${entities.length} entities, ${parsed.blockNames.length} blocks, ${Math.round(extents.width)}x${Math.round(extents.height)} ${unitLabel} -->`,
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

    `</svg>`,
  ].join('\n');

  return { svg, extents, entityCount: entities.length };
}
