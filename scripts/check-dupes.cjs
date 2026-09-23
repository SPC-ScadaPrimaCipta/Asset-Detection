require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const dupes = await p.query("SELECT asset_tag, COUNT(id) as cnt FROM detections WHERE asset_tag IS NOT NULL GROUP BY asset_tag HAVING COUNT(id) > 1");
  console.log('Duplicate tags:', dupes.rows.length);
  dupes.rows.forEach(r => console.log(JSON.stringify(r)));

  const detail = await p.query("SELECT id, asset_tag, validation_status, evidence FROM detections WHERE asset_tag IN ('PI-PDT-12', 'LCP', 'H-OXX')");
  console.log('\nDuplicate detail:');
  detail.rows.forEach(r => {
    const ev = Array.isArray(r.evidence) ? r.evidence : [];
    const hasEntityRes = ev.some(e => String(e).includes('CANONICAL') || String(e).includes('DUPLICATE'));
    console.log(JSON.stringify({ id: r.id.slice(0,8), tag: r.asset_tag, vstatus: r.validation_status, entityResolved: hasEntityRes, ev_count: ev.length }));
  });
  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
