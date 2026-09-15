import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';

export async function GET() {
  try {
    const r = await db.query('SELECT * FROM projects ORDER BY created_at DESC');
    return NextResponse.json(r.rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[projects GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const r = await db.query(
      'INSERT INTO projects (id, name) VALUES ($1,$2) RETURNING *',
      [uuidv4(), name]
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[projects POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
