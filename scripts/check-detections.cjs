require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check documents and page count
  const docs = await p.query('SELECT id, filename, page_count FROM documents ORDER BY created_at DESC LIMIT 3');
  console.log('=== DOCUMENTS ===');
  docs.rows.forEach(d => console.log(d.id, d.filename, 'pages:', d.page_count));

  // Check document_pages
  const docId = docs.rows[0]?.id;
  if (docId) {
    const pages = await p.query('SELECT page_number, width, height FROM document_pages WHERE document_id=$1 ORDER BY page_number', [docId]);
    console.log('\n=== DOCUMENT_PAGES for', docs.rows[0].filename, '===');
    pages.rows.forEach(pg => console.log('page', pg.page_number, pg.width, 'x', pg.height));
  }

  // Check latest job
  const job = await p.query('SELECT id, status, legend_id, document_id FROM detection_jobs ORDER BY created_at DESC LIMIT 1');
  console.log('\n=== LATEST JOB ===');
  console.log(job.rows[0]);

  const jobId = job.rows[0]?.id;
  if (jobId) {
    // Check detections
    const dets = await p.query(
      'SELECT asset_tag, asset_type, confidence, bbox_x, bbox_y, bbox_w, bbox_h, pid_page FROM detections WHERE job_id=$1 ORDER BY pid_page, confidence DESC',
      [jobId]
    );
    console.log('\n=== DETECTIONS ===', dets.rows.length, 'total');
    dets.rows.forEach(d => console.log(
      `page=${d.pid_page} tag=${d.asset_tag||'NULL'} type=${d.asset_type} conf=${d.confidence} bbox=${d.bbox_x},${d.bbox_y} ${d.bbox_w}x${d.bbox_h}`
    ));

    // Check agent run input
    const ar = await p.query('SELECT input_metadata, output_metadata, error FROM agent_runs WHERE job_id=$1', [jobId]);
    console.log('\n=== AGENT RUN ===');
    ar.rows.forEach(r => console.log(JSON.stringify(r)));
  }

  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
