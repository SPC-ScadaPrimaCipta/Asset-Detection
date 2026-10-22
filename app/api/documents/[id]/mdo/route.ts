import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';
import { buildMdoRecord } from '@/lib/mdo-enrichment';
import { buildPidGraph, classifyPortDirection, detectArrowheads } from '@/lib/pid-graph';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: documentId } = await params;
    const doc = (await db.query('SELECT id, file_type, file_path FROM documents WHERE id=$1', [documentId])).rows[0];
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    if (doc.file_type !== 'dxf') return NextResponse.json({ error: 'MDO enrichment currently supports DXF' }, { status: 400 });

    const parsed = parseDxf((await getFile(doc.file_path)) as Buffer);
    const regions = splitDxfRegions(parsed);
    const detections = (await db.query(
      `SELECT id, asset_tag, asset_type, description, size, pid_page, bbox_x, bbox_y, bbox_w, bbox_h
       FROM detections WHERE document_id=$1 AND detection_status != 'REJECTED'
         AND candidate_status IN ('FINAL','APPROVED')`,
      [documentId],
    )).rows;
    let count = 0;
    for (const d of detections) {
      const region = regions.find((r) => r.index + 1 === (d.pid_page ?? 1)) ?? regions[0];
      if (!region) continue;
      const x = d.bbox_x == null ? 500 : d.bbox_x;
      const y = d.bbox_y == null ? 500 : d.bbox_y;
      const center = {
        x: region.extents.minX + (x / 1000) * region.extents.width,
        y: region.extents.maxY - (y / 1000) * region.extents.height,
      };
      const anchors = region.entities
        .filter((e): e is Extract<typeof e, { kind: 'TEXT' | 'MTEXT' }> => e.kind === 'TEXT' || e.kind === 'MTEXT')
        .map((e) => ({ text: e.text, x: e.position.x, y: e.position.y }));
      const graph = buildPidGraph(region.entities, Math.max(region.extents.width, region.extents.height) * 0.002);
      const arrows = detectArrowheads(region.entities, Math.max(region.extents.width, region.extents.height) * 0.08);
      const arrowDirection = arrows.map((arrow) => classifyPortDirection(arrow, center, Math.max(region.extents.width, region.extents.height) * 0.08)).find((value) => value !== 'UNKNOWN') ?? 'UNKNOWN';
      const mdo = buildMdoRecord({
        assetTag: d.asset_tag,
        assetType: d.asset_type,
        description: d.description,
        size: d.size,
        rawPosition: center,
        relationRadius: Math.max(region.extents.width, region.extents.height) * 0.08,
        graph,
        graphTolerance: Math.max(region.extents.width, region.extents.height) * 0.05,
        arrowDirection,
      }, anchors);
      await db.query(
        `INSERT INTO detection_mdo_records
          (detection_id, document_id, tag_no_proposed, equipment_type, component_name, size,
            from_value, to_value, of_value, at_value, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (detection_id) DO UPDATE SET
            tag_no_proposed=EXCLUDED.tag_no_proposed, equipment_type=EXCLUDED.equipment_type,
            component_name=EXCLUDED.component_name, size=EXCLUDED.size,
            from_value=EXCLUDED.from_value, to_value=EXCLUDED.to_value,
            of_value=EXCLUDED.of_value, at_value=EXCLUDED.at_value,
            approval_status = CASE WHEN detection_mdo_records.tag_no_proposed IS NOT DISTINCT FROM EXCLUDED.tag_no_proposed
              AND detection_mdo_records.equipment_type IS NOT DISTINCT FROM EXCLUDED.equipment_type
              AND detection_mdo_records.component_name IS NOT DISTINCT FROM EXCLUDED.component_name
              AND detection_mdo_records.size IS NOT DISTINCT FROM EXCLUDED.size
              AND detection_mdo_records.from_value IS NOT DISTINCT FROM EXCLUDED.from_value
              AND detection_mdo_records.to_value IS NOT DISTINCT FROM EXCLUDED.to_value
              AND detection_mdo_records.of_value IS NOT DISTINCT FROM EXCLUDED.of_value
              AND detection_mdo_records.at_value IS NOT DISTINCT FROM EXCLUDED.at_value
              THEN detection_mdo_records.approval_status ELSE 'PENDING' END,
            approved_at = CASE WHEN detection_mdo_records.tag_no_proposed IS NOT DISTINCT FROM EXCLUDED.tag_no_proposed
              AND detection_mdo_records.equipment_type IS NOT DISTINCT FROM EXCLUDED.equipment_type
              AND detection_mdo_records.component_name IS NOT DISTINCT FROM EXCLUDED.component_name
              AND detection_mdo_records.size IS NOT DISTINCT FROM EXCLUDED.size
              AND detection_mdo_records.from_value IS NOT DISTINCT FROM EXCLUDED.from_value
              AND detection_mdo_records.to_value IS NOT DISTINCT FROM EXCLUDED.to_value
              AND detection_mdo_records.of_value IS NOT DISTINCT FROM EXCLUDED.of_value
              AND detection_mdo_records.at_value IS NOT DISTINCT FROM EXCLUDED.at_value
              THEN detection_mdo_records.approved_at ELSE NULL END,
            approved_by = CASE WHEN detection_mdo_records.tag_no_proposed IS NOT DISTINCT FROM EXCLUDED.tag_no_proposed
              AND detection_mdo_records.equipment_type IS NOT DISTINCT FROM EXCLUDED.equipment_type
              AND detection_mdo_records.component_name IS NOT DISTINCT FROM EXCLUDED.component_name
              AND detection_mdo_records.size IS NOT DISTINCT FROM EXCLUDED.size
              AND detection_mdo_records.from_value IS NOT DISTINCT FROM EXCLUDED.from_value
              AND detection_mdo_records.to_value IS NOT DISTINCT FROM EXCLUDED.to_value
              AND detection_mdo_records.of_value IS NOT DISTINCT FROM EXCLUDED.of_value
              AND detection_mdo_records.at_value IS NOT DISTINCT FROM EXCLUDED.at_value
              THEN detection_mdo_records.approved_by ELSE NULL END,
            updated_at=NOW()`,
         [d.id, documentId, mdo.tagNoProposed, mdo.equipmentType, mdo.componentName, mdo.size,
           mdo.from, mdo.to, mdo.of, mdo.at],
       );
      count++;
    }
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    console.error('[mdo-enrichment]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'MDO enrichment failed' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.query(`SELECT id, detection_id, document_id, tag_no_proposed, equipment_type,
    component_name, size, from_value, to_value, of_value, at_value, approval_status,
    approved_at, approved_by, rejection_reason, created_at, updated_at
    FROM detection_mdo_records WHERE document_id=$1 ORDER BY created_at, id`, [id]);
  return NextResponse.json({ records: rows.rows });
}
