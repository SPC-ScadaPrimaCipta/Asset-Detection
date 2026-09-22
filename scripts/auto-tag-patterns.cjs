/**
 * Auto-populate tag patterns in legend symbols from OCR evidence in detections.
 *
 * Logic:
 * 1. Extract all confirmed/detected asset tags from detections for the given legend
 * 2. Cluster by prefix (e.g. "PDT", "H", "PSV", "JB")
 * 3. For each prefix, find the matching legend symbol by asset_type similarity
 * 4. Update tag_pattern to "PREFIX-###" if not already set
 *
 * Usage: node scripts/auto-tag-patterns.cjs [legendId]
 * If no legendId, processes all legends with symbols missing tag_pattern.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Known prefix → asset type mappings for industrial fire water / general P&ID
const KNOWN_MAPPINGS = {
  'PDT': ['Instrument', 'Pressure Transmitter', 'Differential Pressure Transmitter'],
  'PT':  ['Instrument', 'Pressure Transmitter', 'Pressure Indicator'],
  'PI':  ['Instrument', 'Pressure Indicator'],
  'PSV': ['Valve', 'Safety Valve', 'Pressure Safety Valve'],
  'PRV': ['Valve', 'Safety Valve', 'Pressure Safety Valve'],
  'H':   ['Piping Component', 'HOSEREEL', 'Hose Reel'],
  'JB':  ['Instrument', 'Junction Box'],
  'LCP': ['Instrument', 'Panel', 'Local Control Panel'],
  'MCFA':['Instrument', 'Fire Alarm', 'FGS'],
  'FT':  ['Instrument', 'Flow Transmitter'],
  'FI':  ['Instrument', 'Flow Indicator'],
  'LT':  ['Instrument', 'Level Transmitter'],
  'LI':  ['Instrument', 'Level Indicator'],
  'TT':  ['Instrument', 'Temperature Transmitter'],
  'TI':  ['Instrument', 'Temperature Indicator'],
  'EM':  ['Instrument', 'Electric Motor', 'Motor'],
  'LG':  ['Instrument', 'Level Gauge', 'Level Indicator'],
  'LS':  ['Instrument', 'Level Switch'],
  'PS':  ['Instrument', 'Pressure Switch'],
  'XV':  ['Valve', 'On-Off Valve', 'Shutdown Valve'],
  'P':   ['Centrifugal Pump', 'Pump'],
  'V':   ['Vessel', 'Pressure Vessel'],
  'D':   ['Vessel', 'Separator', 'Drum'],
};

async function run() {
  const targetLegendId = process.argv[2] || null;

  // Get legends to process
  const legendQuery = targetLegendId
    ? await pool.query('SELECT id, name FROM legends WHERE id=$1 AND is_builtin=false', [targetLegendId])
    : await pool.query('SELECT id, name FROM legends WHERE is_builtin=false ORDER BY created_at DESC');

  if (!legendQuery.rows.length) {
    console.log('No custom legends found. Pass a legendId as argument or ensure custom legends exist.');
    pool.end(); return;
  }

  for (const legend of legendQuery.rows) {
    console.log(`\n=== Processing legend: ${legend.name} (${legend.id.slice(0,8)}) ===`);

    // Get all symbols missing tag_pattern for this legend
    const symbols = await pool.query(
      'SELECT id, asset_type, symbol_name, tag_pattern FROM legend_symbols WHERE legend_id=$1 ORDER BY asset_type',
      [legend.id]
    );
    console.log(`  ${symbols.rows.length} symbols, ${symbols.rows.filter(s => !s.tag_pattern).length} missing tag_pattern`);

    // Get tag prefixes from detections that used this legend
    const tagPrefixes = await pool.query(`
      SELECT
        REGEXP_REPLACE(asset_tag, '-.*$', '') as prefix,
        asset_type,
        COUNT(*) as cnt
      FROM detections
      WHERE legend_id = $1
        AND asset_tag IS NOT NULL
        AND asset_tag ~ '^[A-Z]{1,6}-'
      GROUP BY prefix, asset_type
      ORDER BY cnt DESC
    `, [legend.id]);

    // Also get from OCR text in all pages of docs that used this legend
    const ocrPrefixes = await pool.query(`
      SELECT DISTINCT
        REGEXP_REPLACE(matches[1], '-.*$', '') as prefix,
        COUNT(*) as cnt
      FROM (
        SELECT REGEXP_MATCHES(ocr_text_placeholder, '[A-Z]{2,6}-\d{2,4}', 'g') as matches
        FROM (
          SELECT string_agg(asset_tag, ' ') as ocr_text_placeholder
          FROM detections WHERE legend_id=$1 AND asset_tag IS NOT NULL
        ) t
      ) u
      GROUP BY prefix
      ORDER BY cnt DESC
    `, [legend.id]).catch(() => ({ rows: [] }));

    // Merge prefix sources
    const allPrefixes = new Map();
    for (const row of tagPrefixes.rows) {
      if (row.prefix && /^[A-Z]{1,6}$/.test(row.prefix)) {
        allPrefixes.set(row.prefix, (allPrefixes.get(row.prefix) || 0) + parseInt(row.cnt));
      }
    }
    // Add known mappings even if not in detections yet
    for (const prefix of Object.keys(KNOWN_MAPPINGS)) {
      if (!allPrefixes.has(prefix)) allPrefixes.set(prefix, 0);
    }

    console.log(`  Tag prefixes found: ${[...allPrefixes.keys()].join(', ')}`);

    let updated = 0;
    for (const [prefix, count] of allPrefixes.entries()) {
      const candidateTypes = KNOWN_MAPPINGS[prefix] || [];

      // Find matching symbol in this legend
      const matchingSym = symbols.rows.find(s => {
        if (s.tag_pattern) return false; // already has pattern
        const sType = (s.asset_type || '').toLowerCase();
        const sName = (s.symbol_name || '').toLowerCase();
        return candidateTypes.some(ct =>
          sType.includes(ct.toLowerCase()) ||
          sName.includes(ct.toLowerCase()) ||
          ct.toLowerCase().includes(sType) ||
          ct.toLowerCase().includes(sName)
        );
      });

      if (matchingSym) {
        const newPattern = prefix.length <= 2 ? `${prefix}-###` : `${prefix}-##`;
        await pool.query(
          'UPDATE legend_symbols SET tag_pattern=$1 WHERE id=$2',
          [newPattern, matchingSym.id]
        );
        console.log(`  ✓ ${matchingSym.asset_type} / "${matchingSym.symbol_name}" → tag_pattern: ${newPattern} (from ${count} detections)`);
        updated++;
      }
    }

    // Special case: HOSEREEL → H-###
    const hoseReel = symbols.rows.find(s =>
      !s.tag_pattern &&
      ((s.symbol_name||'').toUpperCase().includes('HOSE') ||
       (s.symbol_name||'').toUpperCase().includes('HOSEREEL'))
    );
    if (hoseReel) {
      await pool.query('UPDATE legend_symbols SET tag_pattern=$1 WHERE id=$2', ['H-###', hoseReel.id]);
      console.log(`  ✓ HOSEREEL special case → H-###`);
      updated++;
    }

    console.log(`  Updated ${updated} symbols with tag patterns`);
  }

  // Show final summary
  console.log('\n=== FINAL LEGEND SYMBOLS WITH TAG PATTERNS ===');
  const finalCheck = await pool.query(`
    SELECT ls.asset_type, ls.symbol_name, ls.tag_pattern, l.name as legend_name
    FROM legend_symbols ls
    JOIN legends l ON l.id = ls.legend_id
    WHERE ls.tag_pattern IS NOT NULL AND l.is_builtin = false
    ORDER BY l.name, ls.asset_type
  `);
  finalCheck.rows.forEach(r =>
    console.log(`  [${r.legend_name}] ${r.asset_type} / "${r.symbol_name}" → ${r.tag_pattern}`)
  );

  pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });
