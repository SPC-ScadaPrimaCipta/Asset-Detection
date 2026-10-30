import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Silakan login terlebih dahulu untuk bergabung via kode' }, { status: 401 });
    }

    const body = await request.json();
    const rawCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!rawCode) {
      return NextResponse.json({ error: 'Kode project wajib diisi' }, { status: 400 });
    }

    // Ensure format PRJ-XXXX or add prefix if missing
    const code = rawCode.startsWith('PRJ-') ? rawCode : `PRJ-${rawCode}`;

    const res = await db.query(
      `SELECT p.*, u.name AS owner_name
       FROM projects p
       LEFT JOIN users u ON p.owner_id = u.id
       WHERE UPPER(p.share_code) = $1`,
      [code]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Kode project tidak ditemukan atau tidak valid' }, { status: 404 });
    }

    const project = res.rows[0];

    // If user is already the owner, return directly
    if (project.owner_id === user.id) {
      return NextResponse.json({
        id: project.id,
        name: project.name,
        already_owner: true,
        message: 'Ini adalah project Anda sendiri.',
      });
    }

    // Otherwise, clone the shared project into the caller's workspace using internal fetch or redirect
    return NextResponse.json({
      id: project.id,
      name: project.name,
      owner_name: project.owner_name,
      visibility: project.visibility,
      can_clone: true,
      message: `Project "${project.name}" ditemukan. Anda dapat meng-clone ke workspace Anda.`,
    });
  } catch (err: any) {
    console.error('[projects/join-code POST]', err);
    return NextResponse.json({ error: err.message || 'Gagal memproses kode project' }, { status: 500 });
  }
}
