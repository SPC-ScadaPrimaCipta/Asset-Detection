import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.query(
    `UPDATE detection_mdo_records
     SET approval_status='APPROVED', approved_at=NOW(), approved_by='USER', rejection_reason=NULL, updated_at=NOW()
     WHERE id=$1 AND approval_status <> 'APPROVED'
     RETURNING id, approval_status`,
    [id],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'MDO record not found' }, { status: 404 });
  return NextResponse.json({ record: result.rows[0] });
}
