import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  applyProjectAutoTagging,
  loadProjectExistingTags,
  LegendSymbolTagPatternRef,
} from '@/lib/tag-generator';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: documentId } = await params;

    const docRes = await db.query(
      'SELECT id, project_id FROM documents WHERE id = $1',
      [documentId]
    );
    if (docRes.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { project_id: projectId } = docRes.rows[0];

    // 1. Fetch all untagged detections for this document
    const detRes = await db.query<{
      id: string;
      asset_type: string;
      asset_tag: string | null;
      legend_symbol_id: string | null;
      evidence: any;
      det_evidence?: any;
    }>(
      `SELECT id, asset_type, asset_tag, legend_symbol_id, evidence, det_evidence
       FROM detections
       WHERE document_id = $1
         AND (asset_tag IS NULL OR TRIM(asset_tag) = '')
       ORDER BY pid_page ASC, created_at ASC`,
      [documentId]
    );

    if (detRes.rows.length === 0) {
      return NextResponse.json({ ok: true, count: 0, message: 'No untagged detections found' });
    }

    // 2. Load existing project tags to ensure collision-free allocation
    const existingProjectTags = await loadProjectExistingTags(db, projectId);

    // 3. Load legend symbols for custom tag_pattern support
    let legendSymbols: LegendSymbolTagPatternRef[] = [];
    try {
      const symRes = await db.query<LegendSymbolTagPatternRef>(
        `SELECT id, asset_type, symbol_name, tag_pattern
         FROM legend_symbols
         WHERE status = 'ACTIVE'`
      );
      legendSymbols = symRes.rows;
    } catch (symErr) {
      console.warn('[auto-tag] failed to load legend symbols:', symErr);
    }

    // 4. Map DB detections into AutoTaggable format
    const taggableList = detRes.rows.map((r) => {
      let evList: string[] = [];
      if (Array.isArray(r.evidence)) {
        evList = [...r.evidence];
      } else if (typeof r.evidence === 'string') {
        try {
          const parsed = JSON.parse(r.evidence);
          evList = Array.isArray(parsed) ? parsed : [];
        } catch {
          evList = [r.evidence];
        }
      }

      return {
        id: r.id,
        assetTag: r.asset_tag,
        assetType: r.asset_type,
        legendSymbol: r.legend_symbol_id,
        evidence: evList,
        detEvidence: r.det_evidence && typeof r.det_evidence === 'object' ? r.det_evidence : {},
      };
    });

    // 5. Apply project incremental auto-tagging
    const { generatedCount } = applyProjectAutoTagging(taggableList, {
      existingProjectTags,
      legendSymbols,
      allowGeneratedTags: true,
    });

    // 6. Persist generated tags back to DB
    for (const item of taggableList) {
      if (item.assetTag) {
        await db.query(
          `UPDATE detections
           SET asset_tag = $1,
               evidence = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [item.assetTag, JSON.stringify(item.evidence), item.id]
        );

        // Also update MDO proposed tag if MDO record already exists without tag
        await db.query(
          `UPDATE detection_mdo_records
           SET tag_no_proposed = $1,
               updated_at = NOW()
           WHERE detection_id = $2
             AND (tag_no_proposed IS NULL OR TRIM(tag_no_proposed) = '')`,
          [item.assetTag, item.id]
        );
      }
    }

    return NextResponse.json({
      ok: true,
      count: generatedCount,
      totalChecked: taggableList.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auto-tag route error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
