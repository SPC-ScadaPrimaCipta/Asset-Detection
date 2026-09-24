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
  const r = await p.query(
    `SELECT l.name, count(s.id) AS n,
            count(s.reference_image_url) AS with_crop,
            count(s.tag_pattern) AS with_tag
     FROM legends l LEFT JOIN legend_symbols s ON s.legend_id = l.id
     GROUP BY l.name ORDER BY 2 DESC`
  );
  console.log(JSON.stringify(r.rows, null, 1));
  const s = await p.query(
    `SELECT asset_type, symbol_name, tag_pattern, status, reference_image_url
     FROM legend_symbols WHERE legend_id='74cc1ce2-c322-406e-a4fc-6f5aa3526c56' LIMIT 5`
  );
  console.log('PEP symbols:', JSON.stringify(s.rows));
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
