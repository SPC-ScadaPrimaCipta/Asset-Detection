const { Pool } = require('pg');
const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const p = new Pool({ connectionString: env.DATABASE_URL });
p.query(
  `SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS cols
   FROM information_schema.columns
   WHERE table_name IN ('legends','documents','detection_jobs','legend_symbols')
   GROUP BY table_name ORDER BY table_name`
).then((r) => console.log(JSON.stringify(r.rows, null, 1))).finally(() => p.end());
