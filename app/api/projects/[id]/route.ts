import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await db.query(
      `SELECT p.*,
         (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS document_count,
         (SELECT COUNT(*)::int FROM detection_jobs j WHERE j.project_id = p.id) AS job_count,
         (SELECT COUNT(*)::int FROM assets a WHERE a.project_id = p.id) AS asset_count
       FROM projects p
       WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[projects/[id] GET]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await db.query('DELETE FROM projects WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[projects/[id] DELETE]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
