import { NextRequest, NextResponse } from 'next/server';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer } from '@/lib/pdf-render';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    let buf: Buffer | null = null;
    try { buf = await getFile(`legend-${id}.pdf`) as unknown as Buffer; } catch {}
    if (!buf) return NextResponse.json({ error: 'Legend PDF not found' }, { status: 404 });
    const count = await getPdfPageCountFromBuffer(buf);
    return NextResponse.json({ count });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0,300) }, { status: 500 });
  }
}
