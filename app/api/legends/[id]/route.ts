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
    const body = await request.json();
    const existing = await db.query('SELECT * FROM legends WHERE id=$1', [id]);
    if (existing.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cur = existing.rows[0];
    const name = body.name ?? cur.name;
    const description = body.description !== undefined ? body.description : cur.description;
    const status = body.status ?? cur.status;
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    // strictQuality gate (Stage 3.5): refuse finalize while symbols are
    // unassessed (quality NULL), in review, or still DRAFT — unless forced.
    if (status === 'ACTIVE' && body.strictQuality && !body.force) {
      const q = await db.query(
        `SELECT
           count(*) FILTER (WHERE status = 'DRAFT') AS drafts,
           count(*) FILTER (WHERE quality_status IS NULL) AS unassessed,
           count(*) FILTER (WHERE quality_status = 'review') AS in_review,
           count(*) AS total
         FROM legend_symbols WHERE legend_id = $1`,
        [id]
      );
      const c = q.rows[0] as Record<string, string>;
      const drafts = Number(c.drafts), unassessed = Number(c.unassessed), in_review = Number(c.in_review);
      if (drafts > 0 || unassessed > 0 || in_review > 0) {
        return NextResponse.json(
          { error: 'Quality gate: resolve review items before finalize', drafts, unassessed, in_review, total: Number(c.total) },
          { status: 409 }
        );
      }
    }
    await db.query(
      'UPDATE legends SET name=$1, description=$2, status=$3, updated_at=NOW() WHERE id=$4',
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
    // Check built-in protection
    try {
      const legendRow = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [id]);
      if (legendRow.rows[0]?.is_builtin) {
        return NextResponse.json({ error: 'Built-in standard legends cannot be deleted.' }, { status: 403 });
      }
    } catch { /* is_builtin column missing — allow delete */ }

    // Delete symbols first (in case no ON DELETE CASCADE in DB)
    await db.query('DELETE FROM legend_symbols WHERE legend_id = $1', [id]);
    await db.query('DELETE FROM legends WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends/[id] DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
