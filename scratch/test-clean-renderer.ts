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

console.log('Entities in dxf:', dxf.entities.length);
// Filter out degenerate zero-length lines at origin
const validEntities = dxf.entities.filter((e: any) => {
  if (e.type === 'LINE') {
    if (e.start.x === 0 && e.start.y === 0 && e.end.x === 0 && e.end.y === 0) return false;
  }
  if (e.type === 'INSERT') {
    if (e.position.x === 0 && e.position.y < 0) return false;
  }
  return true;
});
console.log('Valid entities:', validEntities.length);

// Calculate bounding box of valid entities
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

console.log('Clean extents:', { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, ratio: (maxX - minX) / (maxY - minY) });
