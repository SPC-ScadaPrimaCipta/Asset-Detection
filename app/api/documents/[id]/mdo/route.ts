import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';
import { buildMdoRecord, buildPdfMdoRecord, buildDxfMdoRecordWithFlowAnalysis } from '@/lib/mdo-enrichment';
import { buildPidGraph, classifyPortDirection, detectArrowheads } from '@/lib/pid-graph';
import { renderPageToPng } from '@/lib/pdf-render';
import { getDocumentTextTokens } from '@/lib/text-tokens';
import { analyzePdfProcessFlowWithAi } from '@/lib/mdo-ai-analyzer';

const UPSERT_MDO_SQL = `
  INSERT INTO detection_mdo_records
    (detection_id, document_id, location_prefix, tag_no_proposed,
     equipment_type_short, equipment_name, size,
     from_value, to_value, of_value, description,
     equipment_type, component_name, at_value, updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
   ON CONFLICT (detection_id) DO UPDATE SET
      location_prefix=EXCLUDED.location_prefix,
      tag_no_proposed=EXCLUDED.tag_no_proposed,
      equipment_type_short=EXCLUDED.equipment_type_short,
      equipment_name=EXCLUDED.equipment_name,
      size=EXCLUDED.size,
      from_value=EXCLUDED.from_value,
      to_value=EXCLUDED.to_value,
      of_value=EXCLUDED.of_value,
      description=EXCLUDED.description,
      equipment_type=EXCLUDED.equipment_type,
      component_name=EXCLUDED.component_name,
      at_value=EXCLUDED.at_value,
      updated_at=NOW()
`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: documentId } = await params;
    const body = await req.json().catch(() => ({}));
    const locationPrefix: string | null = body?.locationPrefix ?? null;

    const doc = (await db.query('SELECT id, file_type, file_path FROM documents WHERE id=$1', [documentId])).rows[0];
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    if (doc.file_type !== 'dxf' && doc.file_type !== 'pdf') {
      return NextResponse.json({ error: 'MDO enrichment supports DXF and PDF files' }, { status: 400 });
    }

    const detections = (await db.query<{
      id: string;
      asset_tag: string | null;
      asset_type: string;
      description: string | null;
      size: string | null;
      pid_page: number | null;
      bbox_x: number | null;
      bbox_y: number | null;
      bbox_w: number | null;
      bbox_h: number | null;
    }>(
      `SELECT id, asset_tag, asset_type, description, size, pid_page, bbox_x, bbox_y, bbox_w, bbox_h
       FROM detections
       WHERE document_id=$1
         AND (review_status = 'APPROVED' OR detection_status IN ('CONFIRMED', 'MANUAL'))
         AND detection_status != 'REJECTED'
         AND review_status != 'REJECTED'
         AND (candidate_status IS NULL OR candidate_status != 'NOISE')`,
      [documentId],
    )).rows;

    // Remove any stale MDO records whose detections are no longer approved or have been rejected
    await db.query(
      `DELETE FROM detection_mdo_records
       WHERE document_id = $1
         AND detection_id NOT IN (
           SELECT id FROM detections
           WHERE document_id = $1
             AND (review_status = 'APPROVED' OR detection_status IN ('CONFIRMED', 'MANUAL'))
             AND detection_status != 'REJECTED'
             AND review_status != 'REJECTED'
         )`,
      [documentId]
    );

    let count = 0;
    const buf = (await getFile(doc.file_path)) as Buffer;

    if (doc.file_type === 'dxf') {
      const parsed = parseDxf(buf);
      const regions = splitDxfRegions(parsed);

      console.log('[mdo-dxf] Document:', doc.id);
      console.log('[mdo-dxf] Parsed entities:', parsed.entities.length);
      console.log('[mdo-dxf] Regions:', regions.length);
      console.log('[mdo-dxf] Extents:', JSON.stringify(parsed.extents));
      console.log('[mdo-dxf] Detections to process:', detections.length);

      // Prepare all detections with bbox for flow analysis
      const allDetections = detections.map((d) => {
        const region = regions.find((r) => r.index + 1 === (d.pid_page ?? 1)) ?? regions[0];
        if (!region) return null;
        const x = d.bbox_x == null ? 500 : d.bbox_x;
        const y = d.bbox_y == null ? 500 : d.bbox_y;
        const w = d.bbox_w == null ? 100 : d.bbox_w;
        const h = d.bbox_h == null ? 100 : d.bbox_h;
        const centerX = region.extents.minX + (x / 1000) * region.extents.width;
        const centerY = region.extents.maxY - (y / 1000) * region.extents.height;
        const halfW = (w / 1000) * region.extents.width / 2;
        const halfH = (h / 1000) * region.extents.height / 2;
        return {
          assetTag: d.asset_tag,
          assetType: d.asset_type,
          description: d.description,
          bbox: {
            x: centerX - halfW,
            y: centerY - halfH,
            width: halfW * 2,
            height: halfH * 2,
          },
        };
      }).filter((x): x is NonNullable<typeof x> => x !== null);

      for (const d of detections) {
        const region = regions.find((r) => r.index + 1 === (d.pid_page ?? 1)) ?? regions[0];
        if (!region) continue;
        const x = d.bbox_x == null ? 500 : d.bbox_x;
        const y = d.bbox_y == null ? 500 : d.bbox_y;
        const w = d.bbox_w == null ? 100 : d.bbox_w;
        const h = d.bbox_h == null ? 100 : d.bbox_h;
        const centerX = region.extents.minX + (x / 1000) * region.extents.width;
        const centerY = region.extents.maxY - (y / 1000) * region.extents.height;
        const halfW = (w / 1000) * region.extents.width / 2;
        const halfH = (h / 1000) * region.extents.height / 2;
        
        console.log(`[mdo-dxf] Processing: ${d.asset_tag} @ normalized (${x}, ${y}) → DXF (${centerX.toFixed(1)}, ${centerY.toFixed(1)})`);
        
        const anchors = region.entities
          .filter((e): e is Extract<typeof e, { kind: 'TEXT' | 'MTEXT' }> => e.kind === 'TEXT' || e.kind === 'MTEXT')
          .map((e) => ({ text: e.text, x: e.position.x, y: e.position.y }));

        console.log(`[mdo-dxf] Anchors near ${d.asset_tag}: ${anchors.length} text entities`);

        const mdo = await buildDxfMdoRecordWithFlowAnalysis({
          detection: {
            assetTag: d.asset_tag,
            assetType: d.asset_type,
            description: d.description,
            size: d.size,
            bbox: {
              x: centerX - halfW,
              y: centerY - halfH,
              width: halfW * 2,
              height: halfH * 2,
            },
          },
          dxfData: parsed,
          allDetections,
          anchors,
          locationPrefix,
        });

        console.log(`[mdo-dxf] Result for ${d.asset_tag}:`, {
          from: mdo.from,
          to: mdo.to,
          of: mdo.of,
          at: mdo.at,
          size: mdo.size,
        });

        await db.query(UPSERT_MDO_SQL, [
          d.id, documentId, locationPrefix, mdo.tagNoProposed,
          mdo.equipmentTypeShort, mdo.equipmentName, mdo.size,
          mdo.from, mdo.to, mdo.of, mdo.description,
          mdo.equipmentType, mdo.componentName, mdo.at,
        ]);
        count++;
      }
    } else {
      // PDF Flow with Vision AI Process Flow
      const pageGroups = new Map<number, typeof detections>();
      for (const d of detections) {
        const pageNum = d.pid_page ?? 1;
        const list = pageGroups.get(pageNum) || [];
        list.push(d);
        pageGroups.set(pageNum, list);
      }

      for (const [pageNum, pageDets] of pageGroups.entries()) {
        let pageB64 = '';
        try {
          const { png } = await renderPageToPng(buf, pageNum, 2.0);
          pageB64 = png.toString('base64');
        } catch (rErr) {
          console.warn(`[mdo-route] page ${pageNum} PNG render failed:`, rErr);
        }

        let anchors: Array<{ text: string; x: number; y: number }> = [];
        try {
          const tokens = await getDocumentTextTokens(documentId, pageNum);
          anchors = tokens.map((t) => ({ text: t.text, x: t.x, y: t.y }));
        } catch {
          /* ignore spatial token failure */
        }

        let aiRelations = new Map<string, import('@/lib/mdo-ai-analyzer').MdoFlowRelation>();
        if (pageB64) {
          const targetAssets = pageDets.map((d) => ({
            assetTag: d.asset_tag,
            assetType: d.asset_type,
            description: d.description,
            bboxNorm: {
              x: d.bbox_x ?? 500,
              y: d.bbox_y ?? 500,
              width: d.bbox_w ?? 50,
              height: d.bbox_h ?? 50,
            },
          }));
          aiRelations = await analyzePdfProcessFlowWithAi({
            pageImageBase64: pageB64,
            assets: targetAssets,
          });
        }

        for (const d of pageDets) {
          const normTag = (d.asset_tag ?? '').toUpperCase();
          const aiRel = aiRelations.get(normTag) ?? null;
          const mdo = buildPdfMdoRecord({
            detection: {
              id: d.id,
              assetTag: d.asset_tag,
              assetType: d.asset_type,
              description: d.description,
              size: d.size,
              pidPage: pageNum,
              bboxNorm: {
                x: d.bbox_x ?? 500,
                y: d.bbox_y ?? 500,
                width: d.bbox_w ?? 50,
                height: d.bbox_h ?? 50,
              },
            },
            anchors,
            aiRelation: aiRel,
            relationRadiusNorm: 250,
            locationPrefix,
          });

          await db.query(UPSERT_MDO_SQL, [
            d.id, documentId, locationPrefix, mdo.tagNoProposed,
            mdo.equipmentTypeShort, mdo.equipmentName, mdo.size,
            mdo.from, mdo.to, mdo.of, mdo.description,
            mdo.equipmentType, mdo.componentName, mdo.at,
          ]);
          count++;
        }
      }
    }

    return NextResponse.json({ ok: true, count });
  } catch (error) {
    console.error('[mdo-route]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'MDO enrichment failed' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;

  // 1. Clean up any MDO records for detections that are no longer approved or rejected
  await db.query(
    `DELETE FROM detection_mdo_records
     WHERE document_id = $1
       AND detection_id NOT IN (
         SELECT id FROM detections
         WHERE document_id = $1
           AND (review_status = 'APPROVED' OR detection_status IN ('CONFIRMED', 'MANUAL'))
           AND detection_status != 'REJECTED'
           AND review_status != 'REJECTED'
       )`,
    [documentId]
  );

  // 2. Auto-seed any missing approved detections that don't have an MDO record yet
  const missingDetections = (await db.query<{
    id: string;
    asset_tag: string | null;
    asset_type: string;
    description: string | null;
    size: string | null;
    service: string | null;
  }>(
    `SELECT d.id, d.asset_tag, d.asset_type, d.description, d.size, d.service
     FROM detections d
     WHERE d.document_id = $1
       AND (d.review_status = 'APPROVED' OR d.detection_status IN ('CONFIRMED', 'MANUAL'))
       AND d.detection_status != 'REJECTED'
       AND d.review_status != 'REJECTED'
       AND (d.candidate_status IS NULL OR d.candidate_status != 'NOISE')
       AND d.id NOT IN (
         SELECT detection_id FROM detection_mdo_records WHERE document_id = $1
       )`,
    [documentId]
  )).rows;

  if (missingDetections.length > 0) {
    const existingPrefixRow = (await db.query<{ location_prefix: string | null }>(
      'SELECT location_prefix FROM detection_mdo_records WHERE document_id = $1 AND location_prefix IS NOT NULL LIMIT 1',
      [documentId]
    )).rows[0];
    const prefix = existingPrefixRow?.location_prefix || 'GRS';

    const { deriveEquipmentNaming } = await import('@/lib/mdo-enrichment');
    const { assembleMdoDescription } = await import('@/lib/mdo-description');

    for (const d of missingDetections) {
      const naming = deriveEquipmentNaming(d.asset_type, d.asset_tag, d.description);
      const ofVal = d.service || (d.description?.toUpperCase().includes('LINE') || d.description?.toUpperCase().includes('HEADER') ? d.description : null);
      const desc = assembleMdoDescription({
        locationPrefix: prefix,
        equipmentTypeShort: naming.shortType,
        size: d.size,
        ofValue: ofVal,
      });

      await db.query(
        `INSERT INTO detection_mdo_records
          (detection_id, document_id, location_prefix, tag_no_proposed,
           equipment_type_short, equipment_name, size,
           of_value, description, equipment_type, component_name, approval_status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'APPROVED',NOW())
         ON CONFLICT (detection_id) DO NOTHING`,
        [
          d.id, documentId, prefix, d.asset_tag,
          naming.shortType, naming.equipmentName, d.size,
          ofVal, desc, d.asset_type.toUpperCase(), d.description,
        ]
      );
    }
  }

  // 3. Query all synced MDO records
  const rows = await db.query(
    `SELECT m.id, m.detection_id, m.document_id, m.location_prefix,
            m.tag_no_proposed, m.equipment_type_short, m.equipment_name, m.size,
            m.from_value, m.to_value, m.of_value, m.at_value, m.description,
            m.approval_status, m.approved_at, m.approved_by, m.rejection_reason,
            d.asset_tag, d.asset_type, d.confidence, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h, d.pid_page,
            m.created_at, m.updated_at
     FROM detection_mdo_records m
     JOIN detections d ON d.id = m.detection_id
     WHERE m.document_id=$1
       AND (d.review_status = 'APPROVED' OR d.detection_status IN ('CONFIRMED', 'MANUAL'))
       AND d.detection_status != 'REJECTED'
       AND d.review_status != 'REJECTED'
     ORDER BY m.created_at, m.id`,
    [documentId],
  );

  return NextResponse.json(
    { records: rows.rows },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}
