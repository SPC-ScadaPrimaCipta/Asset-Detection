require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Latest job
  const job = await p.query('SELECT id, status, legend_id, error_detail FROM detection_jobs ORDER BY created_at DESC LIMIT 1');
  console.log('Latest job:', JSON.stringify(job.rows[0]));

  // All detections with key fields
  const dets = await p.query(`
    SELECT asset_tag, asset_type, confidence, detection_source, validation_status,
           review_status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, evidence
    FROM detections
    ORDER BY pid_page, confidence DESC
  `);
  console.log('\nDetections (' + dets.rows.length + ' total):');
  dets.rows.forEach(r => {
    const ev = Array.isArray(r.evidence) ? r.evidence : [];
    console.log(JSON.stringify({
      tag: r.asset_tag,
      type: r.asset_type,
      conf: r.confidence?.toFixed(2),
      source: r.detection_source,
      status: r.validation_status,
      page: r.pid_page,
      bbox: r.bbox_x != null ? `${r.bbox_x},${r.bbox_y} ${r.bbox_w}x${r.bbox_h}` : 'null',
      evidence_count: ev.length,
    }));
  });

  // Stats
  const stats = await p.query(`
    SELECT
      detection_source, COUNT(*) as cnt,
      ROUND(AVG(confidence)::numeric, 3) as avg_conf,
      COUNT(CASE WHEN validation_status='VALID' THEN 1 END) as valid,
      COUNT(CASE WHEN validation_status='NEEDS_REVIEW' THEN 1 END) as needs_review,
      COUNT(CASE WHEN validation_status='CONFLICT' THEN 1 END) as conflict
    FROM detections
    GROUP BY detection_source
  `);
  console.log('\nStats by source:');
  stats.rows.forEach(r => console.log(JSON.stringify(r)));

  // Check for bbox issues
  const bboxNull = await p.query('SELECT COUNT(*) FROM detections WHERE bbox_x IS NULL OR bbox_w IS NULL OR bbox_w = 0');
  console.log('\nBbox null/zero:', bboxNull.rows[0].count);

  // Check for tag issues
  const noTag = await p.query("SELECT COUNT(*) FROM detections WHERE asset_tag IS NULL OR asset_tag = ''");
  console.log('No tag:', noTag.rows[0].count);

  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
