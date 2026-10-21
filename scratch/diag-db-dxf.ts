import 'dotenv/config';
import pool from '../lib/db';

(async () => {
  try {
    const r = await pool.query('select count(*)::int c from documents');
    console.log('DB OK docs=', r.rows[0].c);
    const d = await pool.query(
      "select id, filename, project_id, created_at from documents where file_type='dxf' order by created_at desc limit 5",
    );
    console.table(d.rows);
  } catch (e) {
    console.log('DB FAIL', (e as Error).message);
  }
  process.exit(0);
})();
