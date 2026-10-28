import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser, isPrivileged } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await db.query(
      `SELECT p.*,
         u.name AS owner_name,
         u.email AS owner_email,
         (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS document_count,
         (SELECT COUNT(*)::int FROM detection_jobs j WHERE j.project_id = p.id) AS job_count,
         (SELECT COUNT(*)::int FROM detections det JOIN documents doc ON det.document_id = doc.id WHERE doc.project_id = p.id) AS detection_count,
         (SELECT COUNT(*)::int FROM assets a WHERE a.project_id = p.id) AS asset_count
       FROM projects p
       LEFT JOIN users u ON p.owner_id = u.id
       WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[projects/[id] GET]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const user = await getCurrentUser(request);
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    const visibility = body.visibility === 'PUBLIC' || body.visibility === 'PRIVATE' ? body.visibility : undefined;

    // Check project exists
    const existing = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const currentProject = existing.rows[0];
    // Permission check: if project has owner and logged in user is different and not admin/superadmin
    if (currentProject.owner_id && user && currentProject.owner_id !== user.id && !isPrivileged(user)) {
      return NextResponse.json({ error: 'Hanya pemilik proyek yang dapat mengubah pengaturan proyek' }, { status: 403 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) {
      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
      updates.push(`name = $${idx++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description);
    }
    if (visibility !== undefined) {
      updates.push(`visibility = $${idx++}`);
      values.push(visibility);
    }

    if (updates.length === 0) {
      return NextResponse.json(currentProject);
    }

    values.push(id);
    const result = await db.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return NextResponse.json(result.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[projects/[id] PUT]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const user = await getCurrentUser(request);
    const existing = await db.query('SELECT owner_id FROM projects WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const projectOwner = existing.rows[0].owner_id;
    if (projectOwner && user && projectOwner !== user.id && !isPrivileged(user)) {
      return NextResponse.json({ error: 'Hanya pemilik yang dapat menghapus proyek ini' }, { status: 403 });
    }

    await db.query('DELETE FROM projects WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[projects/[id] DELETE]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
