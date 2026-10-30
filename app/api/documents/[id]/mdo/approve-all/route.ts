import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.query(
    `UPDATE detection_mdo_records
     SET approval_status='APPROVED', approved_at=NOW(), approved_by='USER', rejection_reason=NULL, updated_at=NOW()
     WHERE document_id=$1 AND approval_status='PENDING'`,
    [id],
  );
  return NextResponse.json({ approved: result.rowCount ?? 0 });
}
