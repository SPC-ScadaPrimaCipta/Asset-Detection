import { pool } from '../lib/db';

async function main() {
  const res = await pool.query(`
    SELECT status, count(*) 
    FROM legend_symbols 
    WHERE legend_id = 'cbfe43d9-8823-4708-9bd5-c9cad05776f1' 
    GROUP BY status
  `);
  console.log('Symbols by status:', res.rows);
  await pool.end();
}

main().catch(console.error);
