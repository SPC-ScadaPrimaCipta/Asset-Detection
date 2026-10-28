import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isSuperAdmin, hashPassword, UserRole } from '@/lib/auth';
import { pool } from '@/lib/db';

const VALID_ROLES: UserRole[] = ['SUPERADMIN', 'ADMIN', 'USER'];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser(req);
    if (!isSuperAdmin(user)) {
      return NextResponse.json(
        { error: 'Akses ditolak. Hanya Super Administrator yang memiliki izin.' },
        { status: 403 }
      );
    }

    const { id: targetId } = await params;
    const body = await req.json();

    // Check if target user exists
    const existing = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [targetId]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 });
    }
    const currentTarget = existing.rows[0];

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    // Name update
    if (typeof body.name === 'string' && body.name.trim().length >= 2) {
      updates.push(`name = $${idx++}`);
      values.push(body.name.trim());
    }

    // Email update
    if (typeof body.email === 'string') {
      const email = body.email.trim().toLowerCase();
      if (!email.includes('@') || !email.includes('.')) {
        return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
      }
      if (email !== currentTarget.email) {
        const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, targetId]);
        if (emailCheck.rows.length > 0) {
          return NextResponse.json({ error: 'Email sudah digunakan oleh akun lain' }, { status: 409 });
        }
        updates.push(`email = $${idx++}`);
        values.push(email);
      }
    }

    // Role update
    if (body.role && VALID_ROLES.includes(body.role)) {
      const newRole: UserRole = body.role;
      if (currentTarget.role === 'SUPERADMIN' && newRole !== 'SUPERADMIN') {
        // Guard against removing the last superadmin
        const superCountRes = await pool.query("SELECT COUNT(*)::int FROM users WHERE role = 'SUPERADMIN'");
        if (superCountRes.rows[0].count <= 1) {
          return NextResponse.json(
            { error: 'Tidak dapat mengubah role satu-satunya Super Administrator di sistem' },
            { status: 400 }
          );
        }
      }
      updates.push(`role = $${idx++}`);
      values.push(newRole);
    }

    // Optional password reset
    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: 'Password baru minimal 6 karakter' }, { status: 400 });
      }
      const newHash = await hashPassword(body.password);
      updates.push(`password_hash = $${idx++}`);
      values.push(newHash);
    }

    if (updates.length === 0) {
      return NextResponse.json({ user: currentTarget });
    }

    updates.push(`updated_at = NOW()`);
    values.push(targetId);

    const updateQuery = `
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${idx} 
      RETURNING id, name, email, role, updated_at
    `;

    const res = await pool.query(updateQuery, values);
    return NextResponse.json({ user: res.rows[0] });
  } catch (err: any) {
    console.error('[api/admin/users PUT] error:', err);
    return NextResponse.json({ error: err.message || 'Gagal memperbarui data pengguna' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser(req);
    if (!isSuperAdmin(user)) {
      return NextResponse.json(
        { error: 'Akses ditolak. Hanya Super Administrator yang memiliki izin.' },
        { status: 403 }
      );
    }

    const { id: targetId } = await params;

    // Guard 1: Cannot delete self
    if (user.id === targetId) {
      return NextResponse.json(
        { error: 'Anda tidak dapat menghapus akun Anda sendiri' },
        { status: 400 }
      );
    }

    // Check target exists
    const targetRes = await pool.query('SELECT id, role, email FROM users WHERE id = $1', [targetId]);
    if (targetRes.rows.length === 0) {
      return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 });
    }

    const targetUser = targetRes.rows[0];

    // Guard 2: Cannot delete the last superadmin
    if (targetUser.role === 'SUPERADMIN') {
      const superCountRes = await pool.query("SELECT COUNT(*)::int FROM users WHERE role = 'SUPERADMIN'");
      if (superCountRes.rows[0].count <= 1) {
        return NextResponse.json(
          { error: 'Tidak dapat menghapus satu-satunya Super Administrator di sistem' },
          { status: 400 }
        );
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
    return NextResponse.json({ success: true, message: `Akun ${targetUser.email} berhasil dihapus` });
  } catch (err: any) {
    console.error('[api/admin/users DELETE] error:', err);
    return NextResponse.json({ error: err.message || 'Gagal menghapus pengguna' }, { status: 500 });
  }
}
