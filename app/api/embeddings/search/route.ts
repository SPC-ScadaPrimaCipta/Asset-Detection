/**
 * POST /api/embeddings/search
 *
 * Search symbol embeddings by canonical feature string.
 * Generates embedding from canonical string, runs Top-5 cosine similarity search.
 *
 * Body: { canonical: string, project_id?: string, limit?: number }
 * Returns: { matches: SimilarityMatch[], query_canonical: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { embedCanonical } from '@/lib/embedding-service';
import { searchSimilar, getProjectEmbeddings } from '@/lib/vector-repository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const canonical = body.canonical as string | undefined;
    const projectId = (body.project_id as string | undefined) ?? null;
    const limit = Math.min(20, Math.max(1, Number(body.limit) || 5));

    if (!canonical || typeof canonical !== 'string' || !canonical.trim()) {
      return NextResponse.json(
        { error: 'canonical is required — must be serialized feature string (e.g. shape=circle;inside_text=PT;...)' },
        { status: 400 }
      );
    }

    // Generate embedding from canonical string
    const embResult = await embedCanonical(canonical.trim());
    if (!embResult) {
      return NextResponse.json(
        { error: 'Embedding generation failed — check GEMINI_API_KEY and model availability' },
        { status: 503 }
      );
    }

    // Search Top-N similar
    const matches = await searchSimilar({
      embedding: embResult.embedding,
      projectId,
      limit,
    });

    return NextResponse.json({
      query_canonical: canonical,
      matches,
      total: matches.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[embeddings/search POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/embeddings/search?project_id=...
 * List all stored embeddings for a project (admin/review).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const embeddings = await getProjectEmbeddings(projectId);
    return NextResponse.json({ data: embeddings, total: embeddings.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[embeddings/search GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
