import { NextRequest, NextResponse } from 'next/server';
import { deleteKnowledge, updateKnowledge } from '@/lib/knowledge-db';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const updated = await updateKnowledge(id, {
      asset_type: body.asset_type,
      asset_name: body.asset_name,
      category: body.category,
      symbol_description: body.symbol_description,
      tag_prefix: body.tag_prefix,
    });
    if (!updated) return NextResponse.json({ error: 'Not found or no fields to update' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[knowledge PUT]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteKnowledge(id);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[knowledge DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
