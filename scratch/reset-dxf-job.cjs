const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const jobId = 'f2211a4e-f2f4-4c46-b521-91d88409031a';

(async () => {
  const del = await pool.query('DELETE FROM detections WHERE job_id=$1', [jobId]);
  console.log('deleted detections:', del.rowCount);
  const upd = await pool.query(
    "UPDATE detection_jobs SET status='PENDING', progress_pct=0, completed_at=NULL, error_detail=NULL WHERE id=$1",
    [jobId]
  );
  console.log('reset job:', upd.rowCount);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
