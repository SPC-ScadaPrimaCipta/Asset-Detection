import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../lib/db';

function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PRJ-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function run() {
  console.log('[migrate-auth] Starting auth & visibility migration...');
  const sqlPath = path.join(__dirname, '..', 'sql', 'migrate-auth-and-visibility.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Run schema migration
    console.log('[migrate-auth] Executing SQL schema changes...');
    await client.query(sql);

    // 2. Insert or get Default Admin
    const adminEmail = 'admin@assetdetection.local';
    const adminCheck = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    let adminId: string;

    if (adminCheck.rows.length === 0) {
      console.log('[migrate-auth] Creating default Admin user...');
      const adminPassHash = hashPasswordSync('admin123');
      const ins = await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'ADMIN')
         RETURNING id`,
        ['Admin / System', adminEmail, adminPassHash]
      );
      adminId = ins.rows[0].id;
      console.log(`[migrate-auth] Admin user created with ID: ${adminId}`);
    } else {
      adminId = adminCheck.rows[0].id;
      console.log(`[migrate-auth] Admin user already exists with ID: ${adminId}`);
    }

    // 3. Update existing projects that have no owner
    const existingProjects = await client.query('SELECT id, share_code FROM projects WHERE owner_id IS NULL');
    console.log(`[migrate-auth] Found ${existingProjects.rows.length} existing projects without owner.`);
    for (const p of existingProjects.rows) {
      const shareCode = p.share_code || generateShareCode();
      await client.query(
        `UPDATE projects
         SET owner_id = $1, visibility = 'PUBLIC', share_code = COALESCE(share_code, $2)
         WHERE id = $3`,
        [adminId, shareCode, p.id]
      );
    }

    // 4. Update existing legends that have no owner
    const existingLegends = await client.query('SELECT id FROM legends WHERE owner_id IS NULL');
    console.log(`[migrate-auth] Found ${existingLegends.rows.length} existing legends without owner.`);
    for (const l of existingLegends.rows) {
      await client.query(
        `UPDATE legends
         SET owner_id = $1, visibility = 'PUBLIC'
         WHERE id = $2`,
        [adminId, l.id]
      );
    }

    await client.query('COMMIT');
    console.log('[migrate-auth] Migration and seeding completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-auth] Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
