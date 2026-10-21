import 'dotenv/config';
import pool from '../lib/db';

(async () => {
  const q = await pool.query(
    `SELECT status, quality_status, count(*)::int c
       FROM legend_symbols
      GROUP BY status, quality_status
      ORDER BY status, quality_status`,
  );
  console.table(q.rows);
  const risky = await pool.query(
    `SELECT count(*)::int c
       FROM legend_symbols
      WHERE status='ACTIVE' AND quality_status='rejected'`,
  );
  console.log('ACTIVE + rejected rows (would leak into unfiltered queries):', risky.rows[0].c);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
