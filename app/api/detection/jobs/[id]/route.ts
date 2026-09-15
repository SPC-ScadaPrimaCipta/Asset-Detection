import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await db.query(
      `SELECT
         j.*,
         COALESCE(s.total,     0)::int AS total_detections,
         COALESCE(s.confirmed, 0)::int AS confirmed_detections,
         COALESCE(s.pending,   0)::int AS pending_detections,
         COALESCE(s.rejected,  0)::int AS rejected_detections,
         COALESCE(s.detected,  0)::int AS detected_detections
       FROM detection_jobs j
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)                                              AS total,
           COUNT(*) FILTER (WHERE d.review_status = 'APPROVED') AS confirmed,
           COUNT(*) FILTER (WHERE d.review_status = 'PENDING')  AS pending,
           COUNT(*) FILTER (WHERE d.review_status = 'REJECTED') AS rejected,
           COUNT(*) FILTER (WHERE d.detection_status = 'DETECTED') AS detected
         FROM detections d
         WHERE d.job_id = j.id
       ) s ON true
       WHERE j.id = $1`,
      [id]
    );

    if (res.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const {
      total_detections,
      confirmed_detections,
      pending_detections,
      rejected_detections,
      detected_detections,
      ...job
    } = res.rows[0];

    return NextResponse.json({
      ...job,
      stats: {
        total:     total_detections,
        confirmed: confirmed_detections,
        pending:   pending_detections,
        rejected:  rejected_detections,
        detected:  detected_detections,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[jobs/[id] GET]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await db.query("UPDATE detection_jobs SET status = 'CANCELLED' WHERE id = $1", [id]);
    return NextResponse.json({ status: 'CANCELLED' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[jobs/[id] DELETE]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
