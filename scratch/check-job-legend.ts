import { pool } from '../lib/db';

async function main() {
  const res = await pool.query(`
    SELECT id, document_id, legend_id, legend_ids, status, created_at
    FROM detection_jobs
    WHERE id = '46f0c5e5-eff1-4ad6-8051-d88e6a211f13'
  `);
  console.log('Job:', res.rows[0]);
  
  if (res.rows[0]?.legend_id) {
    const syms = await pool.query('SELECT count(*) FROM legend_symbols WHERE legend_id = $1', [res.rows[0].legend_id]);
    console.log('Symbols for legend_id:', syms.rows[0]);
  }
  await pool.end();
}

main().catch(console.error);
