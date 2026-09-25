import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import { cropAndSaveSymbol } from '@/lib/legend-crop';
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

  // Single-step manual add: crop the drawn bbox immediately so the new row
  // already carries its reference crop — no separate recrop step needed.
  // Non-fatal: crop failure still saves the symbol (cropless = MISSING in UI).
  let refUrl: string | null = null;
  let refHash: string | null = null;
  if (bbox_x != null && bbox_y != null && bbox_w != null && bbox_h != null && pid_page != null) {
    try {
      const pdf = (await getFile(`legend-${legendId}.pdf`)) as unknown as Buffer;
      const rendered = await renderPageToPng(pdf, pid_page, 4.0);
      const ref = await cropAndSaveSymbol(
        rendered.png.toString('base64'),
        { x: bbox_x, y: bbox_y, width: bbox_w, height: bbox_h },
        rendered.width, rendered.height, legendId, pid_page, 0.05
      );
      refUrl = ref.refUrl;
      refHash = ref.refHash;
    } catch (e) {
      console.warn(`[legend/symbols] legend ${legendId} auto-crop failed (non-fatal):`, (e as Error).message?.slice(0, 150));
    }
  }

  await db.query(
    'INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, aliases, status, reference_image_url, reference_crop_hash, quality_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,$14,$15,$16)',
    [id, legendId, asset_type, symbol_name, tag_pattern, description, bbox_x ?? null, bbox_y ?? null, bbox_w ?? null, bbox_h ?? null, pid_page ?? null, aliases, status, refUrl, refHash, refUrl ? 'review' : null]
  );

  // Return the full DB row (incl. reference_image_url) so the UI shows the
  // crop immediately without a refetch.
  let created;
  try {
    created = await db.query(
      `SELECT ls.*, lc.label AS class_label, lc.normalized_label AS class_key
       FROM legend_symbols ls LEFT JOIN legend_classes lc ON lc.id = ls.class_id
       WHERE ls.id=$1`,
      [id]
    );
  } catch {
    created = await db.query('SELECT * FROM legend_symbols WHERE id=$1', [id]);
  }

  return NextResponse.json(created.rows[0], { status: 201 });
}