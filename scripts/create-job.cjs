const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DOC_ID = '9ddfe31d-078c-4b74-b3ae-816a45267771';
const LEGEND_ID = 'a15198ed-f27e-47f6-9ffc-6393b1b16c8e';
const PROJECT_ID = '1662235f-349c-43be-a1dd-517e78d89382';

async function run() {
  const jobId = uuidv4();
  await pool.query(
    'INSERT INTO detection_jobs (id, document_id, legend_id, project_id, status, progress_pct) VALUES ($1,$2,$3,$4,$5,$6)',
    [jobId, DOC_ID, LEGEND_ID, PROJECT_ID, 'PENDING', 0]
  );
  console.log('new job created:', jobId);

  const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const queue = new Queue('detection', { connection: redis });
  await queue.add('detection', { jobId, legendId: LEGEND_ID }, { jobId, removeOnComplete: true, removeOnFail: 100 });
  console.log('job queued to Redis — worker will pick up shortly');
  await redis.quit();
  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
