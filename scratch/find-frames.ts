import fs from 'fs';
import { parseDxf } from '../lib/dxf-parser';

const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const parsed = parseDxf(buf);
const frames = parsed.entities.filter((e) => e.layer === '_Frame');
console.log('Frame entities count:', frames.length);
frames.forEach((f, idx) => {
  if (f.kind === 'LWPOLYLINE') {
    const xs = f.vertices.map((v) => v.x);
    const ys = f.vertices.map((v) => v.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    console.log(`Frame ${idx} (${f.closed ? 'closed' : 'open'}, ${f.vertices.length}v): minX=${Math.min(...xs).toFixed(1)}, maxX=${Math.max(...xs).toFixed(1)}, minY=${Math.min(...ys).toFixed(1)}, maxY=${Math.max(...ys).toFixed(1)} -> ${w.toFixed(1)} x ${h.toFixed(1)}`);
  }
});
