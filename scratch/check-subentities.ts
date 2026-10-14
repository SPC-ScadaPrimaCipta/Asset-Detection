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

console.log('Total entities in Model Space:', dxf.entities.length);
console.log('Total blocks:', Object.keys(dxf.blocks || {}).length);
let subEntitiesCount = 0;
for (const [name, blk] of Object.entries<any>(dxf.blocks || {})) {
  if (name.startsWith('*Paper_Space')) continue;
  if (name === '*Model_Space') continue;
  subEntitiesCount += (blk.entities || []).length;
}
console.log('Total sub-entities in symbol blocks:', subEntitiesCount);
