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
  const docs = await p.query(
    `SELECT d.id, d.filename, d.page_count, d.project_id, p2.name AS project
     FROM documents d LEFT JOIN projects p2 ON p2.id = d.project_id
     ORDER BY d.created_at DESC LIMIT 5`
  );
  console.log('DOCS:', JSON.stringify(docs.rows, null, 1));
  const legs = await p.query(`SELECT id, name FROM legends ORDER BY created_at DESC LIMIT 5`);
  console.log('LEGENDS:', JSON.stringify(legs.rows, null, 1));
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
