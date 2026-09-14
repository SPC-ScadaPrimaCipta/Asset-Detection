import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';

export async function GET() {
  const result = await db.query('SELECT * FROM legends ORDER BY created_at DESC');
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const { name, description } = await request.json();
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  
  const id = uuidv4();
  await db.query('INSERT INTO legends (id, name, description) VALUES ($1, $2, $3)', [id, name, description]);
  
  return NextResponse.json({ id, name, description }, { status: 201 });
}