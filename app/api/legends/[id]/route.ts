import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.query('SELECT * FROM legends WHERE id = $1', [id]);
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const { name, description, status } = body;
  if (status) {
    await db.query('UPDATE legends SET status=$1, updated_at=NOW() WHERE id=$2', [status, id]);
    const result = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    return NextResponse.json(result.rows[0]);
  }
  await db.query('UPDATE legends SET name = $1, description = $2 WHERE id = $3', [name, description, id]);
  return NextResponse.json({ id, name, description });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.query('DELETE FROM legends WHERE id = $1', [id]);
  return NextResponse.json({ success: true });
}