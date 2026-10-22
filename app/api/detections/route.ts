import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get("job_id");
    const documentId = request.nextUrl.searchParams.get("document_id");
    const status = request.nextUrl.searchParams.get("status");           // detection_status
    const reviewStatus = request.nextUrl.searchParams.get("review_status"); // review_status
    const q = request.nextUrl.searchParams.get("q");
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (jobId)        { conds.push(`d.job_id=$${i++}`);            vals.push(jobId); }
    if (documentId)   { conds.push(`d.document_id=$${i++}`);       vals.push(documentId); }
    if (status)       { conds.push(`d.detection_status=$${i++}`);  vals.push(status); }
    if (reviewStatus) { conds.push(`d.review_status=$${i++}`);     vals.push(reviewStatus); }
    if (q) {
      conds.push(`(d.asset_tag ILIKE $${i} OR d.asset_type ILIKE $${i} OR d.description ILIKE $${i} OR d.size ILIKE $${i})`);
      vals.push(`%${q}%`);
      i++;
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows, total] = await Promise.all([
      db.query(
       `SELECT d.*, m.id AS mdo_id, m.tag_no_proposed AS mdo_tag_no_proposed,
                m.equipment_type AS mdo_equipment_type, m.component_name AS mdo_component_name,
                m.size AS mdo_size, m.from_value AS mdo_from,
                m.to_value AS mdo_to, m.of_value AS mdo_of, m.at_value AS mdo_at,
                m.approval_status AS mdo_approval_status,
                d.candidate_status, d.candidate_source
         FROM detections d LEFT JOIN detection_mdo_records m ON m.detection_id=d.id
         ${where} ORDER BY d.confidence DESC, d.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...vals, limit, offset]
      ),
      db.query(`SELECT COUNT(*) FROM detections d ${where}`, vals),
    ]);

    return NextResponse.json({ data: rows.rows, total: parseInt(total.rows[0].count, 10), page, limit });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[detections GET]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
