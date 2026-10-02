import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { buildAssetRegisterWorkbook } from "@/lib/excel-export";

function parseEvidence(ev: unknown): string[] {
  if (!ev) return [];
  if (Array.isArray(ev)) return ev.map(String);
  if (typeof ev === "string") {
    try {
      const p = JSON.parse(ev);
      return Array.isArray(p) ? p.map(String) : [String(p)];
    } catch {
      return [ev];
    }
  }
  return [String(ev)];
}

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("project_id");
    const includeReviewItems = request.nextUrl.searchParams.get("includeReviewItems") === "true";
    const legendId = request.nextUrl.searchParams.get("legend_id");

    const rows = await db.query(
      `SELECT a.*,
              l.name  AS legend_name,
              ls.symbol_name AS legend_symbol_name
         FROM assets a
         LEFT JOIN legends l       ON l.id  = a.legend_id
         LEFT JOIN legend_symbols ls ON ls.id = a.legend_symbol_id
         ${projectId ? "WHERE a.project_id=$1" : ""}
         ORDER BY a.created_at`,
      projectId ? [projectId] : []
    );

    let legendName = "Custom Legend";
    if (legendId) {
      const lr = await db.query("SELECT name FROM legends WHERE id=$1", [legendId]);
      if (lr.rows.length) legendName = lr.rows[0].name;
    } else if (rows.rows[0]?.legend_name) {
      legendName = rows.rows[0].legend_name;
    }

    const assets = rows.rows.map((r: Record<string, unknown>) => ({
      assetTag: r.asset_tag as string | null,
      assetType: r.asset_type as string,
      equipmentClass: r.equipment_class as string | null,
      description: r.description as string | null,
      pidNumber: r.pid_number as string | null,
      pidPage: r.pid_page as number | null,
      service: r.service as string | null,
      mainEquipment: (r.main_equipment as string | null) ?? null,
      location: r.location as string | null,
      unit: r.unit as string | null,
      area: r.area as string | null,
      size: (r.size as string | null) ?? null,
      fromRef: (r.fromRef as string | null) ?? null,
      toRef: (r.toRef as string | null) ?? null,
      ofOrAtRef: (r.ofOrAtRef as string | null) ?? null,
      descriptionProposed: (r.descriptionProposed as string | null) ?? null,
      tagNoProposed: (r.tagNoProposed as string | null) ?? null,
      legend: (r.legend_name as string | null) ?? legendName,
      legendSymbol: (r.legend_symbol_name as string | null) ?? null,
      confidence: r.confidence as number | null,
      detectionStatus: r.detection_status as string,
      reviewStatus: r.review_status as string,
      evidence: parseEvidence(r.evidence),
      bboxX: r.bbox_x as number | null,
      bboxY: r.bbox_y as number | null,
      bboxW: r.bbox_w as number | null,
      bboxH: r.bbox_h as number | null,
    }));

    const buf = await buildAssetRegisterWorkbook(assets, legendName, { includeReviewItems });
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Asset_Register.xlsx"`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[export/assets]", msg);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
