import { NextRequest, NextResponse } from 'next/server';
import { getDocumentTextTokens } from '@/lib/text-tokens';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1);
    const tokens = await getDocumentTextTokens(id, page);
    return NextResponse.json({ tokens });
  } catch (error) {
    console.error('[document-text]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Unable to extract document text' }, { status: 500 });
  }
}
