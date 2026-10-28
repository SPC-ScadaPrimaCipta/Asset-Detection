import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isSuperAdmin } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser(req);
    if (!isSuperAdmin(currentUser)) {
      return NextResponse.json(
        { error: 'Pendaftaran mandiri dinonaktifkan. Pembuatan akun baru hanya dapat dilakukan oleh Super Administrator.' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Gunakan endpoint /api/admin/users untuk penambahan akun oleh Super Administrator.' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[auth/register] error:', err);
    return NextResponse.json({ error: err.message || 'Gagal memproses request' }, { status: 500 });
  }
}
