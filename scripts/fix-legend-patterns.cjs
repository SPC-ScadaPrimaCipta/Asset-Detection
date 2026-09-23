require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

// PEP legend ID
const LEGEND_ID = 'a15198ed-f27e-47f6-9ffc-6393b1b16c8e';

// Common instrument tag patterns missing from PEP legend
// These allow rule-validator Step 2 (Legend) to match instead of falling to ISO
const MISSING_PATTERNS = [
  // Instruments - PDT prefix (Pressure Differential Transmitter)
  { asset_type: 'Instrument', symbol_name: 'Pressure Differential Transmitter', tag_pattern: 'PDT-###', aliases: ['PDT', 'Differential Pressure Transmitter'] },
  { asset_type: 'Instrument', symbol_name: 'Pressure Indicator',                tag_pattern: 'PI-###',  aliases: ['PI'] },
  { asset_type: 'Instrument', symbol_name: 'Pressure Safety Valve',             tag_pattern: 'PSV-###', aliases: ['PSV', 'Safety Valve'] },
  { asset_type: 'Instrument', symbol_name: 'Level Gauge',                       tag_pattern: 'LG-###',  aliases: ['LG', 'Level Glass'] },
  { asset_type: 'Instrument', symbol_name: 'Local Control Panel',               tag_pattern: 'LCP',     aliases: ['LCP'] },
  { asset_type: 'Instrument', symbol_name: 'Junction Box',                      tag_pattern: 'JB-##',   aliases: ['JB'] },
  { asset_type: 'Instrument', symbol_name: 'Multi-Channel Fire Alarm',          tag_pattern: 'MCFA',    aliases: ['MCFA'] },
  // Equipment
  { asset_type: 'Pump',       symbol_name: 'Pump',                             tag_pattern: 'P-###',   aliases: ['P'] },
  { asset_type: 'Vessel',     symbol_name: 'Vessel',                           tag_pattern: 'V-###',   aliases: ['V'] },
  { asset_type: 'Tank',       symbol_name: 'Tank',                             tag_pattern: 'T-###',   aliases: ['T'] },
  { asset_type: 'Heat Exchanger', symbol_name: 'Heat Exchanger',               tag_pattern: 'E-###',   aliases: ['E', 'HX'] },
  { asset_type: 'Fired Heater',   symbol_name: 'Fired Heater',                 tag_pattern: 'H-###',   aliases: ['H'] },
  { asset_type: 'Vessel',     symbol_name: 'Drum / Separator',                 tag_pattern: 'D-###',   aliases: ['D'] },
  { asset_type: 'Compressor', symbol_name: 'Compressor',                       tag_pattern: 'K-###',   aliases: ['K', 'C'] },
];

async function main() {
  // Get existing symbols to avoid duplicates
  const existing = await p.query('SELECT symbol_name, tag_pattern FROM legend_symbols WHERE legend_id=$1', [LEGEND_ID]);
  const existingNames = new Set(existing.rows.map(r => r.symbol_name?.toLowerCase()));
  const existingPatterns = new Set(existing.rows.map(r => r.tag_pattern?.toLowerCase()).filter(Boolean));

  let added = 0;
  let skipped = 0;

  for (const sym of MISSING_PATTERNS) {
    // Skip if already exists by pattern or name
    if (existingPatterns.has(sym.tag_pattern?.toLowerCase()) ||
        existingNames.has(sym.symbol_name?.toLowerCase())) {
      console.log(`SKIP (exists): ${sym.symbol_name} [${sym.tag_pattern}]`);
      skipped++;
      continue;
    }

    const id = uuidv4();
    await p.query(
      `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')`,
      [id, LEGEND_ID, sym.asset_type, sym.symbol_name, sym.tag_pattern,
       `${sym.symbol_name} — tag pattern: ${sym.tag_pattern}`, sym.aliases]
    );
    console.log(`ADDED: ${sym.symbol_name} [${sym.tag_pattern}] → ${sym.asset_type}`);
    added++;
  }

  console.log(`\nDone: ${added} added, ${skipped} skipped.`);
  console.log('Re-run detection to apply new tag patterns.');
  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
