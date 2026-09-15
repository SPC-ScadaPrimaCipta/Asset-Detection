import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.query(
      `SELECT l.*, COUNT(ls.id)::int AS symbol_count
       FROM legends l
       LEFT JOIN legend_symbols ls ON ls.legend_id = l.id
       WHERE l.id = $1
       GROUP BY l.id`,
      [id]
    );
    if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends/[id] GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { name, description, status } = await request.json();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    await db.query(
      'UPDATE legends SET name=$1, description=$2, status=COALESCE($3, status), updated_at=NOW() WHERE id=$4',
      [name, description ?? null, status ?? null, id]
    );
    return NextResponse.json({ id, name, description, status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends/[id] PUT]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await db.query('DELETE FROM legends WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends/[id] DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
