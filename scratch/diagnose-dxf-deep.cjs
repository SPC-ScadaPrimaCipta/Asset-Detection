const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const fs = require('fs');
const path = require('path');

(async () => {
  const docs = await pool.query("SELECT id, filename, file_path FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 5");
  const doc = docs.rows.find(r => r.filename.includes('INTAN')) || docs.rows[0];
  console.log('Document:', doc.filename);

  const storagePath = path.resolve('storage', path.basename(doc.file_path));
  const altPath = path.resolve(doc.file_path);
  const filePath = fs.existsSync(altPath) ? altPath : storagePath;
  const buf = fs.readFileSync(filePath);

  const DxfParserModule = require('dxf-parser');
  const DxfParser = typeof DxfParserModule === 'function' ? DxfParserModule : DxfParserModule.default;
  const parser = new DxfParser();
  const dxf = parser.parseSync(buf.toString('utf-8').replace(/^\uFEFF/, ''));

  const entities = dxf.entities || [];
  const texts = entities.filter(e => e.type === 'TEXT' || e.type === 'MTEXT');
  const inserts = entities.filter(e => e.type === 'INSERT');

  // ── 1. Layer breakdown for TEXT entities ────────────────────────────────
  const layerTexts = {};
  for (const t of texts) {
    const layer = t.layer || '0';
    // Strip XREF prefix (everything before $0$)
    const shortLayer = layer.includes('$0$') ? layer.split('$0$').pop() : layer;
    if (!layerTexts[shortLayer]) layerTexts[shortLayer] = [];
    layerTexts[shortLayer].push((t.text || t.string || '').slice(0, 60));
  }

  console.log('\n=== TEXT layers and samples ===');
  const sorted = Object.entries(layerTexts).sort((a, b) => b[1].length - a[1].length);
  for (const [layer, txts] of sorted.slice(0, 30)) {
    console.log(`\n  Layer "${layer}" (${txts.length} texts):`);
    for (const t of txts.slice(0, 5)) {
      console.log(`    "${t}"`);
    }
  }

  // ── 2. Tag-like texts per layer ──────────────────────────────────────────
  const TAG_RE = /^[A-Z]{1,5}[-][0-9]{3,5}[A-Z]?$/i;
  console.log('\n=== Tag-like texts per layer ===');
  for (const [layer, txts] of sorted) {
    const tags = txts.filter(t => TAG_RE.test(t.trim()));
    if (tags.length > 0) {
      console.log(`  Layer "${layer}": ${tags.slice(0, 10).join(', ')}`);
    }
  }

  // ── 3. INSERT block name suffixes (after XREF prefix) ───────────────────
  console.log('\n=== INSERT block name suffixes ===');
  const suffixes = inserts.map(e => {
    const bn = e.name || e.block || '';
    return bn.includes('$0$') ? bn.split('$0$').pop() : bn;
  });
  const suffixCounts = {};
  for (const s of suffixes) suffixCounts[s] = (suffixCounts[s]||0)+1;
  const topSuffixes = Object.entries(suffixCounts).sort((a,b)=>b[1]-a[1]).slice(0,30);
  for (const [s, c] of topSuffixes) {
    console.log(`  "${s}" × ${c}`);
  }

  // ── 4. Spatial proximity: find TEXT near each INSERT ─────────────────────
  console.log('\n=== Sample spatial: 5 INSERTs → nearest texts ===');
  const sampleInserts = inserts.slice(0, 5);
  for (const ins of sampleInserts) {
    const pos = ins.position || { x: 0, y: 0 };
    const suffix = (ins.name||ins.block||'').split('$0$').pop();
    // Find 5 nearest texts
    const withDist = texts.map(t => {
      const tp = t.position || t.insertionPoint || { x: 0, y: 0 };
      const d = Math.hypot(tp.x - pos.x, tp.y - pos.y);
      const raw = (t.text||t.string||'').slice(0,40);
      const layer = (t.layer||'').includes('$0$') ? (t.layer||'').split('$0$').pop() : (t.layer||'');
      return { d, raw, layer };
    }).sort((a,b)=>a.d-b.d).slice(0,5);
    console.log(`\n  INSERT "${suffix}" @(${Math.round(pos.x)},${Math.round(pos.y)}):`);
    for (const {d,raw,layer} of withDist) {
      console.log(`    dist=${Math.round(d)} layer="${layer}" text="${raw}"`);
    }
  }

  // ── 5. Look for P&ID standard tag pairs (tag + description close together) ─
  console.log('\n=== Tag-like texts with nearby description texts ===');
  const tagTexts = texts.filter(t => TAG_RE.test((t.text||t.string||'').trim()));
  console.log(`Total tag-like TEXT entities: ${tagTexts.length}`);
  for (const tag of tagTexts.slice(0, 15)) {
    const tagPos = tag.position || tag.insertionPoint || {x:0,y:0};
    const tagVal = (tag.text||tag.string||'').trim();
    const tagLayer = (tag.layer||'').includes('$0$') ? (tag.layer||'').split('$0$').pop() : (tag.layer||'');
    // Find nearest non-tag text within 2x proximity
    const nearby = texts
      .filter(t => t !== tag && !TAG_RE.test((t.text||t.string||'').trim()))
      .map(t => {
        const tp = t.position || t.insertionPoint || {x:0,y:0};
        const d = Math.hypot(tp.x - tagPos.x, tp.y - tagPos.y);
        const raw = (t.text||t.string||'').slice(0,40);
        const layer = (t.layer||'').includes('$0$') ? (t.layer||'').split('$0$').pop() : (t.layer||'');
        return {d, raw, layer};
      })
      .sort((a,b)=>a.d-b.d)
      .slice(0,3);
    console.log(`\n  Tag "${tagVal}" layer="${tagLayer}":`);
    for (const {d,raw,layer} of nearby) {
      console.log(`    dist=${Math.round(d)} layer="${layer}" desc="${raw}"`);
    }
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
