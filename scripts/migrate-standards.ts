/**
 * Run migrate-builtin-standards.sql via Node.js pg client.
 * Usage: tsx --env-file=.env.local scripts/migrate-standards.ts
 */
import { pool } from '@/lib/db';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function run() {
  const raw = readFileSync(resolve(process.cwd(), 'sql/migrate-builtin-standards.sql'), 'utf-8');

  // Remove single-line comments first, then split by semicolons
  const noComments = raw
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = noComments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 5); // skip whitespace-only remnants

  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      console.log(`[migrate] ${stmt.slice(0, 100).replace(/\s+/g, ' ')}…`);
      await client.query(stmt);
    }
    console.log('[migrate] Done. All statements executed.');
  } catch (err) {
    console.error('[migrate] Error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
