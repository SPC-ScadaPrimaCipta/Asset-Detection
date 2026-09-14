import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

const SORT_MAP: Record<string, string> = {
  created_at_desc: "a.created_at DESC",
  tag_asc:         "a.asset_tag ASC",
  type_asc:        "a.asset_type ASC",
  confidence_desc: "a.confidence DESC",
  confidence_asc:  "a.confidence ASC",
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const projectId       = params.get("project_id");
  const q               = params.get("q");
  const reviewStatus    = params.get("review_status");
  const detectionStatus = params.get("detection_status");
  const assetType       = params.get("asset_type");
  const confidenceMin   = params.get("confidence_min");
  const confidenceMax   = params.get("confidence_max");
  const sort            = params.get("sort") ?? "created_at_desc";
  const page            = Math.max(1, parseInt(params.get("page")  ?? "1",  10) || 1);
  const limit           = Math.min(200, Math.max(1, parseInt(params.get("limit") ?? "50", 10) || 50));
  const offset          = (page - 1) * limit;

  const conds: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if (projectId) {
    conds.push(`a.project_id = $${i++}`);
    vals.push(projectId);
  }
  if (reviewStatus) {
    conds.push(`a.review_status = $${i++}`);
    vals.push(reviewStatus);
  }
  if (detectionStatus) {
    conds.push(`a.detection_status = $${i++}`);
    vals.push(detectionStatus);
  }
  if (assetType) {
    conds.push(`a.asset_type = $${i++}`);
    vals.push(assetType);
  }
  if (q) {
    conds.push(`(a.asset_tag ILIKE $${i} OR a.asset_type ILIKE $${i} OR a.description ILIKE $${i})`);
    vals.push(`%${q}%`);
    i++;
  }
  if (confidenceMin !== null && confidenceMin !== "") {
    const min = parseFloat(confidenceMin);
    if (!isNaN(min)) { conds.push(`a.confidence >= $${i++}`); vals.push(min); }
  }
  if (confidenceMax !== null && confidenceMax !== "") {
    const max = parseFloat(confidenceMax);
    if (!isNaN(max)) { conds.push(`a.confidence <= $${i++}`); vals.push(max); }
  }

  const where   = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const orderBy = SORT_MAP[sort] ?? SORT_MAP["created_at_desc"];

  // Total count
  const countResult = await db.query(
    `SELECT COUNT(*) AS total
     FROM assets a
     LEFT JOIN legends l ON l.id = a.legend_id
     ${where}`,
    vals
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Paginated data with legend name
  const dataResult = await db.query(
    `SELECT
       a.*,
       l.name AS legend_name
     FROM assets a
     LEFT JOIN legends l ON l.id = a.legend_id
     ${where}
     ORDER BY ${orderBy}
     LIMIT $${i} OFFSET $${i + 1}`,
    [...vals, limit, offset]
  );

  return NextResponse.json({ data: dataResult.rows, total, page, limit });
}
