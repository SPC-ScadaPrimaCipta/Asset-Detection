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
 *   - INSERT blocks: colored circle + label (distinct from lines)
 *   - Text: small, clipped, readable on dark bg
 *   - Stroke width scaled relative to canvas for readability
 *
 * Coordinate mapping:
 *   DXF Y-axis = up (bottom-left origin)
 *   SVG Y-axis = down (top-left origin)
 *   Flip: svgY = maxY - dxfY  (normalised to 0-SVG_SIZE)
 *
 * Output SVG dimensions: 2000×2000 viewBox.
 */

import { parseDxf, type DxfParseResult, type DxfEntity } from '@/lib/dxf-parser';

const SVG_SIZE = 2000;
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

function toSvgX(x: number, ext: DxfParseResult['extents']): number {
  if (ext.width <= 0) return SVG_SIZE / 2;
  return Math.round(((x - ext.minX) / ext.width) * SVG_SIZE * 10) / 10;
}

function toSvgY(y: number, ext: DxfParseResult['extents']): number {
  if (ext.height <= 0) return SVG_SIZE / 2;
  // Flip Y: DXF bottom-left → SVG top-left
  return Math.round(((ext.maxY - y) / ext.height) * SVG_SIZE * 10) / 10;
}

function svgPt(x: number, y: number, ext: DxfParseResult['extents']): { x: number; y: number } {
  return { x: toSvgX(x, ext), y: toSvgY(y, ext) };
}

// ── Text height ───────────────────────────────────────────────────────────────

function textSizePx(dxfHeight: number, ext: DxfParseResult['extents']): number {
  if (dxfHeight <= 0 || ext.height <= 0) return 9;
  const raw = (dxfHeight / ext.height) * SVG_SIZE;
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
  ext: DxfParseResult['extents'],
  layerMap: Record<string, string>,
): string {
  const s = svgPt(e.start.x, e.start.y, ext);
  const en = svgPt(e.end.x, e.end.y, ext);
  const col = layerColor(e.layer, layerMap);
  return `<line x1="${s.x}" y1="${s.y}" x2="${en.x}" y2="${en.y}" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
}

function buildPolyline(
  e: Extract<DxfEntity, { kind: 'LWPOLYLINE' }>,
  ext: DxfParseResult['extents'],
  layerMap: Record<string, string>,
): string {
  if (e.vertices.length < 2) return '';
  const pts = e.vertices.map((v) => {
    const p = svgPt(v.x, v.y, ext);
    return `${p.x},${p.y}`;
  });
  const col = layerColor(e.layer, layerMap);
  const tag = e.closed ? 'polygon' : 'polyline';
  return `<${tag} points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
}

function buildText(
  e: Extract<DxfEntity, { kind: 'TEXT' | 'MTEXT' }>,
  ext: DxfParseResult['extents'],
  layerMap: Record<string, string>,
): string {
  const p = svgPt(e.position.x, e.position.y, ext);
  const fs = textSizePx(e.height, ext);
  const col = layerColor(e.layer, layerMap);
  // Truncate long text; MTEXT may have formatting codes — strip them
  const rawText = e.text
    .replace(/\\[A-Za-z;][^;]*;/g, '') // strip MTEXT formatting codes like \fArial;
    .replace(/[{}]/g, '')               // strip MTEXT group brackets
    .slice(0, 60)
    .trim();
  if (!rawText) return '';
  const label = escXml(rawText);
  return `<text x="${p.x}" y="${p.y}" font-family="monospace,sans-serif" font-size="${fs}" fill="${col}" dominant-baseline="text-after-edge" opacity="0.9">${label}</text>`;
}

