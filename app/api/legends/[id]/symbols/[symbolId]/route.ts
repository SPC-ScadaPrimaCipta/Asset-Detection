import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { LegendSymbolSchema } from '@/lib/legend-schemas';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id: legendId, symbolId } = await params;
  const body = await request.json();
  const parsed = LegendSymbolSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  // Block modification of built-in legends (tolerant: skip if column not migrated yet)
  try {
    const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]);
    if (legendRow.rows[0]?.is_builtin) {
      return NextResponse.json(
        { error: 'Built-in standard legends cannot be modified. Create a custom legend instead.' },
        { status: 403 }
      );
    }
  } catch { /* is_builtin column missing — allow edit */ }

  const { asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page } = parsed.data;

  await db.query(
    `UPDATE legend_symbols SET
      asset_type = $1, symbol_name = $2, tag_pattern = $3, description = $4,
      aliases = $5, status = $6, bbox_x = $7, bbox_y = $8, bbox_w = $9, bbox_h = $10, pid_page = $11
    WHERE id = $12 AND legend_id = $13`,
    [asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x ?? null, bbox_y ?? null, bbox_w ?? null, bbox_h ?? null, pid_page ?? null, symbolId, legendId]
  );

  // Audit entry
  await db.query('INSERT INTO legend_symbol_edits (symbol_id, legend_id, action, new_values) VALUES ($1, $2, $3, $4)',
    [symbolId, legendId, 'UPDATE', JSON.stringify(parsed.data)]);

  const res = await db.query('SELECT * FROM legend_symbols WHERE id = $1', [symbolId]);
  return NextResponse.json(res.rows[0]);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id: legendId, symbolId } = await params;

  try {
    const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]);
    if (legendRow.rows[0]?.is_builtin) {
      return NextResponse.json(
        { error: 'Built-in standard legends cannot be modified.' },
        { status: 403 }
      );
    }
  } catch { /* is_builtin column missing — allow delete */ }

  await db.query('DELETE FROM legend_symbols WHERE id = $1 AND legend_id = $2', [symbolId, legendId]);
  return NextResponse.json({ success: true });
}