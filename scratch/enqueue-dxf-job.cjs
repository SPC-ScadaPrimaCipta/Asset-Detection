const IORedis = require('ioredis');
const { Queue } = require('bullmq');
require('dotenv').config({ path: '.env.local' });

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const queue = new Queue('detection', { connection });

const jobId = 'f2211a4e-f2f4-4c46-b521-91d88409031a';

(async () => {
  await queue.add('detect', { jobId }, { removeOnComplete: 50, removeOnFail: 50 });
  console.log('queued job:', jobId);
  await queue.close();
  await connection.quit();
})().catch(e => { console.error(e); process.exit(1); });
