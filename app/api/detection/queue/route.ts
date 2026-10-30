import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

interface JobRow {
  id: string;
  document_id: string;
  document_name: string;
  project_id: string | null;
  project_name: string | null;
  user_id: string | null;
  user_name: string | null;
  status: string;
  progress_pct: number;
  created_at: string;
  started_at: string | null;
}

export async function GET() {
  try {
    // 0. Auto-expire stale PROCESSING jobs older than 2 hours (e.g. from server crash)
    await db.query(
      `UPDATE detection_jobs
       SET status = 'FAILED', completed_at = NOW(), error_detail = 'Job timed out after exceeding maximum duration'
       WHERE status = 'PROCESSING' AND started_at < NOW() - INTERVAL '2 hours'`
    );

    // 1. Fetch currently active job (status = 'PROCESSING')
    const activeResult = await db.query(
      `SELECT
         j.id,
         j.document_id,
         d.filename AS document_name,
         j.project_id,
         p.name AS project_name,
         j.user_id,
         u.name AS user_name,
         j.status,
         COALESCE(j.progress_pct, 0)::int AS progress_pct,
         j.created_at,
         j.started_at
       FROM detection_jobs j
       JOIN documents d ON d.id = j.document_id
       LEFT JOIN projects p ON p.id = j.project_id
       LEFT JOIN users u ON u.id = j.user_id
       WHERE j.status = 'PROCESSING'
       ORDER BY j.started_at DESC NULLS LAST, j.created_at DESC
       LIMIT 1`
    );

    const activeRow = activeResult.rows[0] as JobRow | undefined;
    const now = Date.now();

    const activeJob = activeRow
      ? {
          id: activeRow.id,
          documentId: activeRow.document_id,
          documentName: activeRow.document_name,
          projectId: activeRow.project_id,
          projectName: activeRow.project_name || 'Tanpa Proyek',
          user: {
            id: activeRow.user_id,
            name: activeRow.user_name || 'Pengguna Sistem',
          },
          status: activeRow.status,
          progressPct: activeRow.progress_pct,
          startedAt: activeRow.started_at,
          elapsedSeconds: activeRow.started_at
            ? Math.max(0, Math.floor((now - new Date(activeRow.started_at).getTime()) / 1000))
            : 0,
        }
      : null;

    // 2. Fetch pending jobs queue (status = 'PENDING')
    const queueResult = await db.query(
      `SELECT
         j.id,
         j.document_id,
         d.filename AS document_name,
         j.project_id,
         p.name AS project_name,
         j.user_id,
         u.name AS user_name,
         j.status,
         COALESCE(j.progress_pct, 0)::int AS progress_pct,
         j.created_at,
         j.started_at
       FROM detection_jobs j
       JOIN documents d ON d.id = j.document_id
       LEFT JOIN projects p ON p.id = j.project_id
       LEFT JOIN users u ON u.id = j.user_id
       WHERE j.status = 'PENDING'
       ORDER BY j.created_at ASC
       LIMIT 20`
    );

    const queue = (queueResult.rows as JobRow[]).map((row, index) => ({
      id: row.id,
      documentId: row.document_id,
      documentName: row.document_name,
      projectId: row.project_id,
      projectName: row.project_name || 'Tanpa Proyek',
      user: {
        id: row.user_id,
        name: row.user_name || 'Pengguna Sistem',
      },
      status: row.status,
      queuePosition: index + 1,
      createdAt: row.created_at,
      waitingSeconds: row.created_at
        ? Math.max(0, Math.floor((now - new Date(row.created_at).getTime()) / 1000))
        : 0,
    }));

    return NextResponse.json({
      isBusy: Boolean(activeJob),
      activeJob,
      queue,
      totalWaiting: queue.length,
    });
  } catch (error) {
    console.error('[detection/queue] Error fetching queue:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve detection queue status' },
      { status: 500 }
    );
  }
}
