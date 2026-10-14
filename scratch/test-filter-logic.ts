import fs from 'fs';
import { parseDxf } from '../lib/dxf-parser';

const buf = fs.readFileSync('./storage/f69b09a5-09f1-4893-95bb-696c049f7f28-WS_Fire_Water_SP_PDT.dxf');
const parsed = parseDxf(buf);

console.log('Total entities:', parsed.entities.length);
console.log('Current extents:', parsed.extents);
