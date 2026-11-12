/**
 * Seed default users untuk testing & development.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-users.ts
 */

import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

async function seedUsers() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Default users — superadmin + admin + user
    const users = [
      {
        email: 'superadmin@example.com',
        password: 'superadmin123',
        name: 'Super Admin',
        role: 'SUPERADMIN',
      },
      {
        email: 'admin@example.com',
        password: 'admin123',
        name: 'Admin',
        role: 'ADMIN',
      },
      {
        email: 'user@example.com',
        password: 'user123',
        name: 'User',
        role: 'USER',
      },
    ];

    for (const user of users) {
      // Check if already exists
      const existing = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
      );

      if (existing.rows.length > 0) {
        console.log(`  [seed] User ${user.email} sudah ada, skip`);
        continue;
      }

      const passwordHash = await hashPassword(user.password);
      await client.query(
        `INSERT INTO users (email, password_hash, name, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [user.email, passwordHash, user.name, user.role]
      );

      console.log(`  [seed] Created user: ${user.email} (password: ${user.password})`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Seeding users selesai');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed-users] error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedUsers();
