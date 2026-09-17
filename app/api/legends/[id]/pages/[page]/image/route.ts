import { NextRequest, NextResponse } from 'next/server';
import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';

export const maxDuration = 60;
const VIEWER_SCALE = 2.5;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; page: string }> }) {
  const { id, page: pageStr } = await params;
  const n = parseInt(pageStr, 10);
  if (isNaN(n) || n < 1) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
  try {
    let buf: Buffer | null = null;
    try { buf = await getFile(`legend-${id}.pdf`) as unknown as Buffer; } catch {}
    if (!buf) return NextResponse.json({ error: 'Legend PDF not found' }, { status: 404 });
    const { png } = await renderPageToPng(buf, n, VIEWER_SCALE);
    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Content-Length': String(png.length) },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[legends pages image] ${id} p${pageStr}`, msg);
    return NextResponse.json({ error: 'Failed to render page' }, { status: 500 });
  }
}
