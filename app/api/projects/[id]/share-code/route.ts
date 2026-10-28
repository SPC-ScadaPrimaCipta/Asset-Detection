import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser, generateShareCode } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const user = await getCurrentUser(request);
    const existing = await db.query('SELECT owner_id FROM projects WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const ownerId = existing.rows[0].owner_id;
    if (ownerId && user && ownerId !== user.id && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Hanya pemilik yang dapat me-generate share code' }, { status: 403 });
    }

    const newCode = generateShareCode();
    await db.query('UPDATE projects SET share_code = $1 WHERE id = $2', [newCode, id]);

    return NextResponse.json({ share_code: newCode });
  } catch (err: any) {
    console.error('[projects/[id]/share-code POST]', err);
    return NextResponse.json({ error: err.message || 'Gagal me-generate share code' }, { status: 500 });
  }
}
