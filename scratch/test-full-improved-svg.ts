import fs from 'fs';
import DxfParserModule from 'dxf-parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DxfParser: any =
  typeof DxfParserModule === 'function'
    ? DxfParserModule
    : (DxfParserModule as any)?.default ?? (DxfParserModule as any)?.DxfParser ?? DxfParserModule;

const parser = new DxfParser();
const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const dxf = parser.parseSync(buf.toString('utf-8'));

// Filter out degenerate zero-length lines and isolated origin entities
const validEntities = (dxf.entities || []).filter((e: any) => {
  if (e.type === 'LINE') {
    if (!e.start || !e.end) return false;
    if (e.start.x === 0 && e.start.y === 0 && e.end.x === 0 && e.end.y === 0) return false;
    if (Math.hypot(e.start.x - e.end.x, e.start.y - e.end.y) < 0.0001) return false;
  }
  if (e.type === 'INSERT') {
    if (e.position && Math.abs(e.position.x) < 1 && e.position.y <= 0) return false;
  }
  return true;
});

// Compute clean extents
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const e of validEntities) {
  if (e.type === 'LINE') {
    minX = Math.min(minX, e.start.x, e.end.x);
    maxX = Math.max(maxX, e.start.x, e.end.x);
    minY = Math.min(minY, e.start.y, e.end.y);
    maxY = Math.max(maxY, e.start.y, e.end.y);
  } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    for (const v of e.vertices || []) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  } else if (e.type === 'INSERT' || e.type === 'TEXT' || e.type === 'MTEXT') {
    if (e.position) {
      minX = Math.min(minX, e.position.x);
      maxX = Math.max(maxX, e.position.x);
      minY = Math.min(minY, e.position.y);
      maxY = Math.max(maxY, e.position.y);
    }
  } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
    if (e.center && e.radius) {
      minX = Math.min(minX, e.center.x - e.radius);
      maxX = Math.max(maxX, e.center.x + e.radius);
      minY = Math.min(minY, e.center.y - e.radius);
      maxY = Math.max(maxY, e.center.y + e.radius);
    }
  }
}

// Add 1.5% margin
const padX = (maxX - minX) * 0.015;
const padY = (maxY - minY) * 0.015;
minX -= padX; maxX += padX;
minY -= padY; maxY += padY;
const dxfWidth = maxX - minX;
const dxfHeight = maxY - minY;

// Uniform scale targeting 3000px width
const SVG_WIDTH = 3000;
const scale = SVG_WIDTH / dxfWidth;
const SVG_HEIGHT = Math.round(dxfHeight * scale);

function toSvgX(x: number): number {
  return Math.round((x - minX) * scale * 10) / 10;
}
function toSvgY(y: number): number {
  return Math.round((maxY - y) * scale * 10) / 10;
}

const CATEGORY_COLOR: Record<string, string> = {
  pipe: '#00bcd4',
  instrument: '#ffd600',
  equipment: '#69f0ae',
  text: '#ffab40',
  other: '#b0bec5',
};

const PIPE_PATTERNS = [/pipe/i, /piping/i, /process/i, /fluid/i, /flow/i, /line/i];
const INSTR_PATTERNS = [/instr/i, /instrument/i, /tag/i, /signal/i, /control/i];
const TEXT_PATTERNS = [/text/i, /annot/i, /label/i, /note/i, /dim/i];
const EQUIP_PATTERNS = [/equip/i, /vessel/i, /pump/i, /valve/i, /symbol/i, /mech/i];

function catColor(layerName: string): string {
  const l = layerName || '';
  if (PIPE_PATTERNS.some((r) => r.test(l))) return CATEGORY_COLOR.pipe;
  if (INSTR_PATTERNS.some((r) => r.test(l))) return CATEGORY_COLOR.instrument;
  if (EQUIP_PATTERNS.some((r) => r.test(l))) return CATEGORY_COLOR.equipment;
  if (TEXT_PATTERNS.some((r) => r.test(l))) return CATEGORY_COLOR.text;
  return CATEGORY_COLOR.other;
}

