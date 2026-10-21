// diagnose-dxf-accuracy.cjs — root cause analysis for low accuracy DXF detection
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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

  // ── Clean texts (strip MTEXT formatting) ─────────────────────────────────
  function stripMtext(s) {
    s = s.replace(/\\\\([A-Za-z~Ppn])/g, '\\$1');
    while (s.startsWith('{') && s.endsWith('}')) { s = s.slice(1, -1); }
    s = s.replace(/\\P/gi, ' ').replace(/\\n/gi, ' ');
    s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    s = s.replace(/\\[A-Za-z][^;\\{}]*;?/g, '');
    s = s.replace(/\\~/g, ' ').replace(/\\./g, '').replace(/[{}]/g, '');
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  // ── Compute extents (same logic as dxf-parser.ts) ─────────────────────────
  const inserts = entities.filter(e => e.type === 'INSERT');
  const allPts = [];
  for (const e of entities) {
    if (e.type === 'LINE' && e.start && e.end) { allPts.push(e.start, e.end); }
    else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      for (const v of (e.vertices || [])) { if (v && typeof v.x === 'number') allPts.push(v); }
    } else if (e.type === 'INSERT' || e.type === 'TEXT' || e.type === 'MTEXT') {
      const p = e.position || e.startPoint || e.insertionPoint;
      if (p && typeof p.x === 'number') allPts.push(p);
    } else if (e.type === 'CIRCLE' && e.center) {
      allPts.push(
        { x: e.center.x - e.radius, y: e.center.y },
        { x: e.center.x + e.radius, y: e.center.y },
      );
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
  console.log('\n=== EXTENTS ===');
  console.log('  minX=' + Math.round(minX) + ' minY=' + Math.round(minY));
  console.log('  maxX=' + Math.round(maxX) + ' maxY=' + Math.round(maxY));
  console.log('  width=' + Math.round(extents.width) + ' height=' + Math.round(extents.height));
  console.log('  drawingSize=' + Math.round(drawingSize));

  // ── Tag extraction ─────────────────────────────────────────────────────────
  const FALLBACK_TAG_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2}$/i;
  const LOOSE_TAG_RE = /^[A-Z]{1,4}-[A-Z0-9]{1,6}-[A-Z0-9]{1,6}$/i;
  const THREE_PART_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[-_][A-Z0-9]{1,4}$/i;
  const PIPE_SPEC_RE = /^[\d]+["'\/][-x×]?[\d]*["'#\s]|^[\d]+"[-x×][\d]+"$|#\d*$|^\d+"-\d+#$/i;
  const STATUS_RE = /^(RUN|STOP|R-ST|XI|M|I|B|N\/A|TBD)$/i;

  function shortLayer(layer) {
    const idx = layer.indexOf('$0$');
    return idx >= 0 ? layer.slice(idx + 3).trim() : layer.trim();
  }
  function heuristicCategory(layer) {
    const sl = shortLayer(layer).toLowerCase();
    if (/^cloud|revision cloud|^revision$/i.test(sl)) return 'ignore';
    if (/^title|border|frame|sheet|^north|^scale/i.test(sl)) return 'title';
    if (/^blank$|^spacer$/i.test(sl)) return 'ignore';
    if (/^level\s*6$/i.test(sl)) return 'tag';
    if (/^level\s*4$/i.test(sl)) return 'tag';
    if (/^level\s*40$/i.test(sl)) return 'tag';
    if (/^equip.*tag|^p.*tag|^tag\b/i.test(sl)) return 'tag';
    if (/^level\s*5$/i.test(sl)) return 'equipment';
    if (/^level\s*3$/i.test(sl)) return 'equipment';
    const levelMatch = sl.match(/^level\s*(\d+)$/);
    if (levelMatch) {
      const n = parseInt(levelMatch[1]);
      if (n >= 4 && n <= 8) return 'tag';
      if (n === 40 || n === 80) return 'tag';
      return 'description';
    }
    return 'unknown';
  }

  function isTag(text) {
    const t = text.trim();
    if (!t || t.length < 3 || t.length > 28) return false;
    if (PIPE_SPEC_RE.test(t)) return false;
    if (STATUS_RE.test(t)) return false;
    if (/^\d/.test(t)) return false;
    if (!/^[A-Z]/i.test(t)) return false;
    return FALLBACK_TAG_RE.test(t) || LOOSE_TAG_RE.test(t) || THREE_PART_RE.test(t);
  }

  // ── All valid tags per layer ────────────────────────────────────────────────
  console.log('\n=== ALL VALID TAG TEXTS (after strip+filter) ===');
  const tagRows = [];
  for (const t of texts) {
    const raw = t.text || t.string || '';
    const clean = stripMtext(raw);
    const pos = t.position || t.startPoint || t.insertionPoint || { x: 0, y: 0 };
    const sl = shortLayer(t.layer || '0');
    const cat = heuristicCategory(t.layer || '0');
    if (isTag(clean)) {
      tagRows.push({ clean, sl, cat, x: pos.x, y: pos.y, raw: raw.slice(0, 50) });
    }
  }
  console.log('Total valid tags found:', tagRows.length);
  for (const r of tagRows) {
    const norm_x = Math.round(((r.x - minX) / extents.width) * 1000);
    const norm_y = Math.round(((maxY - r.y) / extents.height) * 1000);
    console.log('  "' + r.clean + '" layer="' + r.sl + '" cat=' + r.cat + ' norm=(' + norm_x + ',' + norm_y + ')');
  }

  // ── Dedup simulation ────────────────────────────────────────────────────────
  console.log('\n=== DEDUP SIMULATION (what survives dedup) ===');
  const gridCell = Math.max(1, drawingSize * 0.003);
  console.log('gridCell=', Math.round(gridCell));
  const seenKey = new Map();
  const dedupedTags = [];
  const priorityMap = { 'Level 6': 1, 'Level 4': 2, 'Level 40': 3, 'Level 40(Construction)': 10 };
  for (const r of tagRows) {
    const prio = priorityMap[r.sl] || 5;
    const gx = Math.round(r.x / gridCell);
    const gy = Math.round(r.y / gridCell);
    const key = r.clean.toLowerCase() + '|' + gx + '|' + gy;
    const existing = seenKey.get(key);
    if (!existing) {
      seenKey.set(key, { row: r, prio });
      dedupedTags.push(r);
    } else if (prio < existing.prio) {
      const idx = dedupedTags.indexOf(existing.row);
      if (idx >= 0) dedupedTags[idx] = r;
      seenKey.set(key, { row: r, prio });
    }
  }
  console.log('After dedup:', dedupedTags.length, '(from', tagRows.length, ')');
  const tagCounts = {};
  for (const r of dedupedTags) tagCounts[r.clean] = (tagCounts[r.clean] || 0) + 1;
  const dups = Object.entries(tagCounts).filter(([, n]) => n > 1);
  if (dups.length > 0) {
    console.log('Still duplicated after dedup:', dups.map(([t, n]) => t + ' x' + n).join(', '));
  } else {
    console.log('No duplicates after dedup — dedup works correctly.');
  }

  // ── Root cause: why duplicates appear in DB ────────────────────────────────
  console.log('\n=== ROOT CAUSE ANALYSIS: Why "V-0601" appears 8x in DB ===');
  const v0601 = tagRows.filter(r => r.clean === 'V-0601');
  console.log('V-0601 occurrences in DXF text entities:', v0601.length);
  for (const r of v0601) {
    console.log('  layer="' + r.sl + '" cat=' + r.cat + ' x=' + Math.round(r.x) + ' y=' + Math.round(r.y));
  }

  // Check unique positions
  const uniquePos = new Set(v0601.map(r => Math.round(r.x / 100) + ',' + Math.round(r.y / 100)));
  console.log('Unique positions (100-unit grid):', uniquePos.size);

  // gridCell dedup check
  const gridKeys = v0601.map(r => {
    const gx = Math.round(r.x / gridCell);
    const gy = Math.round(r.y / gridCell);
    return 'v-0601|' + gx + '|' + gy;
  });
  const uniqueKeys = new Set(gridKeys);
  console.log('Unique gridCell keys:', uniqueKeys.size, '(gridCell=' + Math.round(gridCell) + ')');
  console.log('Keys:', [...uniqueKeys]);

  // ── Construction layer problem ─────────────────────────────────────────────
  console.log('\n=== CONSTRUCTION LAYER PROBLEM ===');
  const consTags = tagRows.filter(r => r.sl.toLowerCase().includes('construction'));
  console.log('Tags from Construction layers:', consTags.length);
  for (const r of consTags.slice(0, 10)) {
    console.log('  "' + r.clean + '" layer="' + r.sl + '"');
  }

  // ── Layer 4 vs Layer 6: same tag different layer → different position? ─────
  console.log('\n=== Layer 4 vs Layer 6 same tag positions ===');
  const l6tags = tagRows.filter(r => r.sl === 'Level 6');
  const l4tags = tagRows.filter(r => r.sl === 'Level 4');
  for (const t6 of l6tags) {
    const matching = l4tags.filter(t4 => t4.clean === t6.clean);
    for (const t4 of matching) {
      const dist = Math.hypot(t6.x - t4.x, t6.y - t4.y);
      console.log('  "' + t6.clean + '" L6@(' + Math.round(t6.x) + ',' + Math.round(t6.y) + ') L4@(' + Math.round(t4.x) + ',' + Math.round(t4.y) + ') dist=' + Math.round(dist));
    }
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
