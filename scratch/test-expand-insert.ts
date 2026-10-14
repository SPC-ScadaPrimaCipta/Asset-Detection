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

// Test expanding an INSERT
const inserts = dxf.entities.filter((e: any) => e.type === 'INSERT' && e.name === 'VALV_BALL');
console.log('Found VALV_BALL inserts:', inserts.length);
if (inserts.length > 0) {
  const ins = inserts[0];
  const blk = dxf.blocks?.[ins.name];
  console.log('Ins position:', ins.position, 'rotation:', ins.rotation, 'scale:', ins.xScale, ins.yScale);
  console.log('Block sub-entities:', blk?.entities);
}
