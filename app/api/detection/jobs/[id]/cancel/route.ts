import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await db.query('SELECT id, status FROM detection_jobs WHERE id=$1', [id]);
  if (!job.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { status } = job.rows[0];
  if (status === 'COMPLETED' || status === 'FAILED') {
    return NextResponse.json({ error: `Cannot cancel job in status ${status}` }, { status: 409 });
  }
  await db.query("UPDATE detection_jobs SET status='CANCELLED', completed_at=NOW() WHERE id=$1", [id]);
  return NextResponse.json({ id, status: 'CANCELLED' });
}
