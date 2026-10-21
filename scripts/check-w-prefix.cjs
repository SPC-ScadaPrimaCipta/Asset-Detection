const { Pool } = require('pg');
const db = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });

async function main() {
  // 1. Active legend symbols
  const r1 = await db.query(
    "SELECT symbol_name, asset_type, tag_pattern, aliases FROM legend_symbols WHERE status='ACTIVE' ORDER BY asset_type"
  );
  console.log('=== Active legend symbols ===');
  console.log(JSON.stringify(r1.rows, null, 2));

  // 2. Detections with tag W- or T-
  const r2 = await db.query(
    "SELECT asset_tag, asset_type, confidence, detection_source, evidence FROM detections WHERE (asset_tag ILIKE 'W-%' OR asset_tag ILIKE 'T-%') ORDER BY created_at DESC LIMIT 20"
  );
  console.log('\n=== W- and T- detections ===');
  for (const row of r2.rows) {
    console.log(JSON.stringify({ tag: row.asset_tag, type: row.asset_type, conf: row.confidence, src: row.detection_source, ev: row.evidence ? row.evidence.slice(0,2) : [] }));
  }

  // 3. What text entities exist with T-0101 or W-0102 in DB (from latest job)
  const r3 = await db.query(
    "SELECT asset_tag, asset_type, confidence, detection_source FROM detections WHERE asset_tag ILIKE 'T-0101' OR asset_tag ILIKE 'W-0102' LIMIT 10"
  );
  console.log('\n=== T-0101 and W-0102 specifically ===');
  console.log(JSON.stringify(r3.rows, null, 2));

  await db.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
