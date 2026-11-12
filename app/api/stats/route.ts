import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const [projects, documents, jobs, detectionStats, assetStats] = await Promise.all([
      db.query('SELECT COUNT(*) FROM projects'),
      db.query('SELECT COUNT(*) FROM documents'),
      db.query('SELECT status, COUNT(*) FROM detection_jobs GROUP BY status'),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE review_status = 'APPROVED') AS confirmed,
          COUNT(*) FILTER (WHERE review_status = 'PENDING')  AS pending,
          COUNT(*) FILTER (WHERE review_status = 'REJECTED') AS rejected,
          ROUND(AVG(confidence)::numeric, 3) AS avg_confidence
        FROM detections
      `),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE review_status = 'APPROVED') AS confirmed,
          COUNT(*) FILTER (WHERE review_status = 'PENDING')  AS pending
        FROM assets
      `),
    ]);

    const jobStats: Record<string, number> = {};
    for (const row of jobs.rows) jobStats[row.status] = parseInt(row.count, 10);

    const ds = detectionStats.rows[0];
    const as_ = assetStats.rows[0];

    return NextResponse.json({
      projects: parseInt(projects.rows[0].count, 10),
      documents: parseInt(documents.rows[0].count, 10),
      jobs: jobStats,
      detections: {
        total:          parseInt(ds.total ?? '0', 10),
        confirmed:      parseInt(ds.confirmed ?? '0', 10),
        pending:        parseInt(ds.pending ?? '0', 10),
        rejected:       parseInt(ds.rejected ?? '0', 10),
        avg_confidence: parseFloat(ds.avg_confidence ?? '0'),
      },
      assets: {
        total:     parseInt(as_.total ?? '0', 10),
        confirmed: parseInt(as_.confirmed ?? '0', 10),
        pending:   parseInt(as_.pending ?? '0', 10),
      },
      dataset: {
        confirmed:       parseInt(ds.confirmed ?? '0', 10),
        threshold:       500,
        readyForRetrain: parseInt(ds.confirmed ?? '0', 10) >= 500,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[stats GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
