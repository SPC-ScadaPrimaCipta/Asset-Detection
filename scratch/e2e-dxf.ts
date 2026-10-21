/**
 * Scratch E2E: run the real DXF detection job through the worker and report the
 * persisted result. Mutates the dev DB for one job (worker deletes prior rows).
 *
 * Usage: npx tsx --env-file=.env.local scratch/e2e-dxf.ts
 */
import pool from '../lib/db';
import { worker, detectionQueue } from '../workers/detection-worker';

const Q = 'detection';

function iou(a: any, b: any): number {
  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.width, b.x + b.width), iy1 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

(async () => {
  const doc = (await pool.query(
    "SELECT id, filename FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 1",
  )).rows[0];
  if (!doc) throw new Error('no dxf doc');
  const job = (await pool.query(
    'SELECT id, legend_id, legend_ids FROM detection_jobs WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1',
    [doc.id],
  )).rows[0];
  if (!job) throw new Error('no job');
  console.log('doc:', doc.filename, '| job:', job.id);

  await pool.query('DELETE FROM detections WHERE job_id=$1', [job.id]);
  await pool.query(
    "UPDATE detection_jobs SET status='PENDING', progress_pct=0, error_detail=NULL, started_at=NULL, completed_at=NULL WHERE id=$1",
    [job.id],
  );

  const startedAt = Date.now();
  const done = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout 15min')), 900_000);
    worker.on('completed', (j) => {
      if (j.data?.jobId === job.id) { clearTimeout(t); resolve(); }
    });
    worker.on('failed', (j, err) => {
      if (j?.data?.jobId === job.id) { clearTimeout(t); reject(err ?? new Error('failed')); }
    });
  });

  await detectionQueue.add('detect', {
    jobId: job.id,
    legendId: job.legend_id,
    legendIds: job.legend_ids,
  });
  console.log('enqueued, waiting for worker...');

  try {
    await done;
  } finally {
    await worker.close();
    await detectionQueue.close();
  }

  const status = (await pool.query('SELECT status, error_detail FROM detection_jobs WHERE id=$1', [job.id])).rows[0];
  const rows = (await pool.query(
    'SELECT asset_tag, asset_type, confidence, bbox_x x, bbox_y y, bbox_w width, bbox_h height, pid_page FROM detections WHERE job_id=$1',
    [job.id],
  )).rows;

  const withTag = rows.filter((r) => r.asset_tag);
  const tagCounts = new Map<string, number>();
  for (const r of withTag) tagCounts.set(r.asset_tag.toUpperCase(), (tagCounts.get(r.asset_tag.toUpperCase()) ?? 0) + 1);
  let overlaps = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].pid_page !== rows[j].pid_page) continue;
      if (iou(rows[i], rows[j]) >= 0.6) overlaps++;
    }
  }

  console.log('\n=== E2E persisted result ===');
  console.log('elapsed:', ((Date.now() - startedAt) / 1000).toFixed(1), 's');
  console.log('job status:', status.status, status.error_detail ?? '');
  console.log('detections:', rows.length, '| tagged:', withTag.length, '| untagged:', rows.length - withTag.length);
  console.log('overlapping pairs (IoU>=0.6):', overlaps);
  console.log('repeated tags:', [...tagCounts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]));

  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error('E2E FAIL', e?.message ?? e);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
