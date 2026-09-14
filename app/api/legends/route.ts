import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';

export async function GET() {
  const result = await db.query(
    `SELECT l.*, COUNT(ls.id)::int AS symbol_count
     FROM legends l
     LEFT JOIN legend_symbols ls ON ls.legend_id = l.id
     GROUP BY l.id
     ORDER BY l.created_at DESC`
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const { name, description } = await request.json();
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  
  const id = uuidv4();
  await db.query('INSERT INTO legends (id, name, description) VALUES ($1, $2, $3)', [id, name, description]);
  
  return NextResponse.json({ id, name, description }, { status: 201 });
}