import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const projectId = params.get("project_id");
    const documentId = params.get("document_id");
    const reviewStatus = params.get("review_status"); // APPROVED, PENDING, REJECTED
    const assetType = params.get("asset_type");
    const q = params.get("q");
    const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10) || 50));
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (projectId)   { conds.push(`a.project_id=$${i++}`);    vals.push(projectId); }
    if (documentId)  { conds.push(`a.document_id=$${i++}`);   vals.push(documentId); }
    if (reviewStatus){ conds.push(`a.review_status=$${i++}`); vals.push(reviewStatus); }
    if (assetType)   { conds.push(`a.asset_type ILIKE $${i++}`); vals.push(`%${assetType}%`); }
    if (q) {
      conds.push(`(a.asset_tag ILIKE $${i} OR a.asset_type ILIKE $${i} OR a.description ILIKE $${i} OR a.size ILIKE $${i})`);
      vals.push(`%${q}%`);
      i++;
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [countResult, dataResult] = await Promise.all([
      db.query(`SELECT COUNT(*) AS total FROM assets a ${where}`, vals),
      db.query(
        `SELECT a.*, l.name AS legend_name, ls.symbol_name AS legend_symbol_name
         FROM assets a
         LEFT JOIN legends l ON l.id = a.legend_id
         LEFT JOIN legend_symbols ls ON ls.id = a.legend_symbol_id
         ${where}
         ORDER BY a.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...vals, limit, offset]
      ),
    ]);

    return NextResponse.json({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page,
      limit,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[assets GET]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
