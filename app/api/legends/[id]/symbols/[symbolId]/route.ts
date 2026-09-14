import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id, symbolId } = await params;
  const result = await db.query(
    'SELECT * FROM legend_symbols WHERE id = $1 AND legend_id = $2',
    [symbolId, id]
  );
  if (!result.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id, symbolId } = await params;
  const { asset_type, symbol_name, tag_pattern, description, aliases } = await request.json();
  if (!asset_type) return NextResponse.json({ error: 'Asset type required' }, { status: 400 });

  await db.query(
    `UPDATE legend_symbols
     SET asset_type = $1, symbol_name = $2, tag_pattern = $3, description = $4, aliases = $5
     WHERE id = $6 AND legend_id = $7`,
    [
      asset_type,
      symbol_name ?? null,
      tag_pattern ?? null,
      description ?? null,
      Array.isArray(aliases) ? aliases : [],
      symbolId,
      id,
    ]
  );

  return NextResponse.json({ id: symbolId, legend_id: id, asset_type, symbol_name, tag_pattern, description, aliases });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id, symbolId } = await params;
  const result = await db.query(
    'DELETE FROM legend_symbols WHERE id = $1 AND legend_id = $2 RETURNING id',
    [symbolId, id]
  );
  if (!result.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
