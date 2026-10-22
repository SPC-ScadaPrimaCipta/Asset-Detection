import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = await req.json();

  if (action === 'approve') {
    await db.query(
      `UPDATE detection_mdo_records
       SET approval_status='APPROVED', approved_at=NOW(), approved_by='USER', rejection_reason=NULL, updated_at=NOW()
       WHERE id=$1`,
      [id]
    );
  } else if (action === 'reject') {
    await db.query(
      `UPDATE detection_mdo_records
       SET approval_status='REJECTED', approved_at=NULL, approved_by=NULL, rejection_reason='Manually rejected', updated_at=NOW()
       WHERE id=$1`,
      [id]
    );
  }

  return NextResponse.json({ ok: true });
}
