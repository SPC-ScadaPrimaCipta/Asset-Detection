import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { isRiskMappingEditor } from '../../lib/adapters';
import { getConnection, sql } from '../../lib/adapters';
import { savePfdFile, getPdfPageCount } from '../../../lib/pfdStorage';
import { extractPdfTextByPage } from '../../../lib/pdfRender';
import { extractTitleBlock, buildPfdName } from '../../../lib/pfdTitleBlock';
import { enqueueJob } from '../../../lib/jobQueue';

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRiskMappingEditor(session)) {
        return NextResponse.json({ success: false, error: 'Forbidden - editor role required' }, { status: 403 });
    }

    try {
        const formData = await request.formData();
        const assetIdRaw = formData.get('asset_id');
        const autoTag = formData.get('auto_tag') === 'true';
        const assetId = assetIdRaw ? parseInt(String(assetIdRaw)) : NaN;
        if (isNaN(assetId)) {
            return NextResponse.json({ success: false, error: 'Valid asset_id is required' }, { status: 400 });
        }

        const pool = await getConnection();
        const assetCheck = await pool
            .request()
            .input('assetId', sql.Int, assetId)
            .query('SELECT asset_id, asset_name FROM dbo.rbi_asset WHERE asset_id = @assetId');
        if (assetCheck.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'asset_id does not exist' }, { status: 400 });
        }

        const files = formData.getAll('files') as File[];
        if (!files || files.length === 0) {
            return NextResponse.json({ success: false, error: 'At least one PDF file is required' }, { status: 400 });
        }

        const uploadedBy = (session.user as any)?.name || session.user?.email || 'editor';
        const results: Array<{
            file_name: string;
            pfd_id: number;
            public_id: string;
            version_id: number;
            version_no: number;
            pfd_name: string;
            doc_number: string | null;
            job_id: string | null;
            auto_tag_job_id: string | null;
            action: 'new_document' | 'new_version';
        }> = [];

        for (const file of files) {
            if (!file.name.toLowerCase().endsWith('.pdf')) {
                continue;
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (buffer.length > 50 * 1024 * 1024) {
                console.warn(`File ${file.name} exceeds 50MB limit, skipping`);
                continue;
            }

            const pageCount = await getPdfPageCount(buffer);

            // Extract metadata across pages
            let docNumber: string | null = null;
            let drawingRevision: string | null = null;
            let drawingTitle: string | null = null;
            let drawingProject: string | null = null;
            let drawingCompany: string | null = null;
            let drawingJobNo: string | null = null;
            let titleDetected = false;
            let isMultiDrawing = false;
            let titleBlockJson: string | null = null;
            let autoPfdName = file.name.replace(/\.pdf$/i, '');
            let detectedDefaultPage = 1;

            try {
                const { extractMultiPageTitleBlocks, buildPfdName, detectDrawingDefaultPage } = await import('../../../lib/pfdTitleBlock');
                const pageTexts = await extractPdfTextByPage(buffer);
                if (pageTexts.length > 0) {
                    const multiResult = extractMultiPageTitleBlocks(pageTexts);
                    docNumber = multiResult.primary.doc_number;
                    drawingRevision = multiResult.primary.revision;
                    drawingTitle = multiResult.primary.title;
                    drawingProject = multiResult.primary.project;
                    drawingCompany = multiResult.primary.company;
                    drawingJobNo = multiResult.primary.job_no;
                    titleDetected = multiResult.title_detected;
                    isMultiDrawing = multiResult.is_multi_drawing;
                    titleBlockJson = JSON.stringify(multiResult.pages);
                    autoPfdName = buildPfdName(multiResult.primary, file.name);
                    detectedDefaultPage = detectDrawingDefaultPage(pageTexts);
                }
            } catch (err) {
                console.warn(`Could not extract title block for ${file.name}:`, err);
            }

            // Check if document with same doc_number and asset_id already exists
            let existingDoc: { pfd_id: number; public_id: string } | null = null;
            if (docNumber) {
                const existingResult = await pool
                    .request()
                    .input('docNumber', sql.NVarChar(100), docNumber)
                    .input('assetId', sql.Int, assetId)
                    .query(`
                        SELECT TOP 1 pfd_id, public_id
                        FROM dbo.rbi_pfd_document
                        WHERE doc_number = @docNumber AND asset_id = @assetId AND is_deleted = 0
                    `);
                if (existingResult.recordset.length > 0) {
                    existingDoc = existingResult.recordset[0];
                }
            }

            let pfdId: number;
            let publicId: string;
            let versionNo: number;
            let action: 'new_document' | 'new_version';

            if (existingDoc) {
                pfdId = existingDoc.pfd_id;
                publicId = existingDoc.public_id;
                action = 'new_version';

                const maxVersionResult = await pool
                    .request()
                    .input('pfdId', sql.Int, pfdId)
                    .query('SELECT ISNULL(MAX(version_no), 0) + 1 AS next_version_no FROM dbo.rbi_pfd_version WHERE pfd_id = @pfdId');
                versionNo = maxVersionResult.recordset[0].next_version_no;
            } else {
                action = 'new_document';
                versionNo = 1;

                const docInsert = await pool
                    .request()
                    .input('pfd_name', sql.NVarChar(200), autoPfdName)
                    .input('description', sql.NVarChar(1000), 'Batch uploaded P&ID drawing')
                    .input('asset_id', sql.Int, assetId)
                    .input('doc_number', sql.NVarChar(100), docNumber)
                    .input('drawing_revision', sql.NVarChar(20), drawingRevision)
                    .input('drawing_title', sql.NVarChar(300), drawingTitle)
                    .input('drawing_project', sql.NVarChar(300), drawingProject)
                    .input('drawing_company', sql.NVarChar(300), drawingCompany)
                    .input('drawing_job_no', sql.NVarChar(50), drawingJobNo)
                    .input('title_detected', sql.Bit, titleDetected ? 1 : 0)
                    .input('is_multi_drawing', sql.Bit, isMultiDrawing ? 1 : 0)
                    .input('created_by', sql.VarChar(50), uploadedBy)
                    .query(`
                        INSERT INTO dbo.rbi_pfd_document (
                            pfd_name, description, asset_id, doc_number, created_by,
                            drawing_revision, drawing_title, drawing_project, drawing_company, drawing_job_no,
                            title_detected, is_multi_drawing
                        )
                        OUTPUT INSERTED.pfd_id, INSERTED.public_id
                        VALUES (
                            @pfd_name, @description, @asset_id, @doc_number, @created_by,
                            @drawing_revision, @drawing_title, @drawing_project, @drawing_company, @drawing_job_no,
                            @title_detected, @is_multi_drawing
                        )
                    `);
                pfdId = docInsert.recordset[0].pfd_id;
                publicId = docInsert.recordset[0].public_id;
            }

            // Save PDF to storage (synchronous)
            const { relPath, safeName } = await savePfdFile(publicId, versionNo, file.name, buffer);

            // Insert version record
            const versionInsert = await pool
                .request()
                .input('pfd_id', sql.Int, pfdId)
                .input('version_no', sql.Int, versionNo)
                .input('file_name', sql.NVarChar(260), safeName)
                .input('file_path', sql.NVarChar(500), relPath)
                .input('file_size', sql.BigInt, buffer.length)
                .input('page_count', sql.Int, pageCount)
                .input('default_page', sql.Int, detectedDefaultPage)
                .input('uploaded_by', sql.VarChar(50), uploadedBy)
                .input('title_block_json', sql.NVarChar(sql.MAX), titleBlockJson)
                .query(`
                    INSERT INTO dbo.rbi_pfd_version (pfd_id, version_no, file_name, file_path, file_size, page_count, default_page, uploaded_by, title_block_json)
                    OUTPUT INSERTED.version_id
                    VALUES (@pfd_id, @version_no, @file_name, @file_path, @file_size, @page_count, @default_page, @uploaded_by, @title_block_json)
                `);
            const versionId = versionInsert.recordset[0].version_id;

            // Update current_version_id
            const updateDocReq = pool
                .request()
                .input('version_id', sql.Int, versionId)
                .input('pfd_id', sql.Int, pfdId);

            let updateDocSql = 'UPDATE dbo.rbi_pfd_document SET current_version_id = @version_id';
            if (drawingRevision) {
                updateDocReq.input('drawing_revision', sql.NVarChar(20), drawingRevision);
                updateDocSql += ', drawing_revision = @drawing_revision';
            }
            updateDocSql += ' WHERE pfd_id = @pfd_id';
            await updateDocReq.query(updateDocSql);

            // Enqueue background text indexing job
            let jobId: string | null = null;
            try {
                jobId = await enqueueJob('TEXT_INDEX', { version_id: versionId }, versionId, uploadedBy, pool);
            } catch (jobErr) {
                console.error(`Failed to enqueue TEXT_INDEX job for version #${versionId}:`, jobErr);
            }

            // Enqueue auto-detect & auto-tagging job if toggle enabled
            let autoTagJobId: string | null = null;
            if (autoTag) {
                try {
                    autoTagJobId = await enqueueJob(
                        'AUTO_DETECT',
                        { version_id: versionId, root_asset_id: assetId, confirm_all: true },
                        versionId,
                        uploadedBy,
                        pool
                    );
                } catch (autoErr) {
                    console.error(`Failed to enqueue AUTO_DETECT job for version #${versionId}:`, autoErr);
                }
            }

            results.push({
                file_name: file.name,
                pfd_id: pfdId,
                public_id: publicId,
                version_id: versionId,
                version_no: versionNo,
                pfd_name: autoPfdName,
                doc_number: docNumber,
                job_id: jobId,
                auto_tag_job_id: autoTagJobId,
                action,
            });
        }

        return NextResponse.json({
            success: true,
            files_processed: results.length,
            results,
        });
    } catch (error: any) {
        console.error('Batch upload error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Batch upload failed' }, { status: 500 });
    }
}




