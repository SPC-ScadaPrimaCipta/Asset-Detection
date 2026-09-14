import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const [projects, documents, jobs, detectionStats] = await Promise.all([
    db.query('SELECT COUNT(*) FROM projects'),
    db.query('SELECT COUNT(*) FROM documents'),
    db.query(`SELECT status, COUNT(*) FROM detection_jobs GROUP BY status`),
    db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE review_status = 'APPROVED') AS confirmed,
        COUNT(*) FILTER (WHERE review_status = 'PENDING') AS pending,
        COUNT(*) FILTER (WHERE review_status = 'REJECTED') AS rejected,
        ROUND(AVG(confidence)::numeric, 3) AS avg_confidence
      FROM detections
    `),
  ]);

  const jobStats: Record<string, number> = {};
  for (const row of jobs.rows) jobStats[row.status] = parseInt(row.count);

  const ds = detectionStats.rows[0];

  return NextResponse.json({
    projects: parseInt(projects.rows[0].count),
    documents: parseInt(documents.rows[0].count),
    jobs: jobStats,
    detections: {
      total: parseInt(ds.total ?? '0'),
      confirmed: parseInt(ds.confirmed ?? '0'),
      pending: parseInt(ds.pending ?? '0'),
      rejected: parseInt(ds.rejected ?? '0'),
      avg_confidence: parseFloat(ds.avg_confidence ?? '0'),
    },
  });
}
