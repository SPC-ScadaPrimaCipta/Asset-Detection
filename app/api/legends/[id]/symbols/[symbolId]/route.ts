import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; symbolId: string }> }) {
  const { id, symbolId } = await params;
  await db.query('DELETE FROM legend_symbols WHERE id = $1 AND legend_id = $2', [symbolId, id]);
  return NextResponse.json({ success: true });
}