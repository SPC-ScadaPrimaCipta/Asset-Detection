import { pool } from '@/lib/db';

async function main() {
  const r = await pool.query("SELECT name, default_version FROM pg_available_extensions WHERE name='vector'");
  console.log('pgvector available:', JSON.stringify(r.rows));
  const r2 = await pool.query("SELECT extname FROM pg_extension WHERE extname='vector'");
  console.log('pgvector installed:', JSON.stringify(r2.rows));
  await pool.end();
}
main();
