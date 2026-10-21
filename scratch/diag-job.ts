import 'dotenv/config';
import pool from '../lib/db';

(async () => {
  const doc = (await pool.query(
    "SELECT id, filename FROM documents WHERE file_type='dxf' ORDER BY created_at DESC LIMIT 1",
  )).rows[0];
  const job = (await pool.query(
    'SELECT id, status, progress_pct, error_detail, started_at, completed_at, legend_id, legend_ids FROM detection_jobs WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1',
    [doc.id],
  )).rows[0];
  console.log('doc', doc.filename);
  console.log('job', job);
  const dets = await pool.query('SELECT count(*)::int c FROM detections WHERE job_id=$1', [job.id]);
  console.log('detections', dets.rows[0].c);
  const pages = await pool.query('SELECT id, page_number FROM document_pages WHERE document_id=$1 ORDER BY page_number', [doc.id]);
  console.log('pages', pages.rowCount, pages.rows.slice(0, 5));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
