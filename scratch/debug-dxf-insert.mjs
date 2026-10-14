import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DxfParser = require('dxf-parser');

const buf = readFileSync('storage/d1973331-9335-497a-a670-6457b6508fd6-INTAN_GS.dxf');
const parser = new DxfParser();
const dxf = parser.parseSync(buf.toString('utf-8'));
const inserts = (dxf.entities||[]).filter(e => e.type === 'INSERT');

// Show ALL keys on first INSERT to find scale/rotation field names
console.log('=== ALL KEYS ON INSERT[0] ===');
const ins0 = inserts[0];
console.log(JSON.stringify(ins0, null, 2));
