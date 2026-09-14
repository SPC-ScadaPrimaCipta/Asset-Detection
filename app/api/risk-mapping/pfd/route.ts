import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { isRiskMappingEditor } from '../../lib/adapters';
import { getConnection, sql } from '../../lib/adapters';
import { savePfdFile, getPdfPageCount, clampDefaultPage } from '../../../lib/pfdStorage';
import { handleRiskMappingApiError } from '../../../lib/riskMappingApiError';
import { getWorkerStatus } from '../../../lib/jobQueue';

// GET: list PFD documents (not deleted), optional ?asset_id= and ?search= filters
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const pool = await getConnection();
        const searchParams = request.nextUrl.searchParams;
        const assetId = searchParams.get('asset_id');
        const search = searchParams.get('search');

        const req = pool.request();
        let where = 'WHERE d.is_deleted = 0';
        if (assetId) {
            req.input('assetId', sql.Int, parseInt(assetId));
            where += ' AND d.asset_id = @assetId';
        }
        if (search) {
            req.input('search', sql.NVarChar, `%${search}%`);
            where += ' AND d.pfd_name LIKE @search';
        }

        const [result, worker] = await Promise.all([
            req.query(`
                SELECT
                    d.pfd_id, d.public_id, d.pfd_name, d.description, d.asset_id, a.asset_name,
                    d.current_version_id, d.doc_number, d.drawing_revision, d.drawing_title,
                    d.drawing_project, d.drawing_company, d.drawing_job_no, d.title_detected, d.is_multi_drawing,
                    d.created_by, d.created_at, d.updated_by, d.updated_at, d.default_rbim_id,
                    (SELECT TOP 1 m.[Name] FROM dbo.RBI_Model m WHERE m.RBIM_ID = d.default_rbim_id) AS default_model_name,
                    v.version_no, v.file_name, v.page_count, v.default_page, v.uploaded_at, v.title_block_json,
                    CASE 
                        WHEN v.file_path LIKE 'sp:%' THEN 'sharepoint'
                        WHEN v.file_path LIKE 's3:%' THEN 's3'
                        ELSE 'local'
                    END AS storage_backend,
                    (SELECT COUNT(*) FROM dbo.rbi_pfd_page_text pt WHERE pt.version_id = d.current_version_id) AS indexed_pages,
                    (SELECT COUNT(*) FROM dbo.rbi_pfd_asset_map m WHERE m.version_id = d.current_version_id) AS tagged_assets_count,
                    (
                        SELECT TOP 1 bj.status
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.job_type = 'TEXT_INDEX' AND bj.ref_id = d.current_version_id
                        ORDER BY bj.created_at DESC
                    ) AS index_job_status,
                    (
                        SELECT TOP 1 bj.progress_pct
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.job_type = 'TEXT_INDEX' AND bj.ref_id = d.current_version_id
                        ORDER BY bj.created_at DESC
                    ) AS index_job_progress,
                    (
                        SELECT TOP 1 CAST(bj.job_id AS VARCHAR(36))
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.job_type = 'TEXT_INDEX' AND bj.ref_id = d.current_version_id
                        ORDER BY bj.created_at DESC
                    ) AS index_job_id,
                    (
                        SELECT TOP 1 bj.job_type
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.ref_id = d.current_version_id
                        ORDER BY CASE WHEN bj.status IN ('RUNNING', 'PENDING') THEN 0 ELSE 1 END, bj.created_at DESC
                    ) AS latest_job_type,
                    (
                        SELECT TOP 1 bj.status
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.ref_id = d.current_version_id
                        ORDER BY CASE WHEN bj.status IN ('RUNNING', 'PENDING') THEN 0 ELSE 1 END, bj.created_at DESC
                    ) AS latest_job_status,
                    (
                        SELECT TOP 1 bj.progress_pct
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.ref_id = d.current_version_id
                        ORDER BY CASE WHEN bj.status IN ('RUNNING', 'PENDING') THEN 0 ELSE 1 END, bj.created_at DESC
                    ) AS latest_job_progress,
                    (
                        SELECT TOP 1 bj.message
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.ref_id = d.current_version_id
                        ORDER BY CASE WHEN bj.status IN ('RUNNING', 'PENDING') THEN 0 ELSE 1 END, bj.created_at DESC
                    ) AS latest_job_message,
                    (
                        SELECT TOP 1 CAST(bj.job_id AS VARCHAR(36))
                        FROM dbo.rbi_bg_job bj
                        WHERE bj.ref_id = d.current_version_id
                        ORDER BY CASE WHEN bj.status IN ('RUNNING', 'PENDING') THEN 0 ELSE 1 END, bj.created_at DESC
                    ) AS latest_job_id
                FROM dbo.rbi_pfd_document d
                LEFT JOIN dbo.rbi_asset a ON a.asset_id = d.asset_id
                LEFT JOIN dbo.rbi_pfd_version v ON v.version_id = d.current_version_id
                ${where}
                ORDER BY d.pfd_name
            `),
            getWorkerStatus(pool),
        ]);

        return NextResponse.json({ success: true, data: result.recordset, worker });
    } catch (error: any) {
        console.error('PFD list error:', error);
        return handleRiskMappingApiError(error, 'PFD list error');
    }
}

