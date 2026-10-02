import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; symbolId: string }> }
) {
  const { id: legendId, symbolId } = await params;
  try {
    const r = await db.query(
      'SELECT reference_image_url FROM legend_symbols WHERE id=$1 AND legend_id=$2',
      [symbolId, legendId]
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url = r.rows[0].reference_image_url as string | null;
    if (!url) return NextResponse.json({ error: 'No crop for this symbol' }, { status: 404 });
    const buf = (await getFile(url)) as unknown as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(buf.length),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not found') || msg.includes('ENOENT')) {
      return NextResponse.json({ error: 'Crop file not found in storage' }, { status: 404 });
    }
    console.error('[legend symbol crop GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
