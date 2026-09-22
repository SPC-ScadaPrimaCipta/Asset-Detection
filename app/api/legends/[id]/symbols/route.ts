import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { LegendSymbolSchema } from '@/lib/legend-schemas';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const includeDraft = request.nextUrl.searchParams.get("include_draft") === "true";
  const cond = includeDraft ? "" : "AND status != 'REJECTED'";
  const result = await db.query(`SELECT * FROM legend_symbols WHERE legend_id = $1 ${cond} ORDER BY asset_type`, [id]);
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json();
  const parsed = LegendSymbolSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  const { id: legendId } = await params;

  // Block modification of built-in legends (tolerant: skip if column not migrated yet)
  try {
    const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]);
    if (legendRow.rows[0]?.is_builtin) {
      return NextResponse.json(
        { error: 'Built-in standard legends cannot be modified. Create a custom legend instead.' },
        { status: 403 }
      );
    }
  } catch { /* is_builtin column missing — allow create */ }

  const id = uuidv4();
  const { asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page } = parsed.data;

  await db.query(
    'INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [id, legendId, asset_type, symbol_name, tag_pattern, description, bbox_x ?? null, bbox_y ?? null, bbox_w ?? null, bbox_h ?? null, pid_page ?? null, aliases, status]
  );

  // Audit entry
  await db.query('INSERT INTO legend_symbol_edits (symbol_id, legend_id, action, new_values) VALUES ($1, $2, $3, $4)',
    [id, legendId, 'CREATE', JSON.stringify(parsed.data)]);

  return NextResponse.json({ id, legend_id: legendId, ...parsed.data }, { status: 201 });
}