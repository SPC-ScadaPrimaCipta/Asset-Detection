const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const fs = require('fs');
const path = require('path');

(async () => {
  // Get DXF document
  const docs = await pool.query("SELECT id, filename, file_path FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 5");
  console.log('All DXF docs:', docs.rows.map(r => r.filename));
  // Pick largest filename (INTAN_GS)
  const doc = docs.rows.find(r => r.filename.includes('INTAN')) || docs.rows[0];
  if (!doc) { console.log('No DXF doc found'); process.exit(0); }
  console.log('Document:', doc.filename);

  // Read file - storage path is relative to project root
  const storagePath = path.resolve('storage', path.basename(doc.file_path));
  const altPath = path.resolve(doc.file_path);
  const filePath = fs.existsSync(altPath) ? altPath : storagePath;
  console.log('Reading from:', filePath);
  const buf = fs.readFileSync(filePath);

  // Use dxf-parser
  const DxfParserModule = require('dxf-parser');
  const DxfParser = typeof DxfParserModule === 'function' ? DxfParserModule : DxfParserModule.default;
  const parser = new DxfParser();
  const dxf = parser.parseSync(buf.toString('utf-8').replace(/^\uFEFF/, ''));

  const entities = dxf.entities || [];
  const blocks = dxf.blocks || {};

  // Count entity types
  const typeCounts = {};
  for (const e of entities) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }
  console.log('\nEntity type counts:', typeCounts);

  // Sample INSERTs
  const inserts = entities.filter(e => e.type === 'INSERT');
  console.log('\nTotal INSERTs:', inserts.length);
  console.log('\nSample INSERT block names (first 30):');
  const sample = inserts.slice(0, 30);
  for (const ins of sample) {
    const attribs = ins.attribs || [];
    const attrStr = attribs.map(a => `${a.tag}=${a.value}`).join(', ');
    console.log(`  block="${ins.name || ins.block}" layer="${ins.layer}" attribs=[${attrStr}]`);
  }

  // Block names list
  const blockNames = Object.keys(blocks);
  console.log('\nTotal block definitions:', blockNames.length);
  console.log('Block names sample:', blockNames.slice(0, 30));

  // Sample TEXT/MTEXT
  const texts = entities.filter(e => e.type === 'TEXT' || e.type === 'MTEXT');
  console.log('\nTotal TEXT/MTEXT:', texts.length);
  console.log('Sample texts (first 20):');
  for (const t of texts.slice(0, 20)) {
    console.log(`  type=${t.type} text="${(t.text || t.string || '').slice(0, 80)}" layer="${t.layer}"`);
  }

  // Check ATTRIB counts
  let totalWithAttrib = 0;
  let totalAttribs = 0;
  for (const ins of inserts) {
    if (ins.attribs && ins.attribs.length > 0) {
      totalWithAttrib++;
      totalAttribs += ins.attribs.length;
    }
  }
  console.log(`\nINSERTs with ATTRIBs: ${totalWithAttrib}/${inserts.length}, total attribs: ${totalAttribs}`);

  // Sample ATTRIBs
  const withAttrib = inserts.filter(e => e.attribs && e.attribs.length > 0).slice(0, 10);
  for (const ins of withAttrib) {
    console.log(`  block="${ins.name}" attribs:`, JSON.stringify(ins.attribs));
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
