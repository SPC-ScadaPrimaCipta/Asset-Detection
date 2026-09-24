const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const p = new Pool({ connectionString: env.DATABASE_URL });
(async () => {
  const r = await p.query(`SELECT id, filename, file_path, page_count FROM documents WHERE id='d52fe2e6-d106-47ba-b51f-08d39ac73d36'`);
  console.log('ROW:', JSON.stringify(r.rows, null, 1));
  const fp = r.rows[0]?.file_path;
  const sp = env.STORAGE_PATH || './storage';
  const absBase = path.isAbsolute(sp) ? sp : path.join(process.cwd(), sp);
  console.log('STORAGE_BASE:', absBase);
  console.log('EXISTS(storage/file_path):', fs.existsSync(path.join(absBase, fp)));
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
