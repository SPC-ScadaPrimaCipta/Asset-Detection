import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { LegendSchema } from '@/lib/legend-schemas';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const projectId = request.nextUrl.searchParams.get('project_id');

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`l.status = $${idx++}`);
      params.push(status);
    }

    if (projectId) {
      conditions.push(`(l.is_builtin = TRUE OR l.project_id = $${idx++} OR (l.project_id IS NULL AND l.visibility = 'PUBLIC'))`);
      params.push(projectId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT l.*,
              u.name AS owner_name,
              COUNT(ls.id)::int AS symbol_count
       FROM legends l
       LEFT JOIN legend_symbols ls ON ls.legend_id = l.id
       LEFT JOIN users u ON l.owner_id = u.id
       ${whereClause}
       GROUP BY l.id, u.name
       ORDER BY l.is_builtin DESC, l.created_at DESC`,
      params
    );
    return NextResponse.json(result.rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    const body = await request.json();
    const parsed = LegendSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

    const { name, description } = parsed.data;
    const projectId = typeof body.project_id === 'string' && body.project_id ? body.project_id : null;
    const visibility = body.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
    const ownerId = user ? user.id : null;
    const id = uuidv4();

    await db.query(
      `INSERT INTO legends (id, name, description, status, project_id, owner_id, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, description, parsed.data.status, projectId, ownerId, visibility]
    );

    return NextResponse.json(
      { id, name, description, status: parsed.data.status, project_id: projectId, visibility },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legends POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}