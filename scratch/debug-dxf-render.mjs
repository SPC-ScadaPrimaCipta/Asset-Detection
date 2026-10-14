import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DxfParser = require('dxf-parser');

const buf = readFileSync('storage/d1973331-9335-497a-a670-6457b6508fd6-INTAN_GS.dxf');
const parser = new DxfParser();
const dxf = parser.parseSync(buf.toString('utf-8'));
const blocks = dxf.blocks || {};
const blockNames = Object.keys(blocks).filter(n => !n.startsWith('*'));
const inserts = (dxf.entities||[]).filter(e => e.type === 'INSERT');

console.log('\n=== DXF ENTITY COUNTS ===');
const typeCounts = {};
(dxf.entities||[]).forEach(e => { typeCounts[e.type] = (typeCounts[e.type]||0)+1; });
console.log(typeCounts);

console.log('\n=== HEADER EXTENTS ===');
const h = dxf.header || {};
console.log('EXTMIN:', h['$EXTMIN']);
console.log('EXTMAX:', h['$EXTMAX']);
console.log('INSUNITS:', h['$INSUNITS']);
console.log('MEASUREMENT:', h['$MEASUREMENT']);

console.log('\n=== INSERT SAMPLE (first 5) ===');
inserts.slice(0,5).forEach(ins => {
  const bname = ins.name || ins.block;
  const blk = blocks[bname];
  console.log('INSERT:', JSON.stringify(bname));
  console.log('  pos:', JSON.stringify(ins.position));
  console.log('  scale:', ins.xScale, ins.yScale, '| rot:', ins.rotation);
  console.log('  block found:', !!blk, '| entities in block:', blk ? (blk.entities||[]).length : 0);
  if (blk && (blk.entities||[]).length > 0) {
    const subTypes = {};
    blk.entities.forEach(e => { subTypes[e.type]=(subTypes[e.type]||0)+1; });
    console.log('  block entity types:', subTypes);
    console.log('  first sub-entity:', JSON.stringify(blk.entities[0]).slice(0,200));
  }
});

console.log('\n=== BLOCKS SUMMARY ===');
const nonEmpty = blockNames.filter(n => (blocks[n].entities||[]).length > 0);
console.log('Total non-system blocks:', blockNames.length);
console.log('Blocks with entities:', nonEmpty.length);
console.log('Empty blocks (no entities):', blockNames.length - nonEmpty.length);

// Show block base points
console.log('\n=== SAMPLE NON-EMPTY BLOCK ===');
if (nonEmpty[0]) {
  const b = blocks[nonEmpty[0]];
  console.log('Name:', nonEmpty[0]);
  console.log('Base/position:', b.position);
  const subTypes = {};
  b.entities.forEach(e => { subTypes[e.type]=(subTypes[e.type]||0)+1; });
  console.log('Entity types:', subTypes);
  console.log('First entity:', JSON.stringify(b.entities[0]).slice(0,300));
}

// Check what % of INSERTs have matching blocks
const matched = inserts.filter(ins => {
  const bname = ins.name || ins.block;
  return blocks[bname] && (blocks[bname].entities||[]).length > 0;
});
console.log('\n=== INSERT->BLOCK MATCH ===');
console.log(`INSERTs with non-empty block: ${matched.length} / ${inserts.length}`);

// Check what the actual coordinate range of entities is
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
(dxf.entities||[]).forEach(e => {
  const pts = [];
  if (e.position) pts.push(e.position);
  if (e.start) pts.push(e.start);
  if (e.end) pts.push(e.end);
  if (e.center) pts.push(e.center);
  pts.forEach(p => {
    if (p && isFinite(p.x) && isFinite(p.y)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  });
});
console.log('\n=== COORDINATE EXTENTS FROM ENTITIES ===');
console.log(`X: ${minX.toFixed(1)} → ${maxX.toFixed(1)} (width: ${(maxX-minX).toFixed(1)})`);
console.log(`Y: ${minY.toFixed(1)} → ${maxY.toFixed(1)} (height: ${(maxY-minY).toFixed(1)})`);
console.log(`Aspect ratio: ${((maxX-minX)/(maxY-minY)).toFixed(3)}`);