// POST: create a new PFD document + its first version (multipart: pfd_name, description?, asset_id, file)
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
        const pfdName = formData.get('pfd_name');
        const description = formData.get('description');
        const assetIdRaw = formData.get('asset_id');
        const file = formData.get('file') as File | null;
        const defaultPageRaw = formData.get('default_page');

        if (!pfdName || typeof pfdName !== 'string' || !pfdName.trim()) {
            return NextResponse.json({ success: false, error: 'pfd_name is required' }, { status: 400 });
        }
        if (!assetIdRaw) {
            return NextResponse.json({ success: false, error: 'asset_id is required' }, { status: 400 });
        }
        const assetId = parseInt(String(assetIdRaw));
        if (isNaN(assetId)) {
            return NextResponse.json({ success: false, error: 'asset_id must be an integer' }, { status: 400 });
        }
        if (!file || !(file instanceof File)) {
            return NextResponse.json({ success: false, error: 'PDF file is required' }, { status: 400 });
        }
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            return NextResponse.json({ success: false, error: 'File must be a PDF' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const pageCount = await getPdfPageCount(buffer);
        const explicitDefaultPage = defaultPageRaw ? parseInt(String(defaultPageRaw)) : null;
        let defaultPage = explicitDefaultPage && !isNaN(explicitDefaultPage) ? clampDefaultPage(explicitDefaultPage, pageCount) : 1;

        const pool = await getConnection();
        const uploadedBy = (session.user as any)?.name || session.user?.email || 'unknown';

        const assetCheck = await pool.request().input('assetId', sql.Int, assetId).query('SELECT asset_id FROM dbo.rbi_asset WHERE asset_id = @assetId');
        if (assetCheck.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'asset_id does not exist' }, { status: 400 });
        }

        // Extract title block metadata across all pages if available
        let docNumber: string | null = null;
        let drawingRevision: string | null = null;
        let drawingTitle: string | null = null;
        let drawingProject: string | null = null;
        let drawingCompany: string | null = null;
        let drawingJobNo: string | null = null;
        let titleDetected = false;
        let isMultiDrawing = false;
        let titleBlockJson: string | null = null;

        try {
            const { extractPdfTextByPage } = await import('../../../lib/pdfRender');
            const { extractMultiPageTitleBlocks, detectDrawingDefaultPage } = await import('../../../lib/pfdTitleBlock');
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

                if (!explicitDefaultPage && pageCount > 1) {
                    defaultPage = clampDefaultPage(detectDrawingDefaultPage(pageTexts), pageCount);
                }
            }
        } catch (e) {
            console.warn('Could not extract title block metadata on upload:', e);
        }

        const docInsert = await pool
            .request()
            .input('pfd_name', sql.NVarChar(200), pfdName.trim())
            .input('description', sql.NVarChar(1000), description ? String(description).trim() : null)
            .input('asset_id', sql.Int, assetId)
            .input('created_by', sql.VarChar(50), uploadedBy)
            .input('doc_number', sql.NVarChar(100), docNumber)
            .input('drawing_revision', sql.NVarChar(20), drawingRevision)
            .input('drawing_title', sql.NVarChar(300), drawingTitle)
            .input('drawing_project', sql.NVarChar(300), drawingProject)
            .input('drawing_company', sql.NVarChar(300), drawingCompany)
            .input('drawing_job_no', sql.NVarChar(50), drawingJobNo)
            .input('title_detected', sql.Bit, titleDetected ? 1 : 0)
            .input('is_multi_drawing', sql.Bit, isMultiDrawing ? 1 : 0)
            .query(`
                INSERT INTO dbo.rbi_pfd_document (
                    pfd_name, description, asset_id, created_by, doc_number,
                    drawing_revision, drawing_title, drawing_project, drawing_company, drawing_job_no,
                    title_detected, is_multi_drawing
                )
                OUTPUT INSERTED.pfd_id, INSERTED.public_id
                VALUES (
                    @pfd_name, @description, @asset_id, @created_by, @doc_number,
                    @drawing_revision, @drawing_title, @drawing_project, @drawing_company, @drawing_job_no,
                    @title_detected, @is_multi_drawing
                )
            `);
        const pfdId = docInsert.recordset[0].pfd_id;
        const publicId = docInsert.recordset[0].public_id;

        const { relPath, safeName } = await savePfdFile(publicId, 1, file.name, buffer);

        const versionInsert = await pool
            .request()
            .input('pfd_id', sql.Int, pfdId)
            .input('version_no', sql.Int, 1)
            .input('file_name', sql.NVarChar(260), safeName)
            .input('file_path', sql.NVarChar(500), relPath)
            .input('file_size', sql.BigInt, buffer.length)
            .input('page_count', sql.Int, pageCount)
            .input('default_page', sql.Int, defaultPage)
            .input('uploaded_by', sql.VarChar(50), uploadedBy)
            .input('title_block_json', sql.NVarChar(sql.MAX), titleBlockJson)
            .query(`
                INSERT INTO dbo.rbi_pfd_version (pfd_id, version_no, file_name, file_path, file_size, page_count, default_page, uploaded_by, title_block_json)
                OUTPUT INSERTED.version_id
                VALUES (@pfd_id, @version_no, @file_name, @file_path, @file_size, @page_count, @default_page, @uploaded_by, @title_block_json)
            `);
        const versionId = versionInsert.recordset[0].version_id;

        await pool
            .request()
            .input('version_id', sql.Int, versionId)
            .input('pfd_id', sql.Int, pfdId)
            .query('UPDATE dbo.rbi_pfd_document SET current_version_id = @version_id WHERE pfd_id = @pfd_id');

        // Enqueue background text indexing job
        let jobId: string | null = null;
        try {
            const { enqueueJob } = await import('../../../lib/jobQueue');
            jobId = await enqueueJob('TEXT_INDEX', { version_id: versionId }, versionId, uploadedBy, pool);
        } catch (jobErr) {
            console.error('Failed to enqueue TEXT_INDEX job:', jobErr);
        }

        return NextResponse.json(
            {
                success: true,
                data: {
                    pfd_id: pfdId,
                    public_id: publicId,
                    version_id: versionId,
                    version_no: 1,
                    page_count: pageCount,
                    default_page: defaultPage,
                    doc_number: docNumber,
                    job_id: jobId,
                },
            },
            { status: 201 }
        );
    } catch (error: any) {
        console.error('PFD create error:', error);
        return handleRiskMappingApiError(error, 'PFD create error');
    }
}



