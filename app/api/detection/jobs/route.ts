import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

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
         COUNT(*) FILTER (WHERE d.review_status = 'APPROVED')  AS confirmed,
         COUNT(*) FILTER (WHERE d.review_status = 'PENDING')   AS pending,
         COUNT(*) FILTER (WHERE d.review_status = 'REJECTED')  AS rejected,
         COUNT(*) FILTER (WHERE d.detection_status = 'DETECTED')  AS detected
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
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = checkRateLimit(`detection:${ip}`, 5, 60_000); // 5 detection triggers/min per IP
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many detection requests. Try again later.' },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const { document_id, legend_id, project_id } = await request.json();
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });
  const id = uuidv4();

  // Cleanup: delete DETECTED/PENDING detections from previous jobs for this document.
  // Confirmed (APPROVED) and Rejected detections are preserved — user already reviewed those.
  // This prevents 473-detection inflation from 20+ repeated runs on the same document.
  await db.query(
    `DELETE FROM detections
     WHERE document_id = $1
       AND review_status = 'PENDING'
       AND detection_status = 'DETECTED'`,
    [document_id]
  );

  await db.query("INSERT INTO detection_jobs (id, document_id, legend_id, project_id, status, progress_pct) VALUES ($1,$2,$3,$4,'PENDING',0)", [id, document_id, legend_id ?? null, project_id ?? null]);
  // Use singleton queue — avoids creating a new Redis connection per request
  const { enqueueDetectionJob } = await import('@/lib/queue');
  const enqueued = await enqueueDetectionJob(id, legend_id ?? null);
  if (!enqueued) {
    console.warn(`[detection] Redis unavailable, job ${id} left as PENDING — worker will recover on startup`);
  }
  return NextResponse.json({ id, document_id, legend_id, status: "PENDING" }, { status: 201 });
}
