import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';

export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const docRow = await db.query(
      'SELECT file_path, filename, file_type FROM documents WHERE id=$1',
      [id],
    );
    if (docRow.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { file_path, filename } = docRow.rows[0] as {
      file_path: string;
      filename: string;
      file_type: string;
    };

    const buf = (await getFile(file_path)) as unknown as Buffer;
    const safeFilename = encodeURIComponent(filename || 'drawing.dxf');

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf',
        'Content-Disposition': `inline; filename="${safeFilename}"`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[documents/[id]/raw GET]', msg);
    return NextResponse.json({ error: 'Failed to read document file' }, { status: 500 });
  }
}
