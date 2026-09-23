import db, { pool } from '@/lib/db';

async function main() {
  const legendId = '9c97d2d3-c39d-423b-9f0d-e429ff041d2b';
  const symbolId = '60f7492d-84aa-4aab-a8fc-301ee58dc3c9';
  const l = await db.query('SELECT id, name, status FROM legends WHERE id=$1', [legendId]);
  console.log('LEGEND:', JSON.stringify(l.rows));
  const s = await db.query('SELECT id, legend_id, asset_type, status FROM legend_symbols WHERE id=$1', [symbolId]);
  console.log('SYMBOL:', JSON.stringify(s.rows));
  const c = await db.query('SELECT COUNT(*) AS n FROM legend_symbols WHERE legend_id=$1', [legendId]);
  console.log('SYMBOLS_IN_LEGEND:', JSON.stringify(c.rows));
  await pool.end();
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
