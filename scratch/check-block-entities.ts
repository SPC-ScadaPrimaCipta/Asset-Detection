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

for (const name of ['VALV_BALL', 'VALV_CHECK', 'PUMP_VERTICAL', 'EQU_JNCT_BOX', 'FTG_REDUCER']) {
  const blk = dxf.blocks?.[name];
  console.log(`Block ${name}: entities = ${(blk?.entities || []).length}`);
  (blk?.entities || []).forEach((e: any) => {
    console.log(`  - ${e.type}: layer=${e.layer}`);
  });
}
