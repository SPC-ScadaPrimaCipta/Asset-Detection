import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const r = await db.query('SELECT * FROM projects ORDER BY created_at DESC');
  return NextResponse.json(r.rows);
}

export async function POST(request: NextRequest) {
  const { v4: uuidv4 } = await import('uuid');
  const { name } = await request.json();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const r = await db.query('INSERT INTO projects (id, name) VALUES ($1,$2) RETURNING *', [uuidv4(), name]);
  return NextResponse.json(r.rows[0], { status: 201 });
}