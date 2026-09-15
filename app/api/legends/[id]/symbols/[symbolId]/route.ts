import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { LegendSymbolSchema } from '@/lib/legend-schemas';

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id, symbolId } = await params;
  try {
    const result = await db.query(
      'SELECT * FROM legend_symbols WHERE id = $1 AND legend_id = $2',
      [symbolId, id]
    );
    if (!result.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[symbols/[symbolId] GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id, symbolId } = await params;
  try {
    const body = await request.json();
    const parsed = LegendSymbolSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

    const { asset_type, symbol_name, tag_pattern, description, aliases, status } = parsed.data;
    const oldRow = (
      await db.query('SELECT * FROM legend_symbols WHERE id = $1 AND legend_id = $2', [symbolId, id])
    ).rows[0];
    if (!oldRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.query(
      `UPDATE legend_symbols
       SET asset_type=$1, symbol_name=$2, tag_pattern=$3, description=$4, aliases=$5, status=$6, updated_at=NOW()
       WHERE id=$7 AND legend_id=$8`,
      [asset_type, symbol_name, tag_pattern, description, aliases, status, symbolId, id]
    );

    await db.query(
      'INSERT INTO legend_symbol_edits (symbol_id, legend_id, action, old_values, new_values) VALUES ($1,$2,$3,$4,$5)',
      [symbolId, id, 'UPDATE', JSON.stringify(oldRow), JSON.stringify(parsed.data)]
    );

    return NextResponse.json({ id: symbolId, legend_id: id, ...parsed.data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[symbols/[symbolId] PUT]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id, symbolId } = await params;
  try {
    const result = await db.query(
      'DELETE FROM legend_symbols WHERE id = $1 AND legend_id = $2 RETURNING *',
      [symbolId, id]
    );
    if (!result.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await db.query(
      'INSERT INTO legend_symbol_edits (symbol_id, legend_id, action, old_values) VALUES ($1,$2,$3,$4)',
      [symbolId, id, 'DELETE', JSON.stringify(result.rows[0])]
    );
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[symbols/[symbolId] DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
