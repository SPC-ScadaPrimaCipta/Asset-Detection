import { pool } from '@/lib/db';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function run() {
  const raw = readFileSync(resolve(process.cwd(), 'sql/migrate-company-knowledge.sql'), 'utf-8');
  const noComments = raw.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const statements = noComments.split(';').map(s => s.trim()).filter(s => s.length > 5);

  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      console.log(`[migrate] ${stmt.slice(0, 100).replace(/\s+/g, ' ')}…`);
      await client.query(stmt);
    }
    console.log('[migrate] company_knowledge migration done.');
  } catch (err) {
    console.error('[migrate] Error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
