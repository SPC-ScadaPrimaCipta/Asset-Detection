// Load .env.local first
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('Fixing regex tag patterns...');
    
    // 1. Control Valve: ^(CV|FCV|...) → CV-###
    const r1 = await client.query(`
      UPDATE legend_symbols
      SET tag_pattern = 'CV-###'
      WHERE tag_pattern LIKE '^(CV%'
        AND asset_type = 'Control Valve'
      RETURNING id, symbol_name
    `);
    console.log(`✓ Fixed ${r1.rowCount} Control Valve patterns`);
    
    // 2. Filter: ^(FI|FT|...) → FI-###
    const r2 = await client.query(`
      UPDATE legend_symbols
      SET tag_pattern = 'FI-###'
      WHERE tag_pattern LIKE '^(FI%'
        AND asset_type = 'Filter'
      RETURNING id, symbol_name
    `);
    console.log(`✓ Fixed ${r2.rowCount} Filter patterns`);
    
    // 3. Instrument: too many variants → NULL (let detection use alias matching)
    const r3 = await client.query(`
      UPDATE legend_symbols
      SET tag_pattern = NULL
      WHERE tag_pattern ~ '\\^\\('
        AND asset_type = 'Instrument'
      RETURNING id, symbol_name
    `);
    console.log(`✓ Cleared ${r3.rowCount} Instrument regex patterns`);
    
    // 4. Generic cleanup: any remaining regex syntax → NULL
    const r4 = await client.query(`
      UPDATE legend_symbols
      SET tag_pattern = NULL
      WHERE tag_pattern ~ '[\\^\\$\\(\\)\\|\\\\\\[\\]]'
        AND tag_pattern IS NOT NULL
      RETURNING id, symbol_name, asset_type, tag_pattern
    `);
    console.log(`✓ Cleared ${r4.rowCount} other regex patterns`);
    
    await client.query('COMMIT');
    console.log('\n✅ All patterns fixed successfully');
    
    // Show summary
    const summary = await client.query(`
      SELECT asset_type, COUNT(*) as total,
        COUNT(tag_pattern) as with_pattern
      FROM legend_symbols
      WHERE status = 'ACTIVE'
      GROUP BY asset_type
      ORDER BY asset_type
    `);
    console.log('\nLegend summary after fix:');
    console.table(summary.rows);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Fix failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
