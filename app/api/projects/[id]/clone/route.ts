import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getCurrentUser, generateShareCode, isPrivileged } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceProjectId } = await params;
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Silakan login terlebih dahulu untuk meng-clone project' }, { status: 401 });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch source project
    const projRes = await client.query('SELECT * FROM projects WHERE id = $1', [sourceProjectId]);
    if (projRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Project sumber tidak ditemukan' }, { status: 404 });
    }
    const srcProj = projRes.rows[0];

    // Check visibility / permission
    if (srcProj.visibility === 'PRIVATE' && srcProj.owner_id && srcProj.owner_id !== user.id && !isPrivileged(user)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Tidak memiliki izin untuk meng-clone project private ini' }, { status: 403 });
    }

    let customName: string | undefined;
    try {
      const body = await request.json();
      if (typeof body.name === 'string' && body.name.trim()) customName = body.name.trim();
    } catch {}

    const newProjectId = uuidv4();
    const newProjectName = customName || `${srcProj.name} (Copy)`;
    const newShareCode = generateShareCode();

    // 2. Insert new cloned project
    await client.query(
      `INSERT INTO projects (id, name, description, owner_id, visibility, share_code, cloned_from_id)
       VALUES ($1, $2, $3, $4, 'PRIVATE', $5, $6)`,
      [newProjectId, newProjectName, srcProj.description, user.id, newShareCode, sourceProjectId]
    );

    // 3. Clone custom project legends (if any)
    const legRes = await client.query('SELECT * FROM legends WHERE project_id = $1', [sourceProjectId]);
    const legendMap = new Map<string, string>(); // oldLegendId -> newLegendId

    for (const leg of legRes.rows) {
      const newLegendId = uuidv4();
      legendMap.set(leg.id, newLegendId);

      await client.query(
        `INSERT INTO legends (id, name, description, status, standard_code, is_builtin, project_id, owner_id, visibility)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, 'PRIVATE')`,
        [newLegendId, `${leg.name} (Copy)`, leg.description, leg.status, leg.standard_code, newProjectId, user.id]
      );

      // Clone symbols
      const symRes = await client.query('SELECT * FROM legend_symbols WHERE legend_id = $1', [leg.id]);
      for (const sym of symRes.rows) {
        await client.query(
          `INSERT INTO legend_symbols (
             id, legend_id, asset_type, symbol_name, tag_pattern, description,
             aliases, status, standard_code, isa_function_code, iso_category,
             bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            uuidv4(),
            newLegendId,
            sym.asset_type,
            sym.symbol_name,
            sym.tag_pattern,
            sym.description,
            sym.aliases,
            sym.status,
            sym.standard_code,
            sym.isa_function_code,
            sym.iso_category,
            sym.bbox_x,
            sym.bbox_y,
            sym.bbox_w,
            sym.bbox_h,
            sym.pid_page,
            sym.reference_image_url,
            sym.reference_crop_hash,
          ]
        );
      }
    }

    // 4. Clone documents & document_pages
    const docRes = await client.query('SELECT * FROM documents WHERE project_id = $1', [sourceProjectId]);
    const docMap = new Map<string, string>(); // oldDocId -> newDocId
    const pageMap = new Map<string, string>(); // oldPageId -> newPageId

    for (const doc of docRes.rows) {
      const newDocId = uuidv4();
      docMap.set(doc.id, newDocId);

      await client.query(
        `INSERT INTO documents (id, project_id, filename, file_path, page_count, mime_type, file_size, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newDocId, newProjectId, doc.filename, doc.file_path, doc.page_count, doc.mime_type, doc.file_size, doc.status]
      );

      // Clone pages
      const pageRes = await client.query('SELECT * FROM document_pages WHERE document_id = $1', [doc.id]);
      for (const page of pageRes.rows) {
        const newPageId = uuidv4();
        pageMap.set(page.id, newPageId);

        await client.query(
          `INSERT INTO document_pages (id, document_id, page_number, image_path, width, height)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newPageId, newDocId, page.page_number, page.image_path, page.width, page.height]
        );
      }
    }

    // 5. Clone detection jobs and detections
    const jobRes = await client.query('SELECT * FROM detection_jobs WHERE project_id = $1', [sourceProjectId]);
    for (const job of jobRes.rows) {
      const newJobId = uuidv4();
      const mappedDocId = docMap.get(job.document_id);
      if (!mappedDocId) continue;

      const mappedLegendId = job.legend_id ? (legendMap.get(job.legend_id) || job.legend_id) : null;
      const mappedLegendIds = Array.isArray(job.legend_ids)
        ? job.legend_ids.map((lid: string) => legendMap.get(lid) || lid)
        : null;

      await client.query(
        `INSERT INTO detection_jobs (id, document_id, legend_id, legend_ids, project_id, status, progress_pct, error_detail, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          newJobId,
          mappedDocId,
          mappedLegendId,
          mappedLegendIds,
          newProjectId,
          job.status,
          job.progress_pct,
          job.error_detail,
          job.started_at,
          job.completed_at,
        ]
      );

      // Clone detections
      const detRes = await client.query('SELECT * FROM detections WHERE job_id = $1', [job.id]);
      for (const det of detRes.rows) {
        const mappedPageId = det.document_page_id ? pageMap.get(det.document_page_id) : null;
        const mappedDetLegendId = det.legend_id ? (legendMap.get(det.legend_id) || det.legend_id) : null;

        await client.query(
          `INSERT INTO detections (
             id, job_id, document_id, document_page_id, asset_tag, asset_type,
             description, confidence, bbox_x, bbox_y, bbox_w, bbox_h,
             legend_symbol_id, evidence, status, legend_id, tag_confidence,
             tag_verified, tag_format_valid, validation_status, validation_notes,
             component_name, mdo_confidence, mdo_suggested_tag, mdo_approved
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
          [
            uuidv4(),
            newJobId,
            mappedDocId,
            mappedPageId,
            det.asset_tag,
            det.asset_type,
            det.description,
            det.confidence,
            det.bbox_x,
            det.bbox_y,
            det.bbox_w,
            det.bbox_h,
            det.legend_symbol_id,
            det.evidence,
            det.status,
            mappedDetLegendId,
            det.tag_confidence,
            det.tag_verified,
            det.tag_format_valid,
            det.validation_status,
            det.validation_notes,
            det.component_name,
            det.mdo_confidence,
            det.mdo_suggested_tag,
            det.mdo_approved,
          ]
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({
      id: newProjectId,
      name: newProjectName,
      message: 'Project berhasil di-clone ke Private Workspace Anda!',
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[projects/[id]/clone POST]', err);
    return NextResponse.json({ error: err.message || 'Gagal meng-clone project' }, { status: 500 });
  } finally {
    client.release();
  }
}
