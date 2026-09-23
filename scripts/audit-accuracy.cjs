require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const all = await p.query(`
    SELECT asset_tag, asset_type, confidence, detection_source, validation_status,
           bbox_x, bbox_y, bbox_w, bbox_h, pid_page, evidence
    FROM detections ORDER BY pid_page, bbox_y, bbox_x
  `);

  const rows = all.rows;
  console.log(`Total: ${rows.length} detections\n`);

  // ── 1. TAG FORMAT ISSUES ──
  console.log('=== TAG ISSUES ===');
  const issues = [];

  for (const r of rows) {
    const tag = r.asset_tag;
    if (!tag) { issues.push({ tag: 'NULL', type: r.asset_type, issue: 'No tag', page: r.pid_page }); continue; }

    // Contains OCR noise (O instead of 0)
    if (/[A-Z]-[A-Z]+[A-Z]/.test(tag) && /OXX|OOO|XXX/.test(tag))
      issues.push({ tag, type: r.asset_type, issue: 'OCR noise (O/X placeholder)', page: r.pid_page });

    // Has spaces remaining
    if (tag.includes(' '))
      issues.push({ tag, type: r.asset_type, issue: 'Spaces in tag', page: r.pid_page });

    // Tag looks like compound (PSV-PDT-11) — may be misread
    if ((tag.match(/-/g) || []).length > 1)
      issues.push({ tag, type: r.asset_type, issue: 'Compound tag — verify', page: r.pid_page });
  }
  issues.forEach(i => console.log(JSON.stringify(i)));
  if (!issues.length) console.log('None found.');

  // ── 2. TYPE MISMATCH (tag prefix vs type) ──
  console.log('\n=== TAG-TYPE MISMATCH ===');
  const PREFIX_TYPE_MAP = {
    'PDT': ['Pressure', 'Instrument', 'Transmitter'],
    'PI':  ['Pressure', 'Instrument', 'Indicator'],
    'PSV': ['Valve', 'Pressure', 'Safety'],
    'LCP': ['Instrument', 'Panel', 'Control'],
    'JB':  ['Instrument', 'Junction'],
    'MCFA':['Instrument', 'Panel'],
    'LG':  ['Instrument', 'Level', 'Gauge'],
    'P':   ['Pump'],
    'V':   ['Vessel', 'Tank'],
    'E':   ['Heat Exchanger', 'Exchanger'],
    'T':   ['Tank', 'Vessel'],
    'H':   ['Heater', 'Fired', 'Heat'],
    'D':   ['Drum', 'Vessel', 'Tank', 'Separator'],
    'K':   ['Compressor', 'Fan'],
  };
  const mismatches = [];
  for (const r of rows) {
    if (!r.asset_tag) continue;
    const prefix = r.asset_tag.split('-')[0];
    const expected = PREFIX_TYPE_MAP[prefix];
    if (!expected) continue;
    const typeStr = r.asset_type.toLowerCase();
    const match = expected.some(e => typeStr.includes(e.toLowerCase()));
    if (!match) {
      mismatches.push({ tag: r.asset_tag, detected_type: r.asset_type, expected_contains: expected, source: r.detection_source, page: r.pid_page });
    }
  }
  mismatches.forEach(m => console.log(JSON.stringify(m)));
  if (!mismatches.length) console.log('None found.');

  // ── 3. BBOX SANITY ──
  console.log('\n=== BBOX ISSUES ===');
  const bboxIssues = [];
  for (const r of rows) {
    if (r.bbox_w == null || r.bbox_h == null) {
      bboxIssues.push({ tag: r.asset_tag, issue: 'NULL bbox', page: r.pid_page });
    } else if (r.bbox_w < 5 || r.bbox_h < 5) {
      bboxIssues.push({ tag: r.asset_tag, issue: `Too small: ${r.bbox_w}x${r.bbox_h}`, page: r.pid_page });
    } else if (r.bbox_w > 500 || r.bbox_h > 500) {
      bboxIssues.push({ tag: r.asset_tag, issue: `Too large: ${r.bbox_w}x${r.bbox_h}`, page: r.pid_page });
    }
  }
  bboxIssues.forEach(b => console.log(JSON.stringify(b)));
  if (!bboxIssues.length) console.log('None found.');

  // ── 4. CONFIDENCE DISTRIBUTION ──
  console.log('\n=== CONFIDENCE DISTRIBUTION ===');
  const high   = rows.filter(r => r.confidence >= 0.95).length;
  const medium = rows.filter(r => r.confidence >= 0.80 && r.confidence < 0.95).length;
  const low    = rows.filter(r => r.confidence >= 0.65 && r.confidence < 0.80).length;
  const vlow   = rows.filter(r => r.confidence < 0.65).length;
  console.log(`High   (>=0.95): ${high}`);
  console.log(`Medium (0.80-0.94): ${medium}`);
  console.log(`Low    (0.65-0.79): ${low}`);
  console.log(`Review (<0.65):  ${vlow}`);

  // ── 5. DUPLICATES ──
  console.log('\n=== DUPLICATE TAGS ===');
  const tagCount = {};
  for (const r of rows) {
    if (!r.asset_tag) continue;
    tagCount[r.asset_tag] = (tagCount[r.asset_tag] || 0) + 1;
  }
  const dupes = Object.entries(tagCount).filter(([,c]) => c > 1);
  dupes.forEach(([tag, cnt]) => console.log(`  ${tag}: ${cnt}x`));
  if (!dupes.length) console.log('None found.');

  // ── 6. DETECTION SOURCE ──
  console.log('\n=== DETECTION SOURCE BREAKDOWN ===');
  const srcCount = {};
  for (const r of rows) {
    srcCount[r.detection_source] = (srcCount[r.detection_source] || 0) + 1;
  }
  Object.entries(srcCount).sort((a,b) => b[1]-a[1]).forEach(([src, cnt]) => {
    const pct = Math.round(cnt/rows.length*100);
    console.log(`  ${src}: ${cnt} (${pct}%)`);
  });

  // ── 7. PER PAGE SUMMARY ──
  console.log('\n=== PER PAGE ===');
  const byPage = {};
  for (const r of rows) {
    const pg = r.pid_page || '?';
    byPage[pg] = (byPage[pg] || 0) + 1;
  }
  Object.entries(byPage).forEach(([pg, cnt]) => console.log(`  Page ${pg}: ${cnt} detections`));

  // ── 8. VALIDATION STATUS ──
  console.log('\n=== VALIDATION STATUS ===');
  const vstCount = {};
  for (const r of rows) {
    vstCount[r.validation_status] = (vstCount[r.validation_status] || 0) + 1;
  }
  Object.entries(vstCount).forEach(([vs, cnt]) => console.log(`  ${vs}: ${cnt}`));

  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
