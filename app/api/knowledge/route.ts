import { NextRequest, NextResponse } from 'next/server';
import { getAllKnowledge, getProjectKnowledge, lookupCompanyKnowledge, saveCompanyKnowledge } from '@/lib/knowledge-db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const projectId = searchParams.get('project_id');
    const tagPrefix = searchParams.get('tag_prefix');
    const q = searchParams.get('q');

    if (tagPrefix || q) {
      const results = await lookupCompanyKnowledge({
        tagPrefix: tagPrefix ?? undefined,
        assetType: q ?? undefined,
        projectId,
      });
      return NextResponse.json(results);
    }

    if (projectId) {
      return NextResponse.json(await getProjectKnowledge(projectId));
    }

    return NextResponse.json(await getAllKnowledge());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[knowledge GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, tag_prefix, asset_type, asset_name, category, symbol_description, source_detection_id } = body;

    if (!asset_type || !asset_name) {
      return NextResponse.json({ error: 'asset_type and asset_name are required' }, { status: 400 });
    }

    const saved = await saveCompanyKnowledge({
      project_id: project_id ?? null,
      drawing_type: (body.drawing_type as string | undefined) ?? null,
      tag_prefix: tag_prefix ?? null,
      asset_type,
      asset_name,
      category: category ?? null,
      symbol_description: symbol_description ?? null,
      geometry_hints: null,
      source_detection_id: source_detection_id ?? null,
    });

    return NextResponse.json(saved, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[knowledge POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
