const { Pool } = require('pg');
const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const p = new Pool({ connectionString: env.DATABASE_URL });
(async () => {
  const jobs = await p.query(
    `SELECT id, status, progress_pct, created_at FROM detection_jobs WHERE document_id='6d4390d9-a8d5-41ed-8268-6f1e32d5229a' ORDER BY created_at DESC LIMIT 4`
  );
  console.log('JOBS:', JSON.stringify(jobs.rows, null, 1));
  const latest = jobs.rows[0]?.id;
  if (latest) {
    const cnt = await p.query(`SELECT count(*) FROM detections WHERE job_id=$1`, [latest]);
    console.log('COUNT latest:', cnt.rows[0].count);
    const top = await p.query(
      `SELECT asset_tag, asset_type, confidence, detection_source, validation_status, LEFT(evidence::text, 300) AS ev FROM detections WHERE job_id=$1 ORDER BY confidence DESC LIMIT 8`,
      [latest]
    );
    console.log('TOP:', JSON.stringify(top.rows, null, 1));
    const dist = await p.query(
      `SELECT asset_type, count(*) FROM detections WHERE job_id=$1 GROUP BY asset_type ORDER BY 2 DESC LIMIT 8`,
      [latest]
    );
    console.log('BY_TYPE:', JSON.stringify(dist.rows));
  }
  const tp = await p.query(
    `SELECT count(*), count(tag_pattern) FROM legend_symbols WHERE legend_id='74cc1ce2-c322-406e-a4fc-6f5aa3526c56'`
  );
  console.log('LEGEND_SYMBOLS:', JSON.stringify(tp.rows));
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
