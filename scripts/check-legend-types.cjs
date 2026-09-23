const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const r = await pool.query(`
    SELECT symbol_name, asset_type, tag_pattern 
    FROM legend_symbols 
    WHERE legend_id='a15198ed-f27e-47f6-9ffc-6393b1b16c8e' 
      AND (
        LOWER(symbol_name) LIKE '%pump%' OR LOWER(asset_type) LIKE '%pump%' OR
        LOWER(symbol_name) LIKE '%compressor%' OR LOWER(asset_type) LIKE '%compressor%' OR
        LOWER(symbol_name) LIKE '%valve%' OR LOWER(asset_type) LIKE '%valve%' OR
        LOWER(symbol_name) LIKE '%motor%' OR LOWER(asset_type) LIKE '%motor%'
      )
    ORDER BY asset_type, symbol_name
  `);
  console.log('Pump/Compressor/Valve in legend:', r.rows.length);
  r.rows.forEach(s => console.log(' -', s.symbol_name, '|', s.asset_type, '| tag:', s.tag_pattern));
  
  console.log('\nAll asset_types in legend:');
  const types = await pool.query(`
    SELECT DISTINCT asset_type, COUNT(id) cnt 
    FROM legend_symbols 
    WHERE legend_id='a15198ed-f27e-47f6-9ffc-6393b1b16c8e' 
    GROUP BY asset_type ORDER BY cnt DESC
  `);
  types.rows.forEach(t => console.log(' ', t.cnt + 'x', t.asset_type));
  
  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
