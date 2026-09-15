import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { getFile } from '@/lib/storage';
import db from '@/lib/db';

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Canonical name for new uploads
  try {
    const file = await getFile(`legend-${id}.pdf`);
    return new NextResponse(file as any, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  } catch { /* fall through */ }

  // 2. Legacy uploads saved by original filename — resolve via description
  try {
    const leg = await db.query('SELECT description FROM legends WHERE id=$1', [id]);
    const desc: string = leg.rows[0]?.description ?? '';
    const m = desc.match(/^Imported from (.+)$/);
    if (m) {
      const safe = m[1].replace(/[^a-zA-Z0-9._-]/g, '_');
      try {
        const file = await getFile(`legend-${safe}`);
        return new NextResponse(file as any, {
          headers: { 'Content-Type': 'application/pdf' },
        });
      } catch { /* fall through */ }
    }
  } catch { /* fall through */ }

  // 3. Last resort: single legend PDF in storage
  try {
    const { join: pjoin } = await import('path');
    const storagePath = process.env.STORAGE_PATH || pjoin(process.cwd(), 'storage');
    /*turbopackIgnore: true*/
    const files = await readdir(storagePath);
    const candidates = files.filter(f => f.startsWith('legend-') && f.endsWith('.pdf'));
    if (candidates.length === 1) {
      /*turbopackIgnore: true*/
      const file = await readFile(join(storagePath, candidates[0]));
      return new NextResponse(file as any, {
        headers: { 'Content-Type': 'application/pdf' },
      });
    }
  } catch { /* ignore */ }

  return NextResponse.json({ error: 'PDF not found' }, { status: 404 });
}
