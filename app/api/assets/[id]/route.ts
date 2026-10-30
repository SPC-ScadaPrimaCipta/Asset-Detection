import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await db.query(
      `SELECT a.*, l.name AS legend_name
       FROM assets a
       LEFT JOIN legends l ON l.id = a.legend_id
       WHERE a.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assets/[id] GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    const allowed = [
      'asset_tag', 'asset_type', 'equipment_class', 'description',
      'service', 'location', 'unit', 'area', 'pid_number', 'size',
    ];
    for (const key of allowed) {
      if (key in body) {
        fields.push(`${key} = $${i++}`);
        vals.push(body[key] ?? null);
      }
    }
    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    vals.push(id);
    const result = await db.query(
      `UPDATE assets SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assets/[id] PUT]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await db.query('DELETE FROM assets WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assets/[id] DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
