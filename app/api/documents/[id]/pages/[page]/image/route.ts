import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';

// Render scale: 2.0 ≈ 144dpi — good balance between quality and response size for viewer use.
// Worker uses 3.0 for AI analysis; viewer only needs 2.0 for display.
const VIEWER_SCALE = 2.0;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  const { id, page: pageStr } = await params;

  const pageNumber = parseInt(pageStr, 10);
  if (isNaN(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
  }

  try {
    const doc = await db.query('SELECT file_path, page_count FROM documents WHERE id=$1', [id]);
    if (doc.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { file_path, page_count } = doc.rows[0];

    if (page_count !== null && pageNumber > page_count) {
      return NextResponse.json(
        { error: `Page ${pageNumber} out of range (document has ${page_count} pages)` },
        { status: 400 }
      );
    }

    const buf = await getFile(file_path) as unknown as Buffer;
    const { png } = await renderPageToPng(buf, pageNumber, VIEWER_SCALE);

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Cache 1 hour in browser, 24 hours in CDN/shared cache — PDF pages are immutable
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600',
        'Content-Length': String(png.length),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[documents/[id]/pages/[page]/image GET] id=${id} page=${pageNumber}`, msg);

    if (msg.includes('out of range')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes('not found') || msg.includes('ENOENT')) {
      return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to render page' }, { status: 500 });
  }
}
