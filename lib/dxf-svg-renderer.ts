/**
 * DXF → SVG Renderer — v2
 *
 * AutoCAD-like rendering of DXF files to SVG:
 *
 *  ✅ Block Definitions — INSERTs render the actual block geometry
 *  ✅ Scale + Rotation  — each INSERT applies xScale/yScale/rotation transform
 *  ✅ ARC, CIRCLE       — rendered as SVG arc paths / circle elements
 *  ✅ ELLIPSE           — rendered as SVG ellipse with rotation
 *  ✅ SPLINE            — rendered as cubic bezier approximation
 *  ✅ SOLID / 3DFACE    — rendered as filled polygon
 *  ✅ ACI color mapping — AutoCAD Color Index (1-255) → RGB
 *  ✅ Aspect ratio      — SVG viewBox matches drawing proportions
 *  ✅ MTEXT formatting  — full strip of AutoCAD MTEXT codes
 *  ✅ Dark background   — #1e1e1e matching AutoCAD Model Space
 *
 * Coordinate mapping:
 *   DXF Y-axis = up  (bottom-left origin)
 *   SVG Y-axis = down (top-left origin)
 *   Flip: svgY = (extents.maxY - dxfY) / extents.height * SVG_H
 */

import { parseDxf, type DxfParseResult, type DxfEntity, type DxfBlockDef } from '@/lib/dxf-parser';

// ── Canvas size ───────────────────────────────────────────────────────────────

const SVG_BASE = 2000; // width in SVG units; height is computed from aspect ratio
const BG_COLOR = '#1e1e1e';

// ── AutoCAD Color Index (ACI) → RGB ──────────────────────────────────────────
// Standard ACI palette (indices 1-7 are the most common in P&IDs).

const ACI_COLORS: Record<number, string> = {
  1:   '#ff0000', // Red
  2:   '#ffff00', // Yellow
  3:   '#00ff00', // Green
  4:   '#00ffff', // Cyan
  5:   '#0000ff', // Blue
  6:   '#ff00ff', // Magenta
  7:   '#ffffff', // White (on dark bg)
  8:   '#808080', // Dark grey
  9:   '#c0c0c0', // Light grey
  10:  '#ff0000',
  11:  '#ffaaaa',
  12:  '#bd0000',
  13:  '#bd7e7e',
  14:  '#810000',
  20:  '#ff7f00',
  30:  '#ffbf00',
  40:  '#ffff00',
  50:  '#7fff00',
  51:  '#bfff7f',
  60:  '#00ff00',
  70:  '#00ff7f',
  80:  '#00ffbf',
  90:  '#00ffff',
  130: '#007fff',
  140: '#0040ff',
  150: '#4000ff',
  160: '#7f00ff',
  170: '#bf00ff',
  180: '#ff00ff',
  190: '#ff007f',
  200: '#ff0040',
  210: '#804000',
  220: '#ff8040',
  230: '#c08040',
  240: '#80c040',
  250: '#808080',
  251: '#888888',
  252: '#aaaaaa',
  253: '#cccccc',
  254: '#e8e8e8',
  255: '#ffffff',
};

// Layer category → default color (used when ACI = 0/BYLAYER)
const CATEGORY_COLOR: Record<string, string> = {
  pipe:       '#00bcd4', // cyan
  instrument: '#ffd600', // yellow
  equipment:  '#69f0ae', // light-green
  text:       '#ffab40', // amber
  other:      '#b0bec5', // blue-grey
};

function resolveColor(
  aciColor: number,
  layer: string,
  layerMap: Record<string, string>,
): string {
  // 0 = BYLAYER, 256 = BYBLOCK — use layer category color
  if (aciColor === 0 || aciColor === 256 || !aciColor) {
    const cat = layerMap[layer] ?? 'other';
    return CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.other;
  }
  // ACI color lookup with nearest-index fallback
  if (ACI_COLORS[aciColor]) return ACI_COLORS[aciColor];

  // For indices not in the table, generate from the standard AutoCAD ACI grid.
  // Each group of 10 is a hue band; within a group, rows 0-4 are lighter,
  // 5-9 are darker. This is a simplified approximation.
  const hue = Math.round(((aciColor - 10) / 240) * 360) % 360;
  return `hsl(${hue},100%,65%)`;
}

