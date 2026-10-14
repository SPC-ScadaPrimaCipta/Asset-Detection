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
console.log('dxf.blocks keys count:', Object.keys(dxf?.blocks || {}).length);
const sampleBlockName = 'VALV_BALL';
console.log('Sample block', sampleBlockName, dxf?.blocks?.[sampleBlockName]);
