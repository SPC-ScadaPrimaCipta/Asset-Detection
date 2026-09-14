import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { buildAssetRegisterWorkbook } from "@/lib/excel-export";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  const includeReviewItems = request.nextUrl.searchParams.get("includeReviewItems") === "true";
  const legendId = request.nextUrl.searchParams.get("legend_id");

  const rows = await db.query(
    `SELECT a.*, l.name as legend_name FROM assets a LEFT JOIN legends l ON l.id=a.legend_id ${projectId ? "WHERE a.project_id=$1" : ""} ORDER BY a.created_at`,
    projectId ? [projectId] : []
  );
  let legendName = "Custom Legend";
  if (legendId) {
    const lr = await db.query("SELECT name FROM legends WHERE id=$1", [legendId]);
    if (lr.rows.length) legendName = lr.rows[0].name;
  } else if (rows.rows[0]?.legend_name) legendName = rows.rows[0].legend_name;

  const assets = rows.rows.map((r: any) => ({
    assetTag: r.asset_tag, assetType: r.asset_type, equipmentClass: r.equipment_class, description: r.description,
    pidNumber: r.pid_number, pidPage: r.pid_page, service: r.service, location: r.location, unit: r.unit, area: r.area,
    legend: r.legend_name ?? legendName, confidence: r.confidence, detectionStatus: r.detection_status, reviewStatus: r.review_status,
    evidence: Array.isArray(r.evidence) ? r.evidence : JSON.parse(r.evidence ?? "[]"),
  }));

  const buf = await buildAssetRegisterWorkbook(assets, legendName, { includeReviewItems });
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Asset_Register.xlsx"`,
    },
  });
}
