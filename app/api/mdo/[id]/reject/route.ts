import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  const result = await db.query(
    `UPDATE detection_mdo_records
     SET approval_status='REJECTED', approved_at=NULL, approved_by=NULL, rejection_reason=$2, updated_at=NOW()
     WHERE id=$1 RETURNING id, approval_status, rejection_reason`,
    [id, reason],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'MDO record not found' }, { status: 404 });
  return NextResponse.json({ record: result.rows[0] });
}
