import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("job_id");
  const documentId = request.nextUrl.searchParams.get("document_id");
  const status = request.nextUrl.searchParams.get("status");
  const q = request.nextUrl.searchParams.get("q");
  const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (jobId) { conds.push(`d.job_id=$${i++}`); vals.push(jobId); }
  if (documentId) { conds.push(`d.document_id=$${i++}`); vals.push(documentId); }
  if (status) { conds.push(`d.detection_status=$${i++}`); vals.push(status); }
  if (q) { conds.push(`(d.asset_tag ILIKE $${i} OR d.asset_type ILIKE $${i} OR d.description ILIKE $${i})`); vals.push(`%${q}%`); i++; }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await db.query(`SELECT d.* FROM detections d ${where} ORDER BY d.confidence DESC, d.created_at DESC LIMIT $${i} OFFSET $${i+1}`, [...vals, limit, offset]);
  const total = await db.query(`SELECT COUNT(*) FROM detections d ${where}`, vals);
  return NextResponse.json({ data: rows.rows, total: parseInt(total.rows[0].count), page, limit });
}