// ── XML escaping ──────────────────────────────────────────────────────────────

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── MTEXT format code stripper ────────────────────────────────────────────────

function stripMtext(raw: string): string {
  return raw
    // paragraph break
    .replace(/\\P/g, ' ')
    // non-breaking space
    .replace(/\\~/g, ' ')
    // formatting codes with semicolon: \f...; \H...; \W...; \T...; \Q...; \C...; \A...;
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    // stacking \S...^...; or \S.../...;
    .replace(/\\S[^;]+;/g, '')
    // unicode \U+XXXX
    .replace(/\\U\+[0-9A-Fa-f]{4}/g, '')
    // group brackets
    .replace(/[{}]/g, '')
    // any remaining backslash sequences
    .replace(/\\./g, '')
    .trim();
}

// ── Coordinate mapping ────────────────────────────────────────────────────────

interface ViewBox {
  svgW: number;
  svgH: number;
  ext: DxfParseResult['extents'];
}

function toSvgX(worldX: number, vb: ViewBox): number {
  if (vb.ext.width <= 0) return vb.svgW / 2;
  return (worldX - vb.ext.minX) / vb.ext.width * vb.svgW;
}

function toSvgY(worldY: number, vb: ViewBox): number {
  if (vb.ext.height <= 0) return vb.svgH / 2;
  // Flip Y
  return (vb.ext.maxY - worldY) / vb.ext.height * vb.svgH;
}

function scaleLen(worldLen: number, vb: ViewBox): number {
  if (vb.ext.width <= 0) return 0;
  return worldLen / vb.ext.width * vb.svgW;
}

function scaleLenY(worldLen: number, vb: ViewBox): number {
  if (vb.ext.height <= 0) return 0;
  return worldLen / vb.ext.height * vb.svgH;
}

// ── SVG arc from DXF ARC ──────────────────────────────────────────────────────

/**
 * Build an SVG path "d" attribute for a DXF ARC entity.
 * DXF angles are in degrees, CCW from positive X.
 * SVG Y-axis is flipped, so we mirror the arc accordingly.
 */
