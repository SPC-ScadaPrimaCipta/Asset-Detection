import { pool } from '../lib/db';
import { hashPassword, createSessionToken } from '../lib/auth';

async function runTests() {
  console.log('[test-admin-users] Running test suite...');

  // 1. Get superadmin and regular user from DB
  const saRes = await pool.query("SELECT id, email, role FROM users WHERE role = 'SUPERADMIN' LIMIT 1");
  const userRes = await pool.query("SELECT id, email, role FROM users WHERE role = 'USER' LIMIT 1");

  if (saRes.rows.length === 0) {
    throw new Error('No SUPERADMIN found in DB');
  }
  if (userRes.rows.length === 0) {
    throw new Error('No regular USER found in DB');
  }

  const superAdmin = saRes.rows[0];
  const regularUser = userRes.rows[0];

  console.log(`[test] SuperAdmin: ${superAdmin.email}`);
  console.log(`[test] RegularUser: ${regularUser.email}`);

  // Test creating a dummy user directly and updating/deleting
  const testEmail = 'test_crud_user_' + Date.now() + '@example.com';
  const passHash = await hashPassword('password123');

  const insertRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'USER')
     RETURNING id, name, email, role`,
    ['Test Temp User', testEmail, passHash]
  );
  const createdUser = insertRes.rows[0];
  console.log(`[test] Created test user: ${createdUser.id} (${createdUser.email})`);

  // Update test user role to ADMIN
  const updateRes = await pool.query(
    `UPDATE users SET role = 'ADMIN', name = 'Test Admin User' WHERE id = $1 RETURNING id, role, name`,
    [createdUser.id]
  );
  if (updateRes.rows[0].role !== 'ADMIN' || updateRes.rows[0].name !== 'Test Admin User') {
    throw new Error('Role update failed');
  }
  console.log('[test] Updated role to ADMIN successfully');

  // Delete test user
  await pool.query('DELETE FROM users WHERE id = $1', [createdUser.id]);
  const verifyDelete = await pool.query('SELECT id FROM users WHERE id = $1', [createdUser.id]);
  if (verifyDelete.rows.length !== 0) {
    throw new Error('User delete verification failed');
  }
  console.log('[test] Deleted test user successfully');

  console.log('[test-admin-users] All API test operations passed!');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
