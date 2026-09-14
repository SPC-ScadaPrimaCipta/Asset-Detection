import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.query('SELECT * FROM legend_symbols WHERE legend_id = $1 ORDER BY asset_type', [id]);
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { asset_type, tag_pattern, description } = await request.json();
  if (!asset_type) return NextResponse.json({ error: 'Asset type required' }, { status: 400 });
  
  const { id: legendId } = await params;
  const id = uuidv4();
  await db.query('INSERT INTO legend_symbols (id, legend_id, asset_type, tag_pattern, description) VALUES ($1, $2, $3, $4, $5)', [id, legendId, asset_type, tag_pattern, description]);
  
  return NextResponse.json({ id, legend_id: legendId, asset_type, tag_pattern, description }, { status: 201 });
}