import fs from 'fs/promises';
import path from 'path';
import { putFile, getFile, parseStoragePath } from './storageAdapter';

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.PFD_STORAGE_PATH || './storage/pfd');

export async function savePfdFile(pfdIdentifier: string | number, versionNo: number, originalName: string, buffer: Buffer) {
    return putFile({
        category: 'pfd',
        identifier: pfdIdentifier,
        subPath: versionNo,
        fileName: originalName,
        buffer,
        mimeType: 'application/pdf',
        localRootOverride: STORAGE_ROOT,
    });
}

export async function readPfdFile(relPath: string): Promise<Buffer> {
    return getFile(relPath, STORAGE_ROOT);
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
    // pdfjs-dist needs a worker thread that doesn't survive Next.js's server
    // bundling; pdf-lib is pure-JS and worker-free, which is all this
    // metadata-only page count needs.
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    return doc.getPageCount();
}

export function clampDefaultPage(raw: unknown, pageCount: number): number {
    let parsed: number = NaN;
    if (typeof raw === 'string') {
        parsed = parseInt(raw, 10);
    } else if (typeof raw === 'number') {
        parsed = Math.floor(raw);
    }

    if (!Number.isFinite(parsed) || parsed < 1 || parsed > pageCount) {
        return 1;
    }
    return parsed;
}

// Pages are rendered to PNG on first request and cached to disk
export async function getRenderedPage(relPath: string, pageNumber: number, targetWidth = 1400): Promise<Buffer> {
    let cacheRelPath: string;
    const { backend, keyOrPath } = parseStoragePath(relPath);

    if (backend === 'sharepoint') {
        // We use a separate local cache directory for SharePoint items
        cacheRelPath = path.join('.sp_cache', keyOrPath, 'pages', `${pageNumber}_${targetWidth}.png`);
    } else if (backend === 's3') {
        // We use a separate local cache directory for S3 items
        const safeCacheKey = keyOrPath.replace(/[^a-zA-Z0-9._-]/g, '_');
        cacheRelPath = path.join('.s3_cache', safeCacheKey, 'pages', `${pageNumber}_${targetWidth}.png`);
    } else {
        // Cache next to the local source PDF
        cacheRelPath = path.join(path.dirname(keyOrPath), 'pages', `${pageNumber}_${targetWidth}.png`);
    }

    const cacheAbsPath = path.resolve(STORAGE_ROOT, cacheRelPath);
    if (!cacheAbsPath.startsWith(STORAGE_ROOT)) {
        throw new Error('Invalid cache file path');
    }

    try {
        return await fs.readFile(cacheAbsPath);
    } catch {
        // not cached yet
    }

    const { renderPdfPageToPng } = await import('./pdfRender');
    const pdfBuffer = await readPfdFile(relPath);
    const png = await renderPdfPageToPng(pdfBuffer, pageNumber, targetWidth);

    await fs.mkdir(path.dirname(cacheAbsPath), { recursive: true });
    await fs.writeFile(cacheAbsPath, png);
    return png;
}

// Stores extracted page text layers into dbo.rbi_pfd_page_text.
// Idempotent: uses MERGE on (version_id, page_no).
export async function storePdfPageText(
    versionId: number,
    pageTexts: { page_no: number; text: string }[],
    pool: any
): Promise<void> {
    const { sql } = await import('./db');
    for (const pt of pageTexts) {
        await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .input('pageNo', sql.Int, pt.page_no)
            .input('fullText', sql.NVarChar(sql.MAX), pt.text)
            .query(`
                MERGE dbo.rbi_pfd_page_text AS target
                USING (SELECT @versionId AS version_id, @pageNo AS page_no) AS source
                ON (target.version_id = source.version_id AND target.page_no = source.page_no)
                WHEN MATCHED THEN
                    UPDATE SET target.full_text = @fullText, target.extracted_at = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (version_id, page_no, full_text, extracted_at)
                    VALUES (@versionId, @pageNo, @fullText, GETDATE());
            `);
    }
}