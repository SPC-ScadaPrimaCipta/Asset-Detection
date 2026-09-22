import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { buildAssetRegisterWorkbook, ExportAsset } from "@/lib/excel-export";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const includeReview = request.nextUrl.searchParams.get("includeReview") === "true";

    const docR = await db.query("SELECT * FROM documents WHERE id=$1", [id]);
    if (!docR.rows.length) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const doc = docR.rows[0];

    const assetsR = await db.query(
      `SELECT a.*, l.name AS legend_name, ls.symbol_name AS legend_symbol_name
       FROM assets a
       LEFT JOIN legends l ON l.id = a.legend_id
       LEFT JOIN legend_symbols ls ON ls.id = a.legend_symbol_id
       WHERE a.document_id=$1 ORDER BY a.created_at DESC`,
      [id]
    );
    const assets = assetsR.rows;

    let legendName = "Legend";
    if (assets.length > 0 && assets[0].legend_name) {
      legendName = assets[0].legend_name;
    } else if (assets.length > 0 && assets[0].legend_id) {
      const legR = await db.query("SELECT name FROM legends WHERE id=$1", [assets[0].legend_id]);
      if (legR.rows.length) legendName = legR.rows[0].name;
    }

    const exportAssets: ExportAsset[] = assets.map((a: Record<string, unknown>) => ({
      assetTag: a.asset_tag as string | null,
      assetType: a.asset_type as string,
      equipmentClass: a.equipment_class as string | null,
      description: a.description as string | null,
      pidNumber: a.pid_number as string | null,
      pidPage: a.pid_page as number | null,
      service: a.service as string | null,
      mainEquipment: (a.main_equipment as string | null) ?? null,
      location: a.location as string | null,
      unit: a.unit as string | null,
      area: a.area as string | null,
      legend: (a.legend_name as string | null) ?? legendName,
      legendSymbol: (a.legend_symbol_name as string | null) ?? null,
      confidence: a.confidence as number | null,
      detectionStatus: a.detection_status as string,
      reviewStatus: a.review_status as string,
      evidence: Array.isArray(a.evidence)
        ? (a.evidence as string[])
        : typeof a.evidence === "string"
        ? (() => { try { return JSON.parse(a.evidence as string); } catch { return [a.evidence as string]; } })()
        : [],
      bboxX: a.bbox_x as number | null,
      bboxY: a.bbox_y as number | null,
      bboxW: a.bbox_w as number | null,
      bboxH: a.bbox_h as number | null,
    }));

    const buf = await buildAssetRegisterWorkbook(exportAssets, legendName, { includeReviewItems: includeReview });
    const filename = `Asset-Register-${(doc.filename as string).replace(/\.pdf$/i, "")}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[documents/[id]/export]", msg);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
