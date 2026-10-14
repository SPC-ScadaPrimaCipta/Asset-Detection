import fs from 'fs';
import { parseDxf } from '../lib/dxf-parser';

const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const parsed = parseDxf(buf);
const large: any[] = [];
for (const e of parsed.entities) {
  if (e.kind === 'LWPOLYLINE') {
    const xs = e.vertices.map((v) => v.x);
    const ys = e.vertices.map((v) => v.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w > 1000 && h > 500) {
      large.push({
        layer: e.layer,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        w,
        h,
      });
    }
  }
}
console.log('Large polylines count:', large.length);
console.log(JSON.stringify(large, null, 2));
