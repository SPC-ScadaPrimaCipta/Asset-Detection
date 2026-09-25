import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { LegendSymbolSchema, validateTagPattern } from '@/lib/legend-schemas';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const includeDraft = request.nextUrl.searchParams.get("include_draft") === "true";
  const cond = includeDraft ? "" : "AND status != 'REJECTED'";
  let result;
  try {
    result = await db.query(
      `SELECT ls.*, lc.label AS class_label, lc.normalized_label AS class_key
       FROM legend_symbols ls LEFT JOIN legend_classes lc ON lc.id = ls.class_id
       WHERE ls.legend_id = $1 ${cond} ORDER BY ls.asset_type`,
      [id]
    );
  } catch {
    // legend_classes table not migrated yet — fall back without class labels.
    result = await db.query(`SELECT * FROM legend_symbols WHERE legend_id = $1 ${cond} ORDER BY asset_type`, [id]);
  }
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json();
  const parsed = LegendSymbolSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const patternErr = validateTagPattern(parsed.data.tag_pattern);
  if (patternErr) return NextResponse.json({ error: patternErr }, { status: 400 });

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
    'INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13)',
    [id, legendId, asset_type, symbol_name, tag_pattern, description, bbox_x ?? null, bbox_y ?? null, bbox_w ?? null, bbox_h ?? null, pid_page ?? null, aliases, status]
  );

  return NextResponse.json({ id, legend_id: legendId, ...parsed.data }, { status: 201 });
}