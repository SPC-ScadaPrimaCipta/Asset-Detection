const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const doc = (await pool.query(
    "SELECT id FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 1"
  )).rows[0];
  if (!doc) { console.log('No DXF doc'); await pool.end(); return; }

  const job = (await pool.query(
    'SELECT id, status FROM detection_jobs WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1',
    [doc.id]
  )).rows[0];
  if (!job) { console.log('No job found'); await pool.end(); return; }

  console.log('Job', job.id, 'current status:', job.status);
  await pool.query(
    "UPDATE detection_jobs SET status='PENDING', progress_pct=0, error_detail=NULL, started_at=NULL, completed_at=NULL WHERE id=$1",
    [job.id]
  );
  console.log('Reset to PENDING. Now run: npm run worker');
  console.log('Job ID:', job.id);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
