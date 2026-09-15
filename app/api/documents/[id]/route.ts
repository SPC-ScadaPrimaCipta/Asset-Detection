import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { join } from 'path';
import { unlink } from 'fs/promises';

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const doc = await db.query('SELECT * FROM documents WHERE id=$1', [id]);
    if (!doc.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(doc.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[documents/[id] GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const doc = await db.query('SELECT file_path FROM documents WHERE id=$1', [id]);
    if (!doc.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Delete from storage (ignore error if file already gone)
    try {
      const storagePath = process.env.STORAGE_PATH || join(process.cwd(), 'storage');
      await unlink(join(storagePath, doc.rows[0].file_path));
    } catch { /* file may already be gone */ }

    // Cascade deletes detection_jobs, detections, document_pages via FK
    await db.query('DELETE FROM documents WHERE id=$1', [id]);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[documents/[id] DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
