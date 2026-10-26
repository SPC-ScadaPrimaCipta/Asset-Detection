import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      documentId,
      pidPage,
      assetTag,
      assetType,
      description,
      service,
      size,
      equipmentClass,
      bbox,
    } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }
    if (!assetTag || !assetTag.trim()) {
      return NextResponse.json({ error: 'Asset Tag is required' }, { status: 400 });
    }
    if (!assetType || !assetType.trim()) {
      return NextResponse.json({ error: 'Asset Type is required' }, { status: 400 });
    }

    const docRes = await db.query('SELECT project_id, filename FROM documents WHERE id = $1', [documentId]);
    if (docRes.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const projectId = docRes.rows[0].project_id;
    const pidNumber = docRes.rows[0].filename;

    const pageNum = pidPage ? Number(pidPage) : 1;
    const pageRes = await db.query(
      'SELECT id FROM document_pages WHERE document_id = $1 AND page_number = $2',
      [documentId, pageNum]
    );
    const documentPageId = pageRes.rows[0]?.id ?? null;

    const detectionId = crypto.randomUUID();
    const x = bbox?.x != null ? Math.round(Number(bbox.x)) : 500;
    const y = bbox?.y != null ? Math.round(Number(bbox.y)) : 500;
    const w = bbox?.width != null ? Math.max(10, Math.round(Number(bbox.width))) : 50;
    const h = bbox?.height != null ? Math.max(10, Math.round(Number(bbox.height))) : 50;

    const cleanTag = assetTag.trim().toUpperCase();
    const cleanType = assetType.trim();
    const cleanDesc = description?.trim() || null;
    const cleanService = service?.trim() || null;
    const cleanSize = size?.trim() || null;
    const cleanClass = equipmentClass?.trim() || cleanType;

    const insertDetectionSql = `
      INSERT INTO detections (
        id, document_id, document_page_id,
        asset_tag, asset_type, equipment_class,
        description, service, size,
        pid_number, pid_page,
        confidence, detection_status, review_status,
        detection_source,
        bbox_x, bbox_y, bbox_w, bbox_h,
        evidence,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9,
        $10, $11,
        1.0, 'MANUAL', 'APPROVED',
        'MANUAL_USER',
        $12, $13, $14, $15,
        $16,
        NOW(), NOW()
      )
      RETURNING *;
    `;

    const evidence = [{ source: 'manual', note: 'Created manually by user via P&ID interactive viewer' }];

    const detectionRes = await db.query(insertDetectionSql, [
      detectionId,
      documentId,
      documentPageId,
      cleanTag,
      cleanType,
      cleanClass,
      cleanDesc,
      cleanService,
      cleanSize,
      pidNumber,
      pageNum,
      x,
      y,
      w,
      h,
      JSON.stringify(evidence),
    ]);

    const createdDetection = detectionRes.rows[0];

    // Also mirror to assets table for historical consistency
    try {
      const assetId = crypto.randomUUID();
      await db.query(
        `INSERT INTO assets (
          id, project_id, document_id, detection_id,
          asset_tag, asset_type, equipment_class,
          description, service, pid_number, pid_page,
          confidence, detection_status, review_status,
          bbox_x, bbox_y, bbox_w, bbox_h, size, evidence
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11,
          1.0, 'MANUAL', 'APPROVED',
          $12, $13, $14, $15, $16, $17
        ) ON CONFLICT (detection_id) DO NOTHING`,
        [
          assetId,
          projectId,
          documentId,
          detectionId,
          cleanTag,
          cleanType,
          cleanClass,
          cleanDesc,
          cleanService,
          pidNumber,
          pageNum,
          x,
          y,
          w,
          h,
          cleanSize,
          JSON.stringify(evidence),
        ]
      );
    } catch (assetErr) {
      console.warn('[detections/manual] mirror to assets skipped:', assetErr);
    }

    // Record audit entry
    try {
      await db.query(
        `INSERT INTO detection_audits (detection_id, action, new_values)
         VALUES ($1, 'MANUAL_CREATE', $2)`,
        [detectionId, JSON.stringify(createdDetection)]
      );
    } catch (auditErr) {
      console.warn('[detections/manual] audit log skipped:', auditErr);
    }

    return NextResponse.json({ success: true, data: createdDetection }, { status: 201 });
  } catch (error: any) {
    console.error('[detections/manual POST]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
