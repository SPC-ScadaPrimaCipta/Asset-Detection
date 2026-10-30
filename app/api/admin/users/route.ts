import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isSuperAdmin, hashPassword, UserRole } from '@/lib/auth';
import { pool } from '@/lib/db';

const VALID_ROLES: UserRole[] = ['SUPERADMIN', 'ADMIN', 'USER'];

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!isSuperAdmin(user)) {
      return NextResponse.json(
        { error: 'Akses ditolak. Hanya Super Administrator yang memiliki izin.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const role = (searchParams.get('role') || '').trim().toUpperCase();

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.created_at, u.updated_at,
              (SELECT COUNT(*)::int FROM projects p WHERE p.owner_id = u.id) AS projects_count
       FROM users u
       WHERE ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
         AND ($2 = '' OR u.role = $2)
       ORDER BY u.created_at DESC`,
      [q, role]
    );

    return NextResponse.json({ users: result.rows });
  } catch (err: any) {
    console.error('[api/admin/users GET] error:', err);
    return NextResponse.json({ error: err.message || 'Gagal memuat daftar pengguna' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!isSuperAdmin(user)) {
      return NextResponse.json(
        { error: 'Akses ditolak. Hanya Super Administrator yang memiliki izin.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role: UserRole = VALID_ROLES.includes(body.role) ? body.role : 'USER';

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'Nama pengguna minimal 2 karakter' }, { status: 400 });
    }
    if (!email || !email.includes('@') || !email.includes('.')) {
      return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 });
    }

    // Check email uniqueness
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: 'Email sudah digunakan oleh akun lain' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash, role]
    );

    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error('[api/admin/users POST] error:', err);
    return NextResponse.json({ error: err.message || 'Gagal membuat pengguna' }, { status: 500 });
  }
}
