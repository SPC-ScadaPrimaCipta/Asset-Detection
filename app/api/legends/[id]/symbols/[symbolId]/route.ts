import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { LegendSymbolSchema, validateTagPattern } from '@/lib/legend-schemas';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id: legendId, symbolId } = await params;
  const body = await request.json();
  const parsed = LegendSymbolSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const patternErr = validateTagPattern(parsed.data.tag_pattern);
  if (patternErr) return NextResponse.json({ error: patternErr }, { status: 400 });

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

  const { asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, review_reason } = parsed.data;

  try {
    const exists = await db.query(
      'SELECT 1 FROM legend_symbols WHERE id = $1 AND legend_id = $2',
      [symbolId, legendId]
    );
    if (exists.rows.length === 0) {
      return NextResponse.json(
        { error: 'Symbol not found. It may have been replaced by a re-parse; refresh the page and select it again.' },
        { status: 404 }
      );
    }

    await db.query(
      `UPDATE legend_symbols SET
        asset_type = $1, symbol_name = $2, tag_pattern = $3, description = $4,
        aliases = $5::text[], status = $6, bbox_x = $7, bbox_y = $8, bbox_w = $9, bbox_h = $10, pid_page = $11,
        review_reason = $12, updated_at = NOW()
      WHERE id = $13 AND legend_id = $14`,
      [asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x ?? null, bbox_y ?? null, bbox_w ?? null, bbox_h ?? null, pid_page ?? null, review_reason ?? null, symbolId, legendId]
    );

    let res;
    try {
      res = await db.query(
        `SELECT ls.*, lc.label AS class_label, lc.normalized_label AS class_key
         FROM legend_symbols ls LEFT JOIN legend_classes lc ON lc.id = ls.class_id
         WHERE ls.id = $1`,
        [symbolId]
      );
    } catch {
      // legend_classes table not migrated yet — fall back without class labels.
      res = await db.query('SELECT * FROM legend_symbols WHERE id = $1', [symbolId]);
    }
    return NextResponse.json(res.rows[0]);
  } catch (err: any) {
    console.error('[PUT symbol]', err);
    return NextResponse.json({ error: err.message ?? 'Database error' }, { status: 500 });
  }
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

  const exists = await db.query('SELECT 1 FROM legend_symbols WHERE id = $1 AND legend_id = $2', [symbolId, legendId]);
  if (exists.rows.length === 0) {
    return NextResponse.json(
      { error: 'Symbol not found. It may have been replaced by a re-parse; refresh the page and select it again.' },
      { status: 404 }
    );
  }

  await db.query('DELETE FROM legend_symbols WHERE id = $1 AND legend_id = $2', [symbolId, legendId]);
  return NextResponse.json({ success: true });
}