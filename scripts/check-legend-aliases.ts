import pool from '@/lib/db';

async function main() {
  try {
    const res = await pool.query(`
      SELECT symbol_name, asset_type, aliases
      FROM legend_symbols
      WHERE 
        symbol_name ILIKE '%psh%' 
        OR symbol_name ILIKE '%pi%'
        OR 'PSH' = ANY(aliases)
        OR 'PI' = ANY(aliases)
      LIMIT 20
    `);
    console.log('Found symbols:');
    console.table(res.rows);
  } catch (err) {
    console.error('DB error:', err);
  } finally {
    await pool.end();
  }
}

main();
