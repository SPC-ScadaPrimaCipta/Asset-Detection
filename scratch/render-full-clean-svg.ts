import fs from 'fs';
import { parseDxf, type DxfPoint } from '../lib/dxf-parser';

const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const parsed = parseDxf(buf);

// Filter out degenerate zero-length lines and isolated origin entities
const validEntities = parsed.entities.filter((e) => {
  if (e.kind === 'LINE') {
    if (e.start.x === 0 && e.start.y === 0 && e.end.x === 0 && e.end.y === 0) return false;
    if (Math.hypot(e.start.x - e.end.x, e.start.y - e.end.y) < 0.0001) return false;
  }
  if (e.kind === 'INSERT') {
    if (Math.abs(e.position.x) < 1 && e.position.y <= 0) return false;
  }
  return true;
});

// Compute clean extents
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const e of validEntities) {
  if (e.kind === 'LINE') {
    minX = Math.min(minX, e.start.x, e.end.x);
    maxX = Math.max(maxX, e.start.x, e.end.x);
    minY = Math.min(minY, e.start.y, e.end.y);
    maxY = Math.max(maxY, e.start.y, e.end.y);
  } else if (e.kind === 'LWPOLYLINE') {
    for (const v of e.vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  } else if (e.kind === 'INSERT' || e.kind === 'TEXT' || e.kind === 'MTEXT') {
    minX = Math.min(minX, e.position.x);
    maxX = Math.max(maxX, e.position.x);
    minY = Math.min(minY, e.position.y);
    maxY = Math.max(maxY, e.position.y);
  }
}

const padX = (maxX - minX) * 0.01;
const padY = (maxY - minY) * 0.01;
minX -= padX; maxX += padX;
minY -= padY; maxY += padY;
const dxfWidth = maxX - minX;
const dxfHeight = maxY - minY;

const SVG_BASE_WIDTH = 2400;
const scale = SVG_BASE_WIDTH / dxfWidth;
const SVG_WIDTH = SVG_BASE_WIDTH;
const SVG_HEIGHT = Math.round(dxfHeight * scale);

console.log('Clean Extents:', { minX, minY, maxX, maxY, dxfWidth, dxfHeight });
console.log('SVG Dimensions:', { SVG_WIDTH, SVG_HEIGHT, uniformScale: scale });
