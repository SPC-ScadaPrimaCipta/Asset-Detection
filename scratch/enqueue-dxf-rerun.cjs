const { Queue } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const queue = new Queue('detection', { connection });

(async () => {
  const doc = (await pool.query(
    "SELECT id FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 1"
  )).rows[0];
  if (!doc) { console.log('No DXF doc'); process.exit(0); }

  const job = (await pool.query(
    "SELECT id, legend_id, legend_ids FROM detection_jobs WHERE document_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 1",
    [doc.id]
  )).rows[0];
  if (!job) { console.log('No PENDING job'); process.exit(0); }

  console.log('Enqueueing job:', job.id);
  await queue.add('detect', {
    jobId: job.id,
    legendId: job.legend_id,
    legendIds: job.legend_ids,
  });
  console.log('Done. Worker will pick it up.');
  await pool.end();
  await connection.quit();
})().catch(e => { console.error(e.message); process.exit(1); });
