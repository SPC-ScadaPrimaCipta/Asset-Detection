import fs from 'fs';
import { parseDxf } from '../lib/dxf-parser';

const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const parsed = parseDxf(buf);

for (const e of parsed.entities) {
  if (e.kind === 'LINE') {
    if (e.start.x < 100 || e.start.y < 1000 || e.end.x < 100 || e.end.y < 1000) {
      console.log('LINE:', e.layer, e.start, e.end);
    }
  } else if (e.kind === 'INSERT') {
    if (e.position.x < 100 || e.position.y < 1000) {
      console.log('INSERT:', e.layer, e.blockName, e.position);
    }
  } else if (e.kind === 'LWPOLYLINE') {
    if (e.vertices.some((v) => v.x < 100 || v.y < 1000)) {
      console.log('LWPOLYLINE:', e.layer, e.vertices.slice(0, 3));
    }
  }
}
