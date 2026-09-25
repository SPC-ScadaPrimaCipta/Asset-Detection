import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { LegendSchema, LegendSymbolSchema } from '@/lib/legend-schemas';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const where = status ? `WHERE l.status = $1` : '';
    const params = status ? [status] : [];
    const result = await db.query(
      `SELECT l.*, COUNT(ls.id)::int AS symbol_count
       FROM legends l
       LEFT JOIN legend_symbols ls ON ls.legend_id = l.id
       ${where}
       GROUP BY l.id
       ORDER BY l.created_at DESC`,
      params
    );
    return NextResponse.json(result.rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = LegendSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  const { name, description } = parsed.data;
  const id = uuidv4();
  await db.query('INSERT INTO legends (id, name, description, status) VALUES ($1, $2, $3, $4)', [id, name, description, parsed.data.status]);

  return NextResponse.json({ id, name, description, status: parsed.data.status }, { status: 201 });
}