import fs from 'fs';
import { parseDxf } from '../lib/dxf-parser';

const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const parsed = parseDxf(buf);
const below2600: any[] = [];
for (const e of parsed.entities) {
  let minY = Infinity;
  let maxY = -Infinity;
  if (e.kind === 'LINE') {
    minY = Math.min(e.start.y, e.end.y);
    maxY = Math.max(e.start.y, e.end.y);
  } else if (e.kind === 'INSERT' || e.kind === 'TEXT' || e.kind === 'MTEXT') {
    minY = maxY = e.position.y;
  } else if (e.kind === 'LWPOLYLINE') {
    minY = Math.min(...e.vertices.map((v) => v.y));
    maxY = Math.max(...e.vertices.map((v) => v.y));
  }
  if (minY < 2600) {
    below2600.push({ kind: e.kind, layer: e.layer, minY, maxY, e });
  }
}
console.log('Entities below 2600:', below2600.length);
below2600.slice(0, 15).forEach((x) => console.log(x.kind, x.layer, 'minY:', x.minY, 'maxY:', x.maxY));
