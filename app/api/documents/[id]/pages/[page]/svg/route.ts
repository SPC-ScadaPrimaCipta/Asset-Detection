import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile, saveFile, fileExists } from '@/lib/storage';
import { renderDxfToSvg } from '@/lib/dxf-svg-renderer';

export const maxDuration = 60;

function svgHeaders(byteLen: number, cacheHit: boolean) {
  return {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
    'Content-Length': String(byteLen),
    'X-Render-Cache': cacheHit ? 'HIT' : 'MISS',
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; page: string }> },
) {
  const { id, page: pageStr } = await params;

  const pageNumber = parseInt(pageStr, 10);
  if (isNaN(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ error: 'Invalid page number' }, { status: 400 });
  }

  try {
    const docRow = await db.query(
      'SELECT file_path, page_count, file_type FROM documents WHERE id=$1',
      [id],
    );
    if (docRow.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { file_path, file_type } = docRow.rows[0] as {
      file_path: string;
      page_count: number;
      file_type: string;
    };

    if (file_type !== 'dxf') {
      return NextResponse.json(
        { error: 'SVG endpoint is only available for DXF documents' },
        { status: 422 },
      );
    }

    // DXF = single page; only page 1 is valid
    if (pageNumber !== 1) {
      return NextResponse.json(
        { error: 'DXF documents have only 1 page' },
        { status: 400 },
      );
    }

    // Disk cache: render once, serve from cache on subsequent requests
    const cacheName = `dxf-svg-${id}-p${pageNumber}.svg`;
    try {
      if (await fileExists(cacheName)) {
        const cached = (await getFile(cacheName)) as unknown as Buffer;
        return new NextResponse(new Uint8Array(cached), {
          status: 200,
          headers: svgHeaders(cached.length, true),
        });
      }
    } catch {
      /* cache miss — render */
    }

    const buf = (await getFile(file_path)) as unknown as Buffer;
    const { svg } = renderDxfToSvg(buf);
    const svgBuf = Buffer.from(svg, 'utf-8');

    // Save best-effort
    saveFile(cacheName, svgBuf).catch(() => {});

    return new NextResponse(new Uint8Array(svgBuf), {
      status: 200,
      headers: svgHeaders(svgBuf.length, false),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[documents/${id}/pages/${pageNumber}/svg GET]`, msg);

    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to render DXF as SVG', details: msg }, { status: 500 });
  }
}