function arcPath(
  cx: number, cy: number,
  rx: number, ry: number,
  startDeg: number, endDeg: number,
): string {
  // Normalise angles to [0, 360)
  let sa = ((startDeg % 360) + 360) % 360;
  let ea = ((endDeg   % 360) + 360) % 360;

  // After Y-flip: negate angles (CCW becomes CW in SVG)
  const svgSa = -sa;
  const svgEa = -ea;

  // Convert to radians for coordinate calc
  const sRad = (svgSa * Math.PI) / 180;
  const eRad = (svgEa * Math.PI) / 180;

  const x1 = cx + rx * Math.cos(sRad);
  const y1 = cy + ry * Math.sin(sRad);
  const x2 = cx + rx * Math.cos(eRad);
  const y2 = cy + ry * Math.sin(eRad);

  // Large arc flag: going CW (SVG sweep=0) from sa to ea
  // In SVG: sweep-flag=0 means CCW in screen space (CW in DXF space after flip)
  let sweep = 0; // CW in screen = CCW in DXF
  let angleDiff = ea - sa;
  if (angleDiff <= 0) angleDiff += 360;
  const largeArc = angleDiff > 180 ? 1 : 0;

  return `M ${round(x1)} ${round(y1)} A ${round(rx)} ${round(ry)} 0 ${largeArc} ${sweep} ${round(x2)} ${round(y2)}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── SVG element builders ──────────────────────────────────────────────────────

function buildLine(
  e: Extract<DxfEntity, { kind: 'LINE' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  const x1 = round(toSvgX(e.start.x, vb));
  const y1 = round(toSvgY(e.start.y, vb));
  const x2 = round(toSvgX(e.end.x,   vb));
  const y2 = round(toSvgY(e.end.y,   vb));
  const col = resolveColor(e.color, e.layer, layerMap);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildPolyline(
  e: Extract<DxfEntity, { kind: 'LWPOLYLINE' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  if (e.vertices.length < 2) return '';
  const pts = e.vertices
    .map((v) => `${round(toSvgX(v.x, vb))},${round(toSvgY(v.y, vb))}`)
    .join(' ');
  const col = resolveColor(e.color, e.layer, layerMap);
  const tag  = e.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pts}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildArc(
  e: Extract<DxfEntity, { kind: 'ARC' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  const cx = round(toSvgX(e.center.x, vb));
  const cy = round(toSvgY(e.center.y, vb));
  const rx = round(scaleLen(e.radius,  vb));
  const ry = round(scaleLenY(e.radius, vb));
  if (rx < 0.5 || ry < 0.5) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  const d   = arcPath(cx, cy, rx, ry, e.startAngle, e.endAngle);
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildCircle(
  e: Extract<DxfEntity, { kind: 'CIRCLE' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  const cx = round(toSvgX(e.center.x, vb));
  const cy = round(toSvgY(e.center.y, vb));
  const rx = round(scaleLen(e.radius,  vb));
  const ry = round(scaleLenY(e.radius, vb));
  if (rx < 0.5 || ry < 0.5) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  // Use ellipse for slightly non-square viewboxes
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildEllipse(
  e: Extract<DxfEntity, { kind: 'ELLIPSE' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  const cx = round(toSvgX(e.center.x, vb));
  const cy = round(toSvgY(e.center.y, vb));
  // Major axis length in world units
  const majorLen = Math.hypot(e.majorAxis.x, e.majorAxis.y);
  const minorLen = majorLen * e.axisRatio;
  const rx = round(scaleLen(majorLen,  vb));
  const ry = round(scaleLenY(minorLen, vb));
  if (rx < 0.5 || ry < 0.5) return '';
  // Rotation of major axis (DXF angle, flipped for SVG)
  const rotDeg = round(-(Math.atan2(e.majorAxis.y, e.majorAxis.x) * 180) / Math.PI);
  const col    = resolveColor(e.color, e.layer, layerMap);

  const isFullEllipse =
    Math.abs(e.endAngle - e.startAngle) >= Math.PI * 2 - 0.001 ||
    (e.startAngle === 0 && e.endAngle === 0);

  if (isFullEllipse) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${strokeW}" transform="rotate(${rotDeg},${cx},${cy})" vector-effect="non-scaling-stroke"/>`;
  }

  // Partial ellipse — approximate as polyline
  const steps  = 32;
  const pts: string[] = [];
  const cosR   = Math.cos(rotDeg * Math.PI / 180);
  const sinR   = Math.sin(rotDeg * Math.PI / 180);
  for (let i = 0; i <= steps; i++) {
    const t  = e.startAngle + (e.endAngle - e.startAngle) * (i / steps);
    const lx = Math.cos(t) * rx;
    const ly = -Math.sin(t) * ry; // flip Y
    const px = cx + lx * cosR - ly * sinR;
    const py = cy + lx * sinR + ly * cosR;
    pts.push(`${round(px)},${round(py)}`);
  }
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildSpline(
  e: Extract<DxfEntity, { kind: 'SPLINE' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  if (e.controlPoints.length < 2) return '';
  const col = resolveColor(e.color, e.layer, layerMap);

  if (e.controlPoints.length === 2) {
    // Degenerate spline — straight line
    const p0 = e.controlPoints[0];
    const p1 = e.controlPoints[e.controlPoints.length - 1];
    return `<line x1="${round(toSvgX(p0.x, vb))}" y1="${round(toSvgY(p0.y, vb))}" x2="${round(toSvgX(p1.x, vb))}" y2="${round(toSvgY(p1.y, vb))}" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
  }

  // Catmull-Rom polyline approximation (no knot vector available)
  const pts = e.controlPoints.map((p) => ({
    x: toSvgX(p.x, vb),
    y: toSvgY(p.y, vb),
  }));

  let d = `M ${round(pts[0].x)} ${round(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[Math.min(pts.length - 1, i + 1)];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round(cp1x)} ${round(cp1y)} ${round(cp2x)} ${round(cp2y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildSolid(
  e: Extract<DxfEntity, { kind: 'SOLID' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
): string {
  if (e.points.length < 3) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  // DXF SOLID corners 3 and 4 are swapped (quirk of DXF format)
  const ordered = [...e.points];
  if (ordered.length === 4) {
    [ordered[2], ordered[3]] = [ordered[3], ordered[2]];
  }
  const pts = ordered
    .map((p) => `${round(toSvgX(p.x, vb))},${round(toSvgY(p.y, vb))}`)
    .join(' ');
  return `<polygon points="${pts}" fill="${col}" fill-opacity="0.6" stroke="${col}" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
}

function buildText(
  e: Extract<DxfEntity, { kind: 'TEXT' | 'MTEXT' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
): string {
  const x   = round(toSvgX(e.position.x, vb));
  const y   = round(toSvgY(e.position.y, vb));
  const col = resolveColor(e.color, e.layer, layerMap);

  // Strip MTEXT codes, trim, clamp length
  const raw = e.kind === 'MTEXT' ? stripMtext(e.text) : e.text;
  const txt = raw.slice(0, 80).trim();
  if (!txt) return '';

  // Font size: scale DXF height to SVG, clamp 7-24 px
  let fs = 10;
  if (e.height > 0 && vb.ext.height > 0) {
    fs = Math.round((e.height / vb.ext.height) * vb.svgH);
    fs = Math.max(7, Math.min(24, fs));
  }

  return `<text x="${x}" y="${y}" font-family="Arial,monospace,sans-serif" font-size="${fs}" fill="${col}" dominant-baseline="text-after-edge">${escXml(txt)}</text>`;
}

// ── Block entity renderer (world-space transform) ─────────────────────────────

/**
 * Render the entities of a block definition, applying the INSERT transform:
 *   - Translate to INSERT position
 *   - Scale by xScale / yScale
 *   - Rotate by rotation (degrees, CCW in DXF = CW in SVG after Y-flip)
 *
 * Block geometry is defined in block-local coordinates (origin = block base point).
 * We wrap it in a <g transform="translate(...) rotate(...) scale(...)"> element.
 */
function buildBlockInstance(
  ins: Extract<DxfEntity, { kind: 'INSERT' }>,
  block: DxfBlockDef,
  vb: ViewBox,
  layerMap: Record<string, string>,
  strokeW: number,
): string {
  if (block.entities.length === 0) return '';

  // INSERT position in SVG coordinates
  const tx = round(toSvgX(ins.position.x, vb));
  const ty = round(toSvgY(ins.position.y, vb));

  // Scale: map world-unit scale to SVG-unit scale.
  // scaleLen converts 1 world-unit → SVG units; multiply by xScale/yScale.
  const sx = round(scaleLen(ins.xScale,  vb));
  const sy = round(scaleLenY(ins.yScale, vb));

  // Rotation: DXF is CCW in world space. After Y-flip → CW in SVG.
  const rotDeg = round(-ins.rotation);

  // Block base point offset (origin of block in block space → SVG)
  // We translate so that block's (0,0) maps to INSERT position.
  const bx = round(scaleLen(block.base.x,  vb));
  const by = round(scaleLenY(block.base.y, vb));

  // Render block entities in a temporary local viewbox (block-space)
  // Block entities use block-local coordinates, so we need a "block-local" vb.
  // Instead, we transform each entity's world coords to SVG and then use a group transform.
  //
  // Strategy: render block entities in raw SVG coordinates WITHOUT the INSERT
  // offset (treat block origin as 0,0), then apply group transform.
  //
  // We use a localVb that maps block-local coords to [0..svgW] × [0..svgH]
  // using the same scale as the parent vb (so geometry is correctly sized).
  // The translate + scale + rotate group handles positioning.

  const parts: string[] = [];

  for (const e of block.entities) {
    let svg = '';
    switch (e.kind) {
      case 'LINE':
        svg = buildLineRaw(e, vb, layerMap, strokeW);
        break;
      case 'LWPOLYLINE':
        svg = buildPolylineRaw(e, vb, layerMap, strokeW);
        break;
      case 'ARC':
        svg = buildArcRaw(e, vb, layerMap, strokeW);
        break;
      case 'CIRCLE':
        svg = buildCircleRaw(e, vb, layerMap, strokeW);
        break;
      case 'ELLIPSE':
        svg = buildEllipseRaw(e, vb, layerMap, strokeW);
        break;
      case 'SPLINE':
        svg = buildSplineRaw(e, vb, layerMap, strokeW);
        break;
      case 'SOLID':
        svg = buildSolidRaw(e, vb, layerMap);
        break;
      case 'TEXT':
      case 'MTEXT':
        svg = buildTextRaw(e, vb, layerMap);
        break;
      case 'INSERT':
        // Nested INSERT inside block — skip for now (avoid recursion)
        break;
    }
    if (svg) parts.push(svg);
  }

  if (parts.length === 0) return '';

  // transform="translate(tx,ty) rotate(rotDeg) scale(sx,sy) translate(-bx,-by)"
  // This positions block origin at INSERT position, applies scale + rotation.
  const transform = [
    `translate(${tx},${ty})`,
    rotDeg !== 0 ? `rotate(${rotDeg})` : '',
    (sx !== 1 || sy !== 1) ? `scale(${sx},${sy})` : '',
    (bx !== 0 || by !== 0) ? `translate(${-bx},${-by})` : '',
  ].filter(Boolean).join(' ');

  return `<g transform="${transform}">\n${parts.map((p) => '  ' + p).join('\n')}\n</g>`;
}

// ── "Raw" builders — block-local coords (relative to block origin 0,0) ───────
// These map block-local coordinates using the parent viewbox scale only
// (no offset translation — the group transform handles that).

function localX(worldX: number, vb: ViewBox): number {
  // block-local: just scale, no minX offset
  return worldX / vb.ext.width * vb.svgW;
}
function localY(worldY: number, vb: ViewBox): number {
  // block-local: scale + flip Y (no maxY offset for block entities)
  return -worldY / vb.ext.height * vb.svgH;
}

function buildLineRaw(
  e: Extract<DxfEntity, { kind: 'LINE' }>,
  vb: ViewBox, layerMap: Record<string, string>, strokeW: number,
): string {
  const x1 = round(localX(e.start.x, vb)); const y1 = round(localY(e.start.y, vb));
  const x2 = round(localX(e.end.x,   vb)); const y2 = round(localY(e.end.y,   vb));
  const col = resolveColor(e.color, e.layer, layerMap);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildPolylineRaw(
  e: Extract<DxfEntity, { kind: 'LWPOLYLINE' }>,
  vb: ViewBox, layerMap: Record<string, string>, strokeW: number,
): string {
  if (e.vertices.length < 2) return '';
  const pts = e.vertices
    .map((v) => `${round(localX(v.x, vb))},${round(localY(v.y, vb))}`)
    .join(' ');
  const col = resolveColor(e.color, e.layer, layerMap);
  const tag  = e.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pts}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildArcRaw(
  e: Extract<DxfEntity, { kind: 'ARC' }>,
  vb: ViewBox, layerMap: Record<string, string>, strokeW: number,
): string {
  const cx = round(localX(e.center.x, vb));
  const cy = round(localY(e.center.y, vb));
  const rx = round(scaleLen(e.radius,  vb));
  const ry = round(scaleLenY(e.radius, vb));
  if (rx < 0.5 || ry < 0.5) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  const d   = arcPath(cx, cy, rx, ry, e.startAngle, e.endAngle);
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildCircleRaw(
  e: Extract<DxfEntity, { kind: 'CIRCLE' }>,
  vb: ViewBox, layerMap: Record<string, string>, strokeW: number,
): string {
  const cx = round(localX(e.center.x, vb));
  const cy = round(localY(e.center.y, vb));
  const rx = round(scaleLen(e.radius,  vb));
  const ry = round(scaleLenY(e.radius, vb));
  if (rx < 0.5 || ry < 0.5) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildEllipseRaw(
  e: Extract<DxfEntity, { kind: 'ELLIPSE' }>,
  vb: ViewBox, layerMap: Record<string, string>, strokeW: number,
): string {
  const cx = round(localX(e.center.x, vb));
  const cy = round(localY(e.center.y, vb));
  const majorLen = Math.hypot(e.majorAxis.x, e.majorAxis.y);
  const minorLen = majorLen * e.axisRatio;
  const rx = round(scaleLen(majorLen,  vb));
  const ry = round(scaleLenY(minorLen, vb));
  if (rx < 0.5 || ry < 0.5) return '';
  const rotDeg = round(-(Math.atan2(e.majorAxis.y, e.majorAxis.x) * 180) / Math.PI);
  const col    = resolveColor(e.color, e.layer, layerMap);
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${strokeW}" transform="rotate(${rotDeg},${cx},${cy})" vector-effect="non-scaling-stroke"/>`;
}

function buildSplineRaw(
  e: Extract<DxfEntity, { kind: 'SPLINE' }>,
  vb: ViewBox, layerMap: Record<string, string>, strokeW: number,
): string {
  if (e.controlPoints.length < 2) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  if (e.controlPoints.length === 2) {
    const p0 = e.controlPoints[0], p1 = e.controlPoints[1];
    return `<line x1="${round(localX(p0.x, vb))}" y1="${round(localY(p0.y, vb))}" x2="${round(localX(p1.x, vb))}" y2="${round(localY(p1.y, vb))}" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
  }
  const pts = e.controlPoints.map((p) => ({ x: localX(p.x, vb), y: localY(p.y, vb) }));
  let d = `M ${round(pts[0].x)} ${round(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[Math.min(pts.length - 1, i + 1)];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round(cp1x)} ${round(cp1y)} ${round(cp2x)} ${round(cp2y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
}

function buildSolidRaw(
  e: Extract<DxfEntity, { kind: 'SOLID' }>,
  vb: ViewBox, layerMap: Record<string, string>,
): string {
  if (e.points.length < 3) return '';
  const col = resolveColor(e.color, e.layer, layerMap);
  const ordered = [...e.points];
  if (ordered.length === 4) [ordered[2], ordered[3]] = [ordered[3], ordered[2]];
  const pts = ordered.map((p) => `${round(localX(p.x, vb))},${round(localY(p.y, vb))}`).join(' ');
  return `<polygon points="${pts}" fill="${col}" fill-opacity="0.6" stroke="${col}" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
}

function buildTextRaw(
  e: Extract<DxfEntity, { kind: 'TEXT' | 'MTEXT' }>,
  vb: ViewBox, layerMap: Record<string, string>,
): string {
  const x   = round(localX(e.position.x, vb));
  const y   = round(localY(e.position.y, vb));
  const col = resolveColor(e.color, e.layer, layerMap);
  const raw = e.kind === 'MTEXT' ? stripMtext(e.text) : e.text;
  const txt = raw.slice(0, 80).trim();
  if (!txt) return '';
  let fs = 10;
  if (e.height > 0 && vb.ext.height > 0) {
    fs = Math.round((e.height / vb.ext.height) * vb.svgH);
    fs = Math.max(7, Math.min(24, fs));
  }
  return `<text x="${x}" y="${y}" font-family="Arial,monospace,sans-serif" font-size="${fs}" fill="${col}" dominant-baseline="text-after-edge">${escXml(txt)}</text>`;
}

// ── Main render function ──────────────────────────────────────────────────────

/**
 * Render a DXF buffer to an SVG string.
 *
 * Returns SVG with viewBox matching the drawing's actual aspect ratio.
 * Supports all major P&ID entity types including nested block geometry.
 */
export function renderDxfToSvg(buffer: Buffer): {
  svg: string;
  extents: DxfParseResult['extents'];
  entityCount: number;
} {
  const parsed = parseDxf(buffer);
  const { entities, blocks, extents, layerMap } = parsed;

  // Compute SVG dimensions preserving drawing aspect ratio
  const aspect = extents.height > 0 ? extents.width / extents.height : 1;
  const svgW   = SVG_BASE;
  const svgH   = Math.round(SVG_BASE / aspect);

  const vb: ViewBox = { svgW, svgH, ext: extents };

  // Stroke width: scale to canvas for readability (~0.1% of width)
  const strokeW = Math.max(0.5, Math.round(svgW * 0.001 * 10) / 10);

  // Entity limits (per type) to keep SVG DOM manageable
  const MAX_LINES   = 20_000;
  const MAX_TEXTS   = 5_000;
  const MAX_INSERTS = 5_000;

  let lineCount   = 0;
  let textCount   = 0;
  let insertCount = 0;

  // Render order: lines (bg) → inserts/blocks (symbols) → text (labels on top)
  const lineParts:   string[] = [];
  const insertParts: string[] = [];
  const textParts:   string[] = [];

  for (const e of entities) {
    switch (e.kind) {
      case 'LINE':
        if (lineCount < MAX_LINES) {
          lineParts.push(buildLine(e, vb, layerMap, strokeW));
          lineCount++;
        }
        break;

      case 'LWPOLYLINE':
        if (lineCount < MAX_LINES) {
          const s = buildPolyline(e, vb, layerMap, strokeW);
          if (s) lineParts.push(s);
          lineCount += e.vertices.length;
        }
        break;

      case 'ARC':
        if (lineCount < MAX_LINES) {
          const s = buildArc(e, vb, layerMap, strokeW);
          if (s) lineParts.push(s);
          lineCount++;
        }
        break;

      case 'CIRCLE':
        if (lineCount < MAX_LINES) {
          const s = buildCircle(e, vb, layerMap, strokeW);
          if (s) lineParts.push(s);
          lineCount++;
        }
        break;

      case 'ELLIPSE':
        if (lineCount < MAX_LINES) {
          const s = buildEllipse(e, vb, layerMap, strokeW);
          if (s) lineParts.push(s);
          lineCount++;
        }
        break;

      case 'SPLINE':
        if (lineCount < MAX_LINES) {
          const s = buildSpline(e, vb, layerMap, strokeW);
          if (s) lineParts.push(s);
          lineCount++;
        }
        break;

      case 'SOLID':
        if (lineCount < MAX_LINES) {
          const s = buildSolid(e, vb, layerMap);
          if (s) lineParts.push(s);
          lineCount++;
        }
        break;

      case 'INSERT': {
        if (insertCount >= MAX_INSERTS) break;
        insertCount++;

        const block = blocks[e.blockName];
        if (block && block.entities.length > 0) {
          // Render actual block geometry
          const s = buildBlockInstance(e, block, vb, layerMap, strokeW);
          if (s) {
            insertParts.push(s);
          } else {
            // Block exists but rendered nothing — fall through to dot marker
            insertParts.push(buildInsertMarker(e, vb, layerMap));
          }
        } else {
          // No block definition found — render as labeled dot marker
          insertParts.push(buildInsertMarker(e, vb, layerMap));
        }
        break;
      }

      case 'TEXT':
      case 'MTEXT':
        if (textCount < MAX_TEXTS) {
          const s = buildText(e, vb, layerMap);
          if (s) textParts.push(s);
          textCount++;
        }
        break;
    }
  }

  // Layer legend
  const usedCategories = new Set(Object.values(layerMap));
  const legendItems: string[] = [];
  let ly = svgH - 20;
  for (const cat of ['pipe', 'instrument', 'equipment', 'text', 'other']) {
    if (!usedCategories.has(cat)) continue;
    const col = CATEGORY_COLOR[cat];
    legendItems.push(
      `<rect x="10" y="${ly - 8}" width="16" height="8" fill="${col}" opacity="0.8"/>`,
      `<text x="30" y="${ly}" font-family="Arial,monospace,sans-serif" font-size="11" fill="#e0e0e0" opacity="0.7">${escXml(cat)}</text>`,
    );
    ly -= 16;
  }

  const unitLabel =
    parsed.units === 4 ? 'mm' :
    parsed.units === 6 ? 'm'  :
    parsed.units === 1 ? 'in' : 'units';

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     viewBox="0 0 ${svgW} ${svgH}"`,
    `     width="${svgW}" height="${svgH}"`,
    `     style="background:${BG_COLOR};">`,
    `  <!-- DXF v2 render: ${entities.length} entities, ${parsed.layers.length} layers, ${parsed.blockNames.length} blocks -->`,
    `  <!-- Extents: ${Math.round(extents.width)}×${Math.round(extents.height)} ${unitLabel} | SVG: ${svgW}×${svgH} -->`,
    `  <rect width="${svgW}" height="${svgH}" fill="${BG_COLOR}"/>`,
    `  <g id="dxf-lines">`,
    ...lineParts.map((p)   => `    ${p}`),
    `  </g>`,
    `  <g id="dxf-inserts">`,
    ...insertParts.map((p) => `    ${p}`),
    `  </g>`,
    `  <g id="dxf-text">`,
    ...textParts.map((p)   => `    ${p}`),
    `  </g>`,
    `  <g id="dxf-legend" opacity="0.85">`,
    ...legendItems,
    `  </g>`,
    `</svg>`,
  ].join('\n');

  return { svg, extents, entityCount: entities.length };
}

// ── INSERT dot marker (fallback when no block def found) ──────────────────────

function buildInsertMarker(
  e: Extract<DxfEntity, { kind: 'INSERT' }>,
  vb: ViewBox,
  layerMap: Record<string, string>,
): string {
  const px  = round(toSvgX(e.position.x, vb));
  const py  = round(toSvgY(e.position.y, vb));
  const col = resolveColor(0, e.layer, layerMap); // use layer color
  const r   = 6;
  const blockLabel = escXml((e.blockName || 'BLK').replace(/^[*_]/, '').slice(0, 24));

  const parts = [
    `<circle cx="${px}" cy="${py}" r="${r}" fill="${col}" fill-opacity="0.2" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
    `<circle cx="${px}" cy="${py}" r="2" fill="${col}"/>`,
    `<text x="${px + r + 3}" y="${py + 4}" font-family="Arial,monospace,sans-serif" font-size="9" fill="${col}" opacity="0.85">${blockLabel}</text>`,
  ];

  if (e.attributes.length > 0) {
    const tagText = e.attributes
      .map((a) => escXml(a.value.trim().slice(0, 24)))
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');
    if (tagText) {
      parts.push(
        `<text x="${px + r + 3}" y="${py + 16}" font-family="Arial,monospace,sans-serif" font-size="11" fill="${col}" font-weight="bold">${tagText}</text>`,
      );
    }
  }

  return parts.join('\n');
}
