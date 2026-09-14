import crypto from 'crypto';
import { sql } from './db';

export interface BackgroundJob {
    job_id: string;
    job_type: 'TEXT_INDEX' | 'AUTO_DETECT';
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR';
    ref_id: number | null;
    payload: string | null;
    progress_pct: number;
    message: string | null;
    error_detail: string | null;
    created_by: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
}

/**
 * Enqueues a new background job into dbo.rbi_bg_job.
 */
export async function enqueueJob(
    type: 'TEXT_INDEX' | 'AUTO_DETECT',
    payload: any,
    refId: number | null,
    createdBy: string,
    pool: any
): Promise<string> {
    const jobId = crypto.randomUUID();
    const payloadStr = payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null;

    await pool
        .request()
        .input('jobId', sql.UniqueIdentifier, jobId)
        .input('jobType', sql.VarChar(30), type)
        .input('refId', sql.Int, refId)
        .input('payload', sql.NVarChar(sql.MAX), payloadStr)
        .input('createdBy', sql.VarChar(50), createdBy || 'system')
        .query(`
            INSERT INTO dbo.rbi_bg_job (job_id, job_type, ref_id, payload, created_by, status, progress_pct, message)
            VALUES (@jobId, @jobType, @refId, @payload, @createdBy, 'PENDING', 0, 'Queued');
        `);

    return jobId;
}

/**
 * Atomically claims the next PENDING job using UPDLOCK and READPAST hints.
 * Returns null if no PENDING jobs are available.
 */
export async function claimNextJob(pool: any): Promise<BackgroundJob | null> {
    const result = await pool.request().query(`
        SET NOCOUNT ON;
        DECLARE @claimed TABLE (
            job_id UNIQUEIDENTIFIER,
            job_type VARCHAR(30),
            status VARCHAR(20),
            ref_id INT,
            payload NVARCHAR(MAX),
            progress_pct TINYINT,
            message NVARCHAR(500),
            error_detail NVARCHAR(MAX),
            created_by VARCHAR(50),
            created_at DATETIME,
            started_at DATETIME,
            finished_at DATETIME
        );

        BEGIN TRANSACTION;

        WITH NextJob AS (
            SELECT TOP (1) *
            FROM dbo.rbi_bg_job WITH (UPDLOCK, READPAST)
            WHERE status = 'PENDING'
            ORDER BY created_at ASC
        )
        UPDATE NextJob
        SET status = 'RUNNING',
            started_at = GETDATE(),
            message = 'Processing...'
        OUTPUT inserted.* INTO @claimed;

        COMMIT TRANSACTION;

        SELECT * FROM @claimed;
    `);

    if (!result.recordset || result.recordset.length === 0) {
        return null;
    }

    return result.recordset[0] as BackgroundJob;
}

/**
 * Marks a job as DONE.
 */
export async function markJobDone(jobId: string, pool: any): Promise<void> {
    await pool
        .request()
        .input('jobId', sql.UniqueIdentifier, jobId)
        .query(`
            UPDATE dbo.rbi_bg_job
            SET status = 'DONE',
                progress_pct = 100,
                message = 'Completed',
                finished_at = GETDATE()
            WHERE job_id = @jobId;
        `);
}

/**
 * Marks a job as ERROR.
 */
export async function markJobError(jobId: string, errorDetail: string, pool: any): Promise<void> {
    const safeError = errorDetail || 'Unknown error occurred';
    await pool
        .request()
        .input('jobId', sql.UniqueIdentifier, jobId)
        .input('errorDetail', sql.NVarChar(sql.MAX), safeError)
        .input('msg', sql.NVarChar(500), `Error: ${safeError.slice(0, 450)}`)
        .query(`
            UPDATE dbo.rbi_bg_job
            SET status = 'ERROR',
                error_detail = @errorDetail,
                message = @msg,
                finished_at = GETDATE()
            WHERE job_id = @jobId;
        `);
}

/**
 * Updates progress percentage (0-100) and status message.
 */
export async function updateJobProgress(jobId: string, pct: number, message: string, pool: any): Promise<void> {
    const clampedPct = Math.max(0, Math.min(100, Math.round(pct)));
    await pool
        .request()
        .input('jobId', sql.UniqueIdentifier, jobId)
        .input('pct', sql.TinyInt, clampedPct)
        .input('msg', sql.NVarChar(500), message.slice(0, 500))
        .query(`
            UPDATE dbo.rbi_bg_job
            SET progress_pct = @pct,
                message = @msg
            WHERE job_id = @jobId;
        `);
}

/**
 * Resets any interrupted RUNNING jobs back to PENDING on worker startup.
 */
export async function recoverInterruptedJobs(pool: any): Promise<number> {
    const result = await pool.request().query(`
        UPDATE dbo.rbi_bg_job
        SET status = 'PENDING',
            started_at = NULL,
            progress_pct = 0,
            message = 'Recovered after worker restart'
        WHERE status = 'RUNNING' AND finished_at IS NULL;
        SELECT @@ROWCOUNT AS recovered;
    `);

    return result.recordset[0]?.recovered || 0;
}

