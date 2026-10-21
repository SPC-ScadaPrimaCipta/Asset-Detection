const { Pool } = require('pg');
const db = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });

async function main() {
  // Sample of UNKNOWN detections with their evidence
  const r1 = await db.query(
    "SELECT asset_tag, asset_type, confidence, evidence FROM detections WHERE asset_type='UNKNOWN' AND detection_status != 'REJECTED' ORDER BY created_at DESC LIMIT 15"
  );
  console.log('=== UNKNOWN detections (latest 15) ===');
  for (const row of r1.rows) {
    const ev = Array.isArray(row.evidence) ? row.evidence.slice(0,3) : row.evidence;
    console.log(JSON.stringify({ tag: row.asset_tag, conf: row.confidence, evidence: ev }));
  }

  // Count by source/reason
  const r2 = await db.query(
    "SELECT detection_source, COUNT(*)::int as cnt FROM detections WHERE asset_type='UNKNOWN' AND detection_status != 'REJECTED' GROUP BY detection_source ORDER BY cnt DESC"
  );
  console.log('\n=== UNKNOWN count by detection_source ===');
  console.log(JSON.stringify(r2.rows, null, 2));

  // What tag prefixes are UNKNOWN
  const r3 = await db.query(
    "SELECT SPLIT_PART(asset_tag, '-', 1) as prefix, COUNT(*)::int as cnt FROM detections WHERE asset_type='UNKNOWN' AND asset_tag IS NOT NULL AND detection_status != 'REJECTED' GROUP BY prefix ORDER BY cnt DESC LIMIT 20"
  );
  console.log('\n=== UNKNOWN prefixes ===');
  console.log(JSON.stringify(r3.rows, null, 2));

  await db.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
