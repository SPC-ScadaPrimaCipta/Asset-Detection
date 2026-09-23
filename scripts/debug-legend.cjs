require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // PEP legend
  const r = await p.query(
    "SELECT asset_type, symbol_name, tag_pattern, aliases FROM legend_symbols WHERE legend_id = 'a15198ed-f27e-47f6-9ffc-6393b1b16c8e'"
  );
  console.log('=== PEP symbols (' + r.rows.length + ' total) ===');
  r.rows.forEach(row => console.log(JSON.stringify(row)));

  // Check detection results — what detection_source is being returned
  const r2 = await p.query(
    "SELECT asset_type, asset_tag, detection_source, confidence, legend_id FROM detections WHERE legend_id = 'a15198ed-f27e-47f6-9ffc-6393b1b16c8e' ORDER BY created_at DESC LIMIT 20"
  );
  console.log('\n=== Recent detections using PEP legend ===');
  r2.rows.forEach(row => console.log(JSON.stringify(row)));

  // Any detections at all?
  const r3 = await p.query(
    "SELECT detection_source, COUNT(*) as cnt FROM detections GROUP BY detection_source"
  );
  console.log('\n=== All detections by source ===');
  r3.rows.forEach(row => console.log(JSON.stringify(row)));

  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