/**
 * Retries an ERROR job by resetting it to PENDING.
 */
export async function retryJob(jobId: string, pool: any): Promise<boolean> {
    const result = await pool
        .request()
        .input('jobId', sql.UniqueIdentifier, jobId)
        .query(`
            UPDATE dbo.rbi_bg_job
            SET status = 'PENDING',
                progress_pct = 0,
                message = 'Queued for retry',
                error_detail = NULL,
                started_at = NULL,
                finished_at = NULL
            WHERE job_id = @jobId AND status = 'ERROR';
            SELECT @@ROWCOUNT AS updated;
        `);

    return (result.recordset[0]?.updated || 0) > 0;
}

/**
 * Retries all failed (ERROR) jobs by resetting them to PENDING.
 */
export async function retryAllFailedJobs(pool: any): Promise<number> {
    const result = await pool.request().query(`
        UPDATE dbo.rbi_bg_job
        SET status = 'PENDING',
            progress_pct = 0,
            message = 'Queued for retry',
            error_detail = NULL,
            started_at = NULL,
            finished_at = NULL
        WHERE status = 'ERROR';
        SELECT @@ROWCOUNT AS updated;
    `);

    return result.recordset[0]?.updated || 0;
}

/**
 * Fetches the most recent jobs for UI polling.
 */
export async function getRecentJobs(limit = 20, pool: any): Promise<BackgroundJob[]> {
    const result = await pool
        .request()
        .input('limit', sql.Int, limit)
        .query(`
            SELECT TOP (@limit)
                job_id, job_type, status, ref_id, payload, progress_pct, message,
                error_detail, created_by, created_at, started_at, finished_at
            FROM dbo.rbi_bg_job
            ORDER BY created_at DESC;
        `);

    return result.recordset as BackgroundJob[];
}

/**
 * Updates worker heartbeat in dbo.rbi_service_heartbeat.
 */
export async function updateWorkerHeartbeat(pool: any): Promise<void> {
    try {
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rbi_service_heartbeat')
            BEGIN
                CREATE TABLE dbo.rbi_service_heartbeat (
                    service_name VARCHAR(50) PRIMARY KEY,
                    last_heartbeat DATETIME NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                    worker_pid INT NULL
                );
            END;

            MERGE dbo.rbi_service_heartbeat AS target
            USING (SELECT 'job_worker' AS service_name) AS source
            ON target.service_name = source.service_name
            WHEN MATCHED THEN
                UPDATE SET last_heartbeat = GETDATE(), status = 'ACTIVE', worker_pid = ${process.pid}
            WHEN NOT MATCHED THEN
                INSERT (service_name, last_heartbeat, status, worker_pid)
                VALUES ('job_worker', GETDATE(), 'ACTIVE', ${process.pid});
        `);
    } catch {
        // Non-fatal
    }
}

/**
 * Records that the worker was cleanly stopped.
 */
export async function recordWorkerShutdown(pool: any): Promise<void> {
    try {
        await pool.request().query(`
            IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rbi_service_heartbeat')
            BEGIN
                UPDATE dbo.rbi_service_heartbeat
                SET status = 'STOPPED'
                WHERE service_name = 'job_worker';
            END;
        `);
    } catch {
        // Non-fatal
    }
}

export interface WorkerServiceStatus {
    is_active: boolean;
    last_heartbeat: string | null;
    seconds_ago: number | null;
}

/**
 * Gets the current background worker service health.
 * Active if heartbeat was updated within the last 15 seconds and status is not STOPPED.
 */
export async function getWorkerStatus(pool: any): Promise<WorkerServiceStatus> {
    try {
        const result = await pool.request().query(`
            IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rbi_service_heartbeat')
            BEGIN
                SELECT TOP 1
                    status,
                    last_heartbeat,
                    DATEDIFF(second, last_heartbeat, GETDATE()) AS seconds_ago
                FROM dbo.rbi_service_heartbeat
                WHERE service_name = 'job_worker';
            END
            ELSE
            BEGIN
                SELECT NULL AS status, NULL AS last_heartbeat, NULL AS seconds_ago;
            END;
        `);

        const row = result.recordset?.[0];
        if (!row || !row.last_heartbeat) {
            return { is_active: false, last_heartbeat: null, seconds_ago: null };
        }

        const isRecent = row.seconds_ago !== null && row.seconds_ago <= 15;
        const isActive = isRecent && row.status === 'ACTIVE';

        return {
            is_active: isActive,
            last_heartbeat: row.last_heartbeat ? new Date(row.last_heartbeat).toISOString() : null,
            seconds_ago: row.seconds_ago,
        };
    } catch {
        return { is_active: false, last_heartbeat: null, seconds_ago: null };
    }
}

