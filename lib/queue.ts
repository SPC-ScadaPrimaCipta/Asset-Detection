/**
 * BullMQ singleton queue.
 *
 * Problem solved: the old detection jobs route created a new IORedis connection
 * on every POST request, then disconnected it. Wasteful + race-prone.
 *
 * This module exports a single Queue instance backed by a persistent IORedis
 * connection. Node.js module caching ensures it is created once per process.
 *
 * Worker process has its own connection — do NOT share this queue's connection
 * with the Worker to avoid BullMQ listener conflicts.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Lazy singleton — created on first import, not at module parse time.
// This avoids errors during Next.js build/SSR when Redis is unavailable.
let _connection: IORedis | null = null;
let _queue: Queue | null = null;

function getConnection(): IORedis {
  if (!_connection) {
    _connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    _connection.on('error', (err) => {
      // Non-fatal — jobs stay PENDING and are recovered by worker on restart
      console.warn('[queue] Redis connection error:', err.message);
    });
  }
  return _connection;
}

export function getDetectionQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('detection', { connection: getConnection() });
  }
  return _queue;
}

/**
 * Enqueue a detection job. Non-throwing — if Redis is unavailable the job
 * row stays PENDING and is recovered by the worker on next startup.
 */
export async function enqueueDetectionJob(
  jobId: string,
  legendId: string | null
): Promise<boolean> {
  try {
    const q = getDetectionQueue();
    await q.add(
      'detection',
      { jobId, legendId },
      { jobId, removeOnComplete: true, removeOnFail: 100 }
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[queue] enqueue failed for job ${jobId}: ${msg.slice(0, 200)}`);
    return false;
  }
}
