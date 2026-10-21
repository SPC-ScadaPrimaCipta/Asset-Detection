// simulate-after-fix.cjs — simulate detection after fixes applied
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const doc = (await pool.query(
    "SELECT id,filename,file_path FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 1"
  )).rows[0];
  if (!doc) { console.log('No DXF doc'); await pool.end(); return; }
  console.log('Doc:', doc.filename);

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

  function stripMtext(s) {
    s = s.replace(/\\\\([A-Za-z~Ppn])/g, '\\$1');
    while (s.startsWith('{') && s.endsWith('}')) { s = s.slice(1, -1); }
    s = s.replace(/\\P/gi, ' ').replace(/\\n/gi, ' ');
    s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    s = s.replace(/\\[A-Za-z][^;\\{}]*;?/g, '');
    s = s.replace(/\\~/g, ' ').replace(/\\./g, '').replace(/[{}]/g, '');
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  // Compute extents
  const allPts = [];
  for (const e of entities) {
    if (e.type === 'LINE' && e.start && e.end) { allPts.push(e.start, e.end); }
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) {
      for (const v of e.vertices) { if (v && typeof v.x === 'number') allPts.push(v); }
    } else {
      const p = e.position || e.startPoint || e.insertionPoint;
      if (p && typeof p.x === 'number') allPts.push(p);
    }
  }
  const xs = allPts.map(p => p.x).sort((a, b) => a - b);
  const ys = allPts.map(p => p.y).sort((a, b) => a - b);
  const medX = xs[Math.floor(xs.length / 2)];
  const medY = ys[Math.floor(ys.length / 2)];
  const dxs = allPts.map(p => Math.abs(p.x - medX)).sort((a, b) => a - b);
  const dys = allPts.map(p => Math.abs(p.y - medY)).sort((a, b) => a - b);
  const madX = dxs[Math.floor(dxs.length / 2)] || 1;
  const madY = dys[Math.floor(dys.length / 2)] || 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of allPts) {
    if (Math.abs(p.x - medX) <= 15 * madX && Math.abs(p.y - medY) <= 15 * madY) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
  }
  const extents = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  const drawingSize = Math.max(extents.width, extents.height);

  // Title strip — TOP ONLY 6%
  const TITLE_STRIP = 0.06;
  const stripTop = extents.height * TITLE_STRIP;

  function shortLayer(layer) {
    const idx = layer.indexOf('$0$');
    return idx >= 0 ? layer.slice(idx + 3).trim() : layer.trim();
  }
  function heuristicCategory(layer) {
    const sl = shortLayer(layer).toLowerCase();
    // NEW: Construction/Markup/Revision suffix → ignore
    if (/\(construction\)|\(constr\)|\(markup\)|\(revision\)|\(rev\)|\(redline\)$/i.test(sl)) return 'ignore';
    if (/_construction$|_constr$|_markup$|_revision$|_rev$|_redline$/i.test(sl)) return 'ignore';
    if (/^cloud|revision cloud|^revision$/i.test(sl)) return 'ignore';
    if (/^title|border|frame|sheet/i.test(sl)) return 'title';
    if (/^blank$|^spacer$/i.test(sl)) return 'ignore';
    if (/^level\s*6$/i.test(sl)) return 'tag';
    if (/^level\s*4$/i.test(sl)) return 'tag';
    if (/^level\s*40$/i.test(sl)) return 'tag';
    const levelMatch = sl.match(/^level\s*(\d+)$/);
    if (levelMatch) {
      const n = parseInt(levelMatch[1]);
      if (n >= 4 && n <= 8) return 'tag';
      if (n === 40 || n === 80) return 'tag';
      return 'description';
    }
    return 'unknown';
  }

  const FALLBACK_TAG_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2}$/i;
  const LOOSE_TAG_RE = /^[A-Z]{1,4}-[A-Z0-9]{1,6}-[A-Z0-9]{1,6}$/i;
  const THREE_PART_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[-_][A-Z0-9]{1,4}$/i;
  const PIPE_SPEC_RE = /^[\d]+["'\/][-x×]?[\d]*["'#\s]|#\d*$|^\d+"-\d+#$/i;
  const STATUS_RE = /^(RUN|STOP|R-ST|XI|M|I|B|N\/A|TBD)$/i;

  function isTag(text) {
    const t = text.trim();
    if (!t || t.length < 3 || t.length > 28) return false;
    if (PIPE_SPEC_RE.test(t)) return false;
    if (STATUS_RE.test(t)) return false;
    if (/^\d/.test(t)) return false;
    if (!/^[A-Z]/i.test(t)) return false;
    return FALLBACK_TAG_RE.test(t) || LOOSE_TAG_RE.test(t) || THREE_PART_RE.test(t);
  }

  function isInTitleStrip(pos) {
    const fromTop = extents.maxY - pos.y;
    return fromTop < stripTop;  // top-only
  }

  // BEFORE fix
  const beforeFix = texts.filter(t => {
    const cat = heuristicCategoryOld(t.layer || '0');
    return cat === 'tag' && isTag(stripMtext(t.text || t.string || ''));
  });
  function heuristicCategoryOld(layer) {
    const sl = shortLayer(layer).toLowerCase();
    if (/^cloud|revision cloud|^revision$/i.test(sl)) return 'ignore';
    if (/^blank$|^spacer$/i.test(sl)) return 'ignore';
    if (/^level\s*6$/i.test(sl)) return 'tag';
    if (/^level\s*4$/i.test(sl)) return 'tag';
    if (/^level\s*40$/i.test(sl)) return 'tag';
    const levelMatch = sl.match(/^level\s*(\d+)$/);
    if (levelMatch) {
      const n = parseInt(levelMatch[1]);
      if (n >= 4 && n <= 8) return 'tag';
      if (n === 40 || n === 80) return 'tag';
      return 'description';
    }
    return 'unknown';
  }

  // AFTER fix
  const afterFix = texts.filter(t => {
    const pos = t.position || t.startPoint || t.insertionPoint || {};
    if (!pos || typeof pos.x !== 'number') return false;
    const cat = heuristicCategory(t.layer || '0');
    return cat === 'tag' && isTag(stripMtext(t.text || t.string || '')) && !isInTitleStrip(pos);
  });

  console.log('\n=== TAG COUNT COMPARISON ===');
  console.log('BEFORE fix (all tag-layer texts):', beforeFix.length);
  console.log('AFTER fix (no construction, no title strip):', afterFix.length);

  // Show what was removed
  const removed = beforeFix.filter(t => !afterFix.includes(t));
  console.log('\nRemoved by fixes:', removed.length);
  const removedByLayer = {};
  for (const t of removed) {
    const sl = shortLayer(t.layer || '0');
    removedByLayer[sl] = (removedByLayer[sl] || []);
    removedByLayer[sl].push(stripMtext(t.text || t.string || ''));
  }
  for (const [l, tags] of Object.entries(removedByLayer)) {
    console.log('  Layer "' + l + '": removed ' + tags.length + ' tags → ' + [...new Set(tags)].slice(0,5).join(', '));
  }

  // Show what remains — unique tags
  const uniqueAfter = [...new Set(afterFix.map(t => stripMtext(t.text || t.string || '')))].sort();
  console.log('\nUnique tags after fix (' + uniqueAfter.length + '):', uniqueAfter.join(', '));

  // Positions of remaining tags
  console.log('\nAll remaining detections (unique tag + position):');
  const seen = new Set();
  let cnt = 0;
  for (const t of afterFix) {
    const pos = t.position || t.startPoint || t.insertionPoint || { x: 0, y: 0 };
    const tag = stripMtext(t.text || t.string || '');
    const nx = Math.round(((pos.x - extents.minX) / extents.width) * 1000);
    const ny = Math.round(((extents.maxY - pos.y) / extents.height) * 1000);
    const sl = shortLayer(t.layer || '0');
    const key = tag + '@' + nx + ',' + ny;
    if (!seen.has(key)) { seen.add(key); cnt++; console.log('  #' + cnt + ' "' + tag + '" norm=(' + nx + ',' + ny + ') layer="' + sl + '"'); }
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
