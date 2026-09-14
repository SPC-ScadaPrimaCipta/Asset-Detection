import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  const q = request.nextUrl.searchParams.get("q");
  const status = request.nextUrl.searchParams.get("status");
  const conds: string[] = []; const vals: any[] = []; let i = 1;
  if (projectId) { conds.push(`a.project_id=$${i++}`); vals.push(projectId); }
  if (status) { conds.push(`a.review_status=$${i++}`); vals.push(status); }
  if (q) { conds.push(`(a.asset_tag ILIKE $${i} OR a.asset_type ILIKE $${i})`); vals.push(`%${q}%`); i++; }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await db.query(`SELECT a.* FROM assets a ${where} ORDER BY a.created_at DESC LIMIT 200`, vals);
  return NextResponse.json(rows.rows);
}
