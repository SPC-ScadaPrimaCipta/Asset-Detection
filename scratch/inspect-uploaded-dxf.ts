import fs from 'fs';
import { parseDxf } from '../lib/dxf-parser';

console.log('Starting inspect...');
const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
console.log('File read, size:', buf.length);
const parsed = parseDxf(buf);
console.log('Entities count:', parsed.entities.length);
console.log('Extents:', parsed.extents);
console.log('Aspect ratio (w/h):', parsed.extents.width / parsed.extents.height);
console.log('Layers:', parsed.layers);
const inserts = parsed.entities.filter((e) => e.kind === 'INSERT');
console.log('Inserts count:', inserts.length);
const blockFreq: Record<string, number> = {};
for (const i of inserts) {
  if (i.kind === 'INSERT') {
    blockFreq[i.blockName] = (blockFreq[i.blockName] || 0) + 1;
  }
}
console.log('Top block names:', Object.entries(blockFreq).sort((a, b) => b[1] - a[1]).slice(0, 20));
