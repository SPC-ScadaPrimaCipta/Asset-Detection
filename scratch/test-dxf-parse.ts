import { parseDxf } from '../lib/dxf-parser';
import { runDxfDetection } from '../lib/dxf-detection';

// Test 0: Binary DXF rejection
console.log('--- Test 0: Binary DXF rejection ---');
const binaryBuf = Buffer.from('AutoCAD Binary DXF\r\n\x1a\x00somedata', 'ascii');
try {
  parseDxf(binaryBuf);
  console.log('FAIL — should have thrown');
} catch (e) {
  console.log('PASS:', (e as Error).message.slice(0, 90));
}

const dxfText = [
  '0', 'SECTION',
  '2', 'HEADER',
  '9', '$INSUNITS',
  '70', '4',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'ENTITIES',
  '0', 'INSERT',
  '8', 'EQUIP',
  '2', 'PUMP',
  '10', '100.0',
  '20', '200.0',
  '30', '0.0',
  '0', 'TEXT',
  '8', 'TAGS',
  '1', 'P-101',
  '10', '105.0',
  '20', '205.0',
  '30', '0.0',
  '0', 'ENDSEC',
  '0', 'EOF',
  '',
].join('\n');

// Test 1: UTF-8 buffer
console.log('--- Test 1: UTF-8 buffer ---');
try {
  const buf = Buffer.from(dxfText, 'utf-8');
  const result = parseDxf(buf);
  console.log('entities:', result.entities.length);
  console.log('types:', result.entities.map((e) => e.kind).join(', '));
  console.log('PASS');
} catch (e) {
  console.error('FAIL:', (e as Error).message);
}

// Test 2: Latin-1 buffer (simulates AutoCAD Windows encoding)
console.log('\n--- Test 2: Latin-1 buffer ---');
try {
  const buf = Buffer.from(dxfText, 'latin1');
  const result = parseDxf(buf);
  console.log('entities:', result.entities.length);
  console.log('PASS');
} catch (e) {
  console.error('FAIL:', (e as Error).message);
}

// Test 3: Detection pipeline
console.log('\n--- Test 3: DXF detection pipeline ---');
try {
  const buf = Buffer.from(dxfText, 'utf-8');
  const result = runDxfDetection(buf, [
    { id: 'legend-1', asset_type: 'Pump', symbol_name: 'PUMP', tag_pattern: 'P-###', aliases: ['P', 'PUMP'] },
  ]);
  console.log('detections:', result.detections.length);
  result.detections.forEach((d) => {
    console.log(`  [${d.source}] tag=${d.assetTag} type=${d.assetType} conf=${d.confidence}`);
  });
  console.log('parseStats:', JSON.stringify(result.parseStats));
  console.log('PASS');
} catch (e) {
  console.error('FAIL:', (e as Error).message);
}
