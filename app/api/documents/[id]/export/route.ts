import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { buildAssetRegisterWorkbook, ExportAsset } from "@/lib/excel-export";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const includeReview = request.nextUrl.searchParams.get("includeReview") === "true";

  // Fetch document
  const docR = await db.query("SELECT * FROM documents WHERE id=$1", [id]);
  if (!docR.rows.length) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const doc = docR.rows[0];

  // Fetch assets for this document
  const assetsR = await db.query(
    "SELECT * FROM assets WHERE document_id=$1 ORDER BY created_at DESC",
    [id]
  );
  const assets = assetsR.rows;

  // Fetch legend name
  let legendName = "Legend";
  if (assets.length > 0 && assets[0].legend_id) {
    const legR = await db.query("SELECT name FROM legends WHERE id=$1", [assets[0].legend_id]);
    if (legR.rows.length) legendName = legR.rows[0].name;
  }

  // Map to export format
  const exportAssets: ExportAsset[] = assets.map(a => ({
    assetTag: a.asset_tag,
    assetType: a.asset_type,
    equipmentClass: a.equipment_class,
    description: a.description,
    pidNumber: a.pid_number,
    pidPage: a.pid_page,
    service: a.service,
    location: a.location,
    unit: a.unit,
    area: a.area,
    legend: legendName,
    confidence: a.confidence,
    detectionStatus: a.detection_status,
    reviewStatus: a.review_status,
    evidence: Array.isArray(a.evidence) ? a.evidence : (typeof a.evidence === 'string' ? JSON.parse(a.evidence) : []),
  }));

  // Build workbook
  const buf = await buildAssetRegisterWorkbook(exportAssets, legendName, { includeReviewItems: includeReview });

  // Return as file download
  const filename = `Asset-Register-${doc.filename.replace(/\.pdf$/i, '')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
