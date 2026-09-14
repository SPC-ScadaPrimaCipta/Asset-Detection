import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const documentId = params.get("document_id");
  const projectId = params.get("project_id");
  const status = params.get("status");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "20", 10) || 20));
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if (documentId) { conds.push(`j.document_id = $${i++}`); vals.push(documentId); }
  if (projectId)  { conds.push(`j.project_id = $${i++}`);  vals.push(projectId); }
  if (status)     { conds.push(`j.status = $${i++}`);       vals.push(status); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  // Total count query
  const countResult = await db.query(
    `SELECT COUNT(*) AS total FROM detection_jobs j ${where}`,
    vals
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Main query: job rows + per-job detection counts via subquery
  const dataResult = await db.query(
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
         COUNT(*)                                          AS total,
         COUNT(*) FILTER (WHERE d.review_status = 'confirmed') AS confirmed,
         COUNT(*) FILTER (WHERE d.review_status = 'pending')   AS pending,
         COUNT(*) FILTER (WHERE d.review_status = 'rejected')  AS rejected,
         COUNT(*) FILTER (WHERE d.status        = 'detected')  AS detected
       FROM detections d
       WHERE d.job_id = j.id
     ) s ON true
     ${where}
     ORDER BY j.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...vals, limit, offset]
  );

  const data = dataResult.rows.map((row) => {
    const {
      total_detections,
      confirmed_detections,
      pending_detections,
      rejected_detections,
      detected_detections,
      ...job
    } = row;
    return {
      ...job,
      stats: {
        total:     total_detections,
        confirmed: confirmed_detections,
        pending:   pending_detections,
        rejected:  rejected_detections,
        detected:  detected_detections,
      },
    };
  });

  return NextResponse.json({ data, total, page, limit });
}

export async function POST(request: NextRequest) {
  const { document_id, legend_id, project_id } = await request.json();
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });
  const id = uuidv4();
  await db.query("INSERT INTO detection_jobs (id, document_id, legend_id, project_id, status, progress_pct) VALUES ($1,$2,$3,$4,'PENDING',0)", [id, document_id, legend_id ?? null, project_id ?? null]);
  // BullMQ requires Node.js runtime (not Edge). Dynamic import guards against Edge/build-time errors.
  try {
    const { Queue } = await import('bullmq');
    const IORedis = (await import('ioredis')).default;
    const conn = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: true });
    await conn.connect().catch(() => {});
    const q = new Queue('detection', { connection: conn });
    await q.add('detection', { jobId: id, legendId: legend_id ?? null }, { jobId: id, removeOnComplete: true, removeOnFail: 100 });
    conn.disconnect();
  } catch {
    // Redis unavailable — client polls status; worker process picks up PENDING jobs on restart
    console.warn(`[detection] Redis unavailable, job ${id} left as PENDING`);
  }
  return NextResponse.json({ id, document_id, legend_id, status: "PENDING" }, { status: 201 });
}
