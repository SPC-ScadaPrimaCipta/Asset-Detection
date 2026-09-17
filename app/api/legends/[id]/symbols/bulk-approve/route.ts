import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await pool.query(
      "UPDATE legend_symbols SET status = 'ACTIVE' WHERE legend_id = $1 AND status = 'DRAFT' RETURNING *",
      [id]
    );
    return NextResponse.json({ symbols: result.rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend/bulk-approve]', msg);
    return NextResponse.json({ error: 'Bulk approve failed' }, { status: 500 });
  }
}
