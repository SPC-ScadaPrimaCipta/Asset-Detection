import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env.local and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getConnection, sql } from '../lib/db';
import {
    claimNextJob,
    markJobDone,
    markJobError,
    updateJobProgress,
    recoverInterruptedJobs,
    updateWorkerHeartbeat,
    recordWorkerShutdown,
    BackgroundJob,
} from '../lib/jobQueue';
import { readPfdFile, storePdfPageText } from '../lib/pfdStorage';
import { extractPdfTextByPage } from '../lib/pdfRender';

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let isShuttingDown = false;

async function processTextIndex(job: BackgroundJob, pool: any) {
    let versionId = job.ref_id;
    if (!versionId && job.payload) {
        try {
            const parsed = JSON.parse(job.payload);
            versionId = parsed.version_id;
        } catch {
            // ignore
        }
    }

    if (!versionId) {
        throw new Error('version_id is missing from job payload');
    }

    await updateJobProgress(job.job_id, 10, 'Locating PDF version', pool);

    const versionResult = await pool
        .request()
        .input('versionId', sql.Int, versionId)
        .query('SELECT version_id, file_path, page_count FROM dbo.rbi_pfd_version WHERE version_id = @versionId');

    if (!versionResult.recordset || versionResult.recordset.length === 0) {
        throw new Error(`PFD version #${versionId} not found in database`);
    }

    const { file_path } = versionResult.recordset[0];

    await updateJobProgress(job.job_id, 20, 'Reading PDF file from storage', pool);
    const pdfBuffer = await readPfdFile(file_path);

    await updateJobProgress(job.job_id, 35, 'Extracting text layer across pages', pool);
    const pageTexts = await extractPdfTextByPage(pdfBuffer);

    await updateJobProgress(job.job_id, 80, `Saving text index (${pageTexts.length} pages)`, pool);
    await storePdfPageText(versionId, pageTexts, pool);

    // Auto-detect drawing sheet default page if multi-page and not explicitly customized
    if (pageTexts.length > 1) {
        const { detectDrawingDefaultPage } = await import('../lib/pfdTitleBlock');
        const detectedPage = detectDrawingDefaultPage(pageTexts);
        if (detectedPage > 1) {
            await pool
                .request()
                .input('versionId', sql.Int, versionId)
                .input('detectedPage', sql.Int, detectedPage)
                .query(`
                    UPDATE dbo.rbi_pfd_version
                    SET default_page = @detectedPage
                    WHERE version_id = @versionId AND default_page = 1
                `);
            console.log(`[Worker] Auto-set default_page for version #${versionId} to drawing sheet (page ${detectedPage})`);
        }
    }

    await markJobDone(job.job_id, pool);
    console.log(`[Worker] Job ${job.job_id} (TEXT_INDEX for version #${versionId}) completed successfully (${pageTexts.length} pages).`);
}

async function processAutoDetect(job: BackgroundJob, pool: any) {
    let versionId = job.ref_id;
    let rootAssetId = 0;

    if (job.payload) {
        try {
            const parsed = JSON.parse(job.payload);
            if (parsed.version_id) versionId = parsed.version_id;
            if (parsed.root_asset_id) rootAssetId = parsed.root_asset_id;
        } catch {
            // ignore
        }
    }

    if (!versionId) {
        throw new Error('version_id is missing from job payload');
    }

    const { executeAutoDetectAndTag } = await import('../lib/pfdAutoTag');
    const result = await executeAutoDetectAndTag(
        versionId,
        rootAssetId,
        job.created_by,
        pool,
        async (pct, msg) => {
            await updateJobProgress(job.job_id, pct, msg, pool);
        }
    );

    // If tags exist, ensure default_page points to the page with the most mapped tags
    if (result.tagsCreated > 0) {
        const topPageRes = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .query(`
                SELECT TOP 1 page_no
                FROM dbo.rbi_pfd_asset_map
                WHERE version_id = @versionId
                GROUP BY page_no
                ORDER BY COUNT(*) DESC
            `);
        if (topPageRes.recordset.length > 0) {
            const topPage = topPageRes.recordset[0].page_no;
            await pool
                .request()
                .input('versionId', sql.Int, versionId)
                .input('topPage', sql.Int, topPage)
                .query(`
                    UPDATE dbo.rbi_pfd_version
                    SET default_page = @topPage
                    WHERE version_id = @versionId AND default_page = 1
                `);
            console.log(`[Worker] Synced default_page for version #${versionId} to top-tagged page ${topPage}`);
        }
    }

    const completionMsg = result.tagsCreated > 0
        ? `Auto-tagged ${result.tagsCreated} component(s)`
        : `Scan complete (0 matches in drawing)`;

    await updateJobProgress(job.job_id, 100, completionMsg, pool);
    await markJobDone(job.job_id, pool);
    console.log(`[Worker] Job ${job.job_id} (AUTO_DETECT for version #${versionId}): ${completionMsg}`);
}

async function runWorker() {
    console.log('==============================================');
    console.log('   PROMIA Risk Mapping Background Job Worker   ');
    console.log('==============================================');

    const pool = await getConnection();
    console.log('[Worker] Connected to SQL Server database.');

    // Recover any jobs that were left RUNNING if worker crashed
    const recovered = await recoverInterruptedJobs(pool);
    if (recovered > 0) {
        console.log(`[Worker] Recovered ${recovered} interrupted job(s) back to PENDING.`);
    }

    await updateWorkerHeartbeat(pool);
    console.log('[Worker] Waiting for background jobs (polling every 3s)...');

    while (!isShuttingDown) {
        try {
            await updateWorkerHeartbeat(pool);

            const job = await claimNextJob(pool);

            if (!job) {
                await sleep(3000);
                continue;
            }

            console.log(`[Worker] Claimed job ${job.job_id} [${job.job_type}] created by ${job.created_by}`);

            try {
                switch (job.job_type) {
                    case 'TEXT_INDEX':
                        await processTextIndex(job, pool);
                        break;
                    case 'AUTO_DETECT':
                        await processAutoDetect(job, pool);
                        break;
                    default:
                        throw new Error(`Unhandled job type: ${job.job_type}`);
                }
            } catch (err: any) {
                console.error(`[Worker] Job ${job.job_id} failed:`, err.message || err);
                await markJobError(job.job_id, err.message || String(err), pool);
            }
        } catch (loopErr: any) {
            console.error('[Worker] Loop error:', loopErr.message || loopErr);
            await sleep(5000);
        }
    }

    await recordWorkerShutdown(pool);
    console.log('[Worker] Shut down cleanly.');
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('\n[Worker] Received SIGINT, shutting down...');
    isShuttingDown = true;
});

process.on('SIGTERM', async () => {
    console.log('\n[Worker] Received SIGTERM, shutting down...');
    isShuttingDown = true;
});

runWorker().catch((err) => {
    console.error('[Worker] Fatal crash:', err);
    process.exit(1);
});
