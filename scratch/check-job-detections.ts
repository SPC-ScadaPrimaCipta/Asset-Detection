import { pool } from '../lib/db';

async function main() {
  const res = await pool.query(`
    SELECT id, asset_tag, asset_type, confidence, detection_source, validation_status, evidence
    FROM detections
    WHERE job_id = '46f0c5e5-eff1-4ad6-8051-d88e6a211f13'
    LIMIT 20
  `);
  console.log('Total detections:', res.rowCount);
  for (const r of res.rows) {
    console.log(`[${r.detection_source}] ${r.asset_tag ?? '(no tag)'} | ${r.asset_type} | conf: ${r.confidence} | status: ${r.validation_status}`);
    console.log('   evidence:', r.evidence);
  }
  await pool.end();
}

main().catch(console.error);
