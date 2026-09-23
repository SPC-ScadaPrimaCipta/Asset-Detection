require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const IORedis = require('ioredis');
const { Queue } = require('bullmq');

const p = new Pool({ connectionString: process.env.DATABASE_URL });
const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const q = new Queue('detection', { connection: conn });

async function main() {
  // Get document and legend
  const doc = await p.query("SELECT id, filename FROM documents ORDER BY created_at DESC LIMIT 1");
  const legend = await p.query("SELECT id, name FROM legends WHERE id='a15198ed-f27e-47f6-9ffc-6393b1b16c8e'");

  const docId = doc.rows[0].id;
  const legendId = legend.rows[0].id;
  console.log('Document:', doc.rows[0].filename);
  console.log('Legend:', legend.rows[0].name);

  // Delete old PENDING/DETECTED detections to get fresh results
  const del = await p.query("DELETE FROM detections WHERE review_status='PENDING' AND detection_status='DETECTED'");
  console.log('Cleared old pending detections:', del.rowCount);

  // Create new job
  const jobId = uuidv4();
  await p.query(
    "INSERT INTO detection_jobs (id, document_id, legend_id, status, progress_pct) VALUES ($1,$2,$3,'PENDING',0)",
    [jobId, docId, legendId]
  );
  await q.add('detection', { jobId, legendId }, { jobId, removeOnComplete: true, removeOnFail: 100 });
  console.log('Job created:', jobId);
  console.log('Waiting for worker to process...');

  await p.end();
  await conn.quit();
}
main().catch(e => { console.error(e.message); process.exit(1); });
