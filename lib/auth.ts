import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { pool } from './db';

export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export function isSuperAdmin(user?: AuthUser | null): user is AuthUser {
  return user?.role === 'SUPERADMIN';
}

export function isPrivileged(user?: AuthUser | null): user is AuthUser {
  return user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
}

export const SESSION_COOKIE_NAME = 'asset_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'asset-detection-super-secret-key-change-in-prod-2026';

/**
 * Hash password using Node.js crypto.scrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify password against stored salt:key hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [salt, key] = hash.split(':');
    if (!salt || !key) return resolve(false);

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const keyBuffer = Buffer.from(key, 'hex');
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Create a signed session token: payload.signature
 */
export function createSessionToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = Buffer.from(JSON.stringify({ userId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Verify session token and return userId if valid
 */
export function verifySessionToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;

    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!data.userId || !data.exp) return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null; // expired

    return data.userId;
  } catch {
    return null;
  }
}

/**
 * Extract token from Request or Next.js cookies()
 */
export async function getSessionTokenFromRequest(req?: Request | NextRequest): Promise<string | null> {
  if (req) {
    const cookieHeader = req.headers.get('cookie') || '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }

  try {
    const cookieStore = await cookies();
    const c = cookieStore.get(SESSION_COOKIE_NAME);
    if (c?.value) return c.value;
  } catch {}

  return null;
}

/**
 * Retrieve current logged in user from database
 */
export async function getCurrentUser(req?: Request | NextRequest): Promise<AuthUser | null> {
  const token = await getSessionTokenFromRequest(req);
  if (!token) return null;

  const userId = verifySessionToken(token);
  if (!userId) return null;

  try {
    const res = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [userId]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0] as AuthUser;
  } catch (err) {
    console.error('[auth] getCurrentUser error:', err);
    return null;
  }
}

/**
 * Cookie options for setting response header
 */
export const sessionCookieOptions = {
  name: SESSION_COOKIE_NAME,
  maxAge: SESSION_MAX_AGE_SECONDS,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * Generate a random 8-char share code: PRJ-XXXX
 */
export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PRJ-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
