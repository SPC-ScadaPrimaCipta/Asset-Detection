import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getCurrentUser, generateShareCode } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    const filter = request.nextUrl.searchParams.get('filter'); // 'my' | 'public'

    let whereClause = '';
    const params: unknown[] = [];

    if (filter === 'my') {
      if (!user) {
        return NextResponse.json([]);
      }
      whereClause = 'WHERE p.owner_id = $1';
      params.push(user.id);
    } else if (filter === 'public') {
      whereClause = "WHERE p.visibility = 'PUBLIC'";
    } else {
      if (user) {
        whereClause = "WHERE p.visibility = 'PUBLIC' OR p.owner_id = $1";
        params.push(user.id);
      } else {
        whereClause = "WHERE p.visibility = 'PUBLIC'";
      }
    }

    const query = `
      SELECT p.*,
             u.name AS owner_name,
             u.email AS owner_email,
             (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS document_count,
             (SELECT COUNT(*)::int FROM detections det JOIN documents doc ON det.document_id = doc.id WHERE doc.project_id = p.id) AS detection_count
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
    `;

    const r = await db.query(query, params);
    return NextResponse.json(r.rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[projects GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : null;
    const visibility = body.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';

    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const id = uuidv4();
    const shareCode = generateShareCode();
    const ownerId = user ? user.id : null;

    const r = await db.query(
      `INSERT INTO projects (id, name, description, owner_id, visibility, share_code)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, name, description, ownerId, visibility, shareCode]
    );

    const created = r.rows[0];
    return NextResponse.json(
      {
        ...created,
        owner_name: user?.name ?? 'Admin / System',
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[projects POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
