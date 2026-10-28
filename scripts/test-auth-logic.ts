import assert from 'node:assert';
import { hashPassword, verifyPassword, createSessionToken, verifySessionToken } from '../lib/auth';

async function test() {
  console.log('[test-auth] Running auth unit checks...');

  // 1. Password hashing & verification
  const pass = 'superPassword123!';
  const hash = await hashPassword(pass);
  assert(hash.includes(':'), 'Hash must contain salt:key delimiter');

  const valid = await verifyPassword(pass, hash);
  assert.strictEqual(valid, true, 'Correct password must verify');

  const invalid = await verifyPassword('wrongPassword', hash);
  assert.strictEqual(invalid, false, 'Incorrect password must fail');

  // 2. Token generation & verification
  const userId = '112fbfe6-c300-4643-86e2-3e2b231a11ae';
  const token = createSessionToken(userId);
  assert(token.includes('.'), 'Token must contain payload.sig');

  const verifiedUserId = verifySessionToken(token);
  assert.strictEqual(verifiedUserId, userId, 'Verified userId must match');

  const tampered = token.slice(0, -3) + 'abc';
  assert.strictEqual(verifySessionToken(tampered), null, 'Tampered token must fail');

  console.log('[test-auth] All auth logic checks passed!');
}

test().catch((err) => {
  console.error('[test-auth] Failed:', err);
  process.exit(1);
});
