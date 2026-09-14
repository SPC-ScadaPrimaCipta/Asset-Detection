import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await db.query('SELECT * FROM detection_jobs WHERE id = $1', [id]);
  if (res.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(res.rows[0]);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await db.query("UPDATE detection_jobs SET status = 'CANCELLED' WHERE id = $1", [id]);
  return NextResponse.json({ status: 'CANCELLED' });
}