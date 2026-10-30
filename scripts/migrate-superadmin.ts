import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../lib/db';

function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function run() {
  console.log('[migrate-superadmin] Starting superadmin migration...');
  const sqlPath = path.join(__dirname, '..', 'sql', 'migrate-superadmin.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('[migrate-superadmin] Executing SQL schema changes...');
    await client.query(sql);

    const superAdminEmail = 'superadmin@assetdetection.local';
    const check = await client.query('SELECT id, role FROM users WHERE email = $1', [superAdminEmail]);

    if (check.rows.length === 0) {
      console.log('[migrate-superadmin] Creating default Superadmin user...');
      const passwordHash = hashPasswordSync('superadmin123');
      const ins = await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'SUPERADMIN')
         RETURNING id`,
        ['Super Admin', superAdminEmail, passwordHash]
      );
      console.log(`[migrate-superadmin] Superadmin created with ID: ${ins.rows[0].id}`);
    } else {
      console.log(`[migrate-superadmin] Superadmin already exists with role: ${check.rows[0].role}`);
      if (check.rows[0].role !== 'SUPERADMIN') {
        await client.query(`UPDATE users SET role = 'SUPERADMIN' WHERE id = $1`, [check.rows[0].id]);
        console.log('[migrate-superadmin] Updated user role to SUPERADMIN');
      }
    }

    await client.query('COMMIT');
    console.log('[migrate-superadmin] Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-superadmin] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
