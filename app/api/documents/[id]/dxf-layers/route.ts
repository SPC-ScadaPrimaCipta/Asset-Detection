import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';

/**
 * GET /api/documents/[id]/dxf-layers
 * Return AI layer analysis for a document.
 * Also returns merged list combining project-level profiles + doc-level AI analysis.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const doc = (await db.query(
      `SELECT id, file_type, project_id FROM documents WHERE id = $1`,
      [id]
    )).rows[0] as { id: string; file_type: string; project_id: string } | undefined;

    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (doc.file_type !== 'dxf') {
      return NextResponse.json({ error: 'Document is not a DXF file' }, { status: 400 });
    }

    // AI layer analysis for this document
    let analysis: unknown[] = [];
    try {
      const aResult = await db.query(
        `SELECT * FROM dxf_layer_analysis WHERE document_id = $1 ORDER BY short_name`,
        [id]
      );
      analysis = aResult.rows;
    } catch { /* table not yet created */ }

    // Project-level profiles
    let profiles: unknown[] = [];
    try {
      const pResult = await db.query(
        `SELECT * FROM dxf_layer_profiles WHERE project_id = $1 ORDER BY short_name`,
        [doc.project_id]
      );
      profiles = pResult.rows;
    } catch { /* ignore */ }

    return NextResponse.json({ analysis, profiles });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dxf-layers/doc GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/documents/[id]/dxf-layers/classify
 * Trigger AI layer classification for a DXF document.
 * Idempotent — re-runs and updates existing analysis.
 *
 * Body (optional): { force: true } — re-classify even if analysis exists
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({})) as { force?: boolean };
    const force = body.force === true;

    const doc = (await db.query(
      `SELECT id, file_type, file_path, project_id FROM documents WHERE id = $1`,
      [id]
    )).rows[0] as { id: string; file_type: string; file_path: string; project_id: string } | undefined;

    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (doc.file_type !== 'dxf') {
      return NextResponse.json({ error: 'Document is not a DXF file' }, { status: 400 });
    }

    // Check existing unless force
    if (!force) {
      try {
        const existing = (await db.query(
          `SELECT COUNT(*) AS cnt FROM dxf_layer_analysis WHERE document_id = $1`,
          [id]
        )).rows[0] as { cnt: string };
        if (parseInt(existing.cnt) > 0) {
          return NextResponse.json({
            message: 'Layer analysis already exists. Use force=true to re-classify.',
            existing: parseInt(existing.cnt),
          });
        }
      } catch { /* table not ready, proceed */ }
    }

    // Load DXF file
    const buf = (await getFile(doc.file_path)) as unknown as Buffer;

    // Collect samples and run AI
    const { collectLayerSamples, classifyLayersWithAI } = await import('@/lib/dxf-detection');
    const samples = collectLayerSamples(buf);

    if (!samples.length) {
      return NextResponse.json({ classified: 0, message: 'No text layers found in DXF' });
    }

    const results = await classifyLayersWithAI(samples);

    // Persist results
    let saved = 0;
    for (const r of results) {
      const sampleTexts = samples.find(s => s.shortName === r.shortName)?.sampleTexts ?? [];
      try {
        await db.query(
          `INSERT INTO dxf_layer_analysis
             (document_id, layer_name, short_name, sample_texts,
              ai_category, ai_confidence, ai_reasoning, final_category)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $5)
           ON CONFLICT (document_id, layer_name) DO UPDATE
             SET ai_category    = EXCLUDED.ai_category,
                 ai_confidence  = EXCLUDED.ai_confidence,
                 ai_reasoning   = EXCLUDED.ai_reasoning,
                 final_category = EXCLUDED.ai_category,
                 sample_texts   = EXCLUDED.sample_texts`,
          [id, r.layerName, r.shortName, JSON.stringify(sampleTexts),
           r.category, r.confidence, r.reasoning]
        );
        saved++;
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({
      classified: results.length,
      saved,
      results: results.map(r => ({
        layerName: r.layerName,
        shortName: r.shortName,
        category: r.category,
        confidence: r.confidence,
        reasoning: r.reasoning,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dxf-layers classify POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/documents/[id]/dxf-layers
 * Override final_category for a specific layer (human correction).
 *
 * Body: { layer_name: string, final_category: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json() as { layer_name?: string; final_category?: string };
    const layerName = String(body.layer_name ?? '').trim();
    const finalCategory = String(body.final_category ?? '').trim();

    if (!layerName || !finalCategory) {
      return NextResponse.json({ error: 'layer_name and final_category required' }, { status: 400 });
    }

    const VALID = ['tag', 'description', 'pipe', 'equipment', 'title', 'ignore', 'unknown'];
    if (!VALID.includes(finalCategory)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID.join(', ')}` },
        { status: 400 }
      );
    }

    const result = await db.query(
      `UPDATE dxf_layer_analysis
          SET final_category = $1
        WHERE document_id = $2 AND layer_name = $3
       RETURNING *`,
      [finalCategory, id, layerName]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Layer analysis record not found' }, { status: 404 });
    }

    return NextResponse.json({ updated: result.rows[0] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dxf-layers PATCH]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
