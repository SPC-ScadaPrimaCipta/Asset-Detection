import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

const VALID_CATEGORIES = ['tag', 'description', 'pipe', 'equipment', 'title', 'ignore', 'unknown'] as const;
type Category = typeof VALID_CATEGORIES[number];

/**
 * GET /api/projects/[id]/dxf-layers
 * List all layer profiles for a project.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await db.query(
      `SELECT * FROM dxf_layer_profiles WHERE project_id = $1 ORDER BY category, short_name`,
      [id]
    );
    return NextResponse.json({ profiles: result.rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Table may not exist yet (migration pending)
    if (msg.includes('does not exist')) {
      return NextResponse.json({ profiles: [], warning: 'Run npm run migrate to create dxf_layer_profiles table' });
    }
    console.error('[dxf-layers GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/projects/[id]/dxf-layers
 * Upsert layer profile(s) for a project.
 *
 * Body: { profiles: Array<{ layer_name, short_name, category, tag_priority?, notes? }> }
 * Or single: { layer_name, short_name, category, tag_priority?, notes? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const rawProfiles = Array.isArray(body.profiles) ? body.profiles : [body];

    if (!rawProfiles.length) {
      return NextResponse.json({ error: 'No profiles provided' }, { status: 400 });
    }

    const updated: unknown[] = [];
    for (const raw of rawProfiles) {
      const p = raw as Record<string, unknown>;
      const layerName = String(p.layer_name ?? '').trim();
      const shortName = String(p.short_name ?? layerName).trim();
      const category = String(p.category ?? 'unknown') as Category;
      const tagPriority = typeof p.tag_priority === 'number' ? p.tag_priority : 99;
      const notes = p.notes ? String(p.notes).slice(0, 500) : null;

      if (!layerName) continue;
      if (!VALID_CATEGORIES.includes(category)) {
        return NextResponse.json(
          { error: `Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}` },
          { status: 400 }
        );
      }

      const row = await db.query(
        `INSERT INTO dxf_layer_profiles
           (project_id, layer_name, short_name, category, tag_priority, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (project_id, layer_name) DO UPDATE
           SET short_name = EXCLUDED.short_name,
               category   = EXCLUDED.category,
               tag_priority = EXCLUDED.tag_priority,
               notes      = EXCLUDED.notes,
               updated_at = NOW()
         RETURNING *`,
        [id, layerName, shortName, category, tagPriority, notes]
      );
      updated.push(row.rows[0]);
    }

    return NextResponse.json({ updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('does not exist')) {
      return NextResponse.json({ error: 'Run npm run migrate first' }, { status: 503 });
    }
    console.error('[dxf-layers PUT]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id]/dxf-layers
 * Delete all layer profiles for a project (reset to defaults).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await db.query(
      `DELETE FROM dxf_layer_profiles WHERE project_id = $1`,
      [id]
    );
    return NextResponse.json({ deleted: result.rowCount });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dxf-layers DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