const linesSvg: string[] = [];
const blocksSvg: string[] = [];
const textSvg: string[] = [];

// Render entities
for (const e of validEntities) {
  const col = catColor(e.layer);
  if (e.type === 'LINE') {
    const x1 = toSvgX(e.start.x);
    const y1 = toSvgY(e.start.y);
    const x2 = toSvgX(e.end.x);
    const y2 = toSvgY(e.end.y);
    linesSvg.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
  } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    const pts = (e.vertices || []).map((v: any) => `${toSvgX(v.x)},${toSvgY(v.y)}`).join(' ');
    const tag = e.closed ? 'polygon' : 'polyline';
    linesSvg.push(`<${tag} points="${pts}" fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
  } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
    const raw = String(e.text || e.string || '')
      .replace(/\\[A-Za-z;][^;]*;/g, '')
      .replace(/[{}]/g, '')
      .trim();
    if (!raw) continue;
    const x = toSvgX(e.position?.x ?? 0);
    const y = toSvgY(e.position?.y ?? 0);
    const fs = Math.max(9, Math.min(24, Math.round(((e.textHeight || e.height || 3) * scale))));
    const esc = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    textSvg.push(`<text x="${x}" y="${y}" font-family="monospace,sans-serif" font-size="${fs}" fill="${col}" opacity="0.95">${esc}</text>`);
  } else if (e.type === 'INSERT') {
    const blk = dxf.blocks?.[e.name];
    const insX = e.position?.x ?? 0;
    const insY = e.position?.y ?? 0;
    const rot = Number(e.rotation || 0);
    const rotRad = (rot * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const sx = Number(e.xScale ?? 1);
    const sy = Number(e.yScale ?? 1);

    function tf(px: number, py: number) {
      const rx = (px * cos - py * sin) * sx;
      const ry = (px * sin + py * cos) * sy;
      return { x: toSvgX(insX + rx), y: toSvgY(insY + ry) };
    }

    if (blk?.entities && blk.entities.length > 0) {
      for (const sub of blk.entities) {
        const subCol = sub.layer && sub.layer !== '0' ? catColor(sub.layer) : col;
        if (sub.type === 'LINE') {
          const sX = sub.start?.x ?? sub.vertices?.[0]?.x;
          const sY = sub.start?.y ?? sub.vertices?.[0]?.y;
          const eX = sub.end?.x ?? sub.vertices?.[1]?.x;
          const eY = sub.end?.y ?? sub.vertices?.[1]?.y;
          if (sX !== undefined && sY !== undefined && eX !== undefined && eY !== undefined) {
            const p1 = tf(sX, sY);
            const p2 = tf(eX, eY);
            blocksSvg.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
          }
        } else if (sub.type === 'LWPOLYLINE' || sub.type === 'POLYLINE') {
          const pts = (sub.vertices || []).map((v: any) => {
            const p = tf(v.x, v.y);
            return `${p.x},${p.y}`;
          }).join(' ');
          const tag = sub.closed ? 'polygon' : 'polyline';
          blocksSvg.push(`<${tag} points="${pts}" fill="none" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
        } else if (sub.type === 'CIRCLE') {
          const cX = sub.center?.x ?? 0;
          const cY = sub.center?.y ?? 0;
          const c = tf(cX, cY);
          const r = Math.round((sub.radius || 1) * Math.abs(sx) * scale * 10) / 10;
          blocksSvg.push(`<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="none" stroke="${subCol}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
        }
      }
    }
  }
}

const finalSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" style="background:#1a1a1a;">
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#1a1a1a"/>
  <g id="lines">${linesSvg.join('\n')}</g>
  <g id="symbols">${blocksSvg.join('\n')}</g>
  <g id="text">${textSvg.join('\n')}</g>
</svg>`;

fs.writeFileSync('./storage/test-clean-render.svg', finalSvg, 'utf-8');
console.log('Successfully rendered clean SVG:', finalSvg.length, 'bytes');
console.log('Lines count:', linesSvg.length, 'Symbols count:', blocksSvg.length, 'Text count:', textSvg.length);