function buildInsert(
  e: Extract<DxfEntity, { kind: 'INSERT' }>,
  ext: DxfParseResult['extents'],
  layerMap: Record<string, string>,
): string {
  const p = svgPt(e.position.x, e.position.y, ext);
  const col = layerColor(e.layer, layerMap);
  const r = 7; // circle radius in SVG units

  // Block name — shorten for readability
  const blockLabel = escXml((e.blockName || 'BLK').replace(/^[*_]/, '').slice(0, 20));

  const parts: string[] = [
    // Filled circle marker — distinct from plain lines
    `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${col}" fill-opacity="0.25" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
    // Center dot
    `<circle cx="${p.x}" cy="${p.y}" r="2" fill="${col}"/>`,
    // Block name label
    `<text x="${p.x + r + 3}" y="${p.y + 4}" font-family="monospace,sans-serif" font-size="9" fill="${col}" opacity="0.9">${blockLabel}</text>`,
  ];

  // Attribute tags (asset tags like V-101, P-101)
  if (e.attributes.length > 0) {
    const tagText = e.attributes
      .map((a) => escXml(a.value.trim().slice(0, 20)))
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');
    if (tagText) {
      parts.push(
        `<text x="${p.x + r + 3}" y="${p.y + 16}" font-family="monospace,sans-serif" font-size="10" fill="${col}" font-weight="bold" opacity="1">${tagText}</text>`,
      );
    }
  }

  return parts.join('\n');
}

// ── Main render function ──────────────────────────────────────────────────────

/**
 * Render a DXF buffer to an SVG string.
 *
 * The returned SVG uses a 2000×2000 viewBox so the viewer can scale freely.
 * For very large DXF files (>20 000 entities) lines are sampled to keep the
 * SVG DOM size manageable.
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
  const { entities, extents, layerMap } = parsed;

  const MAX_LINES = 15_000;
  const MAX_TEXTS = 4_000;
  const MAX_INSERTS = 3_000;

  let lineCount = 0;
  let textCount = 0;
  let insertCount = 0;

  // Render order: lines first (background), then inserts (symbols), then text (labels on top)
  const lineParts: string[] = [];
  const insertParts: string[] = [];
  const textParts: string[] = [];

  for (const e of entities) {
    if (e.kind === 'LINE') {
      if (lineCount >= MAX_LINES) continue;
      lineParts.push(buildLine(e, extents, layerMap));
      lineCount++;
    } else if (e.kind === 'LWPOLYLINE') {
      if (lineCount >= MAX_LINES) continue;
      const s = buildPolyline(e, extents, layerMap);
      if (s) lineParts.push(s);
      lineCount += e.vertices.length;
    } else if (e.kind === 'TEXT' || e.kind === 'MTEXT') {
      if (textCount >= MAX_TEXTS) continue;
      const s = buildText(e, extents, layerMap);
      if (s) textParts.push(s);
      textCount++;
    } else if (e.kind === 'INSERT') {
      if (insertCount >= MAX_INSERTS) continue;
      insertParts.push(buildInsert(e, extents, layerMap));
      insertCount++;
    }
  }

  // Build layer legend (small key, bottom-left corner)
  const usedCategories = new Set<string>(Object.values(layerMap));
  const legendItems: string[] = [];
  let ly = SVG_SIZE - 20;
  for (const cat of ['pipe', 'instrument', 'equipment', 'text', 'other']) {
    if (!usedCategories.has(cat)) continue;
    const col = CATEGORY_COLOR[cat];
    legendItems.push(
      `<rect x="10" y="${ly - 8}" width="16" height="8" fill="${col}" opacity="0.8"/>`,
      `<text x="30" y="${ly}" font-family="monospace,sans-serif" font-size="11" fill="#e0e0e0" opacity="0.7">${escXml(cat)}</text>`,
    );
    ly -= 16;
  }

  const parts = [...lineParts, ...insertParts, ...textParts];

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}"`,
    `     width="${SVG_SIZE}" height="${SVG_SIZE}"`,
    `     style="background:${BG_COLOR};">`,
    `  <!-- DXF render: ${entities.length} entities, ${parsed.layers.length} layers -->`,
    `  <!-- Extents: ${Math.round(extents.width)}x${Math.round(extents.height)} ${parsed.units === 4 ? 'mm' : parsed.units === 6 ? 'm' : 'units'} -->`,
    `  <!-- Lines:${lineCount} Inserts:${insertCount} Texts:${textCount} -->`,
    `  <rect width="${SVG_SIZE}" height="${SVG_SIZE}" fill="${BG_COLOR}"/>`,
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
