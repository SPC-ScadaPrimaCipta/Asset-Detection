import ExcelJS from "exceljs";

export interface ExportAsset {
  assetTag: string | null;
  assetType: string;
  equipmentClass: string | null;
  description: string | null;
  pidNumber: string | null;
  pidPage: number | null;
  service: string | null;
  // Fix C: mainEquipment added — was in DB (detections + assets) but missing from Excel output
  mainEquipment: string | null;
  location: string | null;
  unit: string | null;
  area: string | null;
  legend: string | null;
  legendSymbol: string | null; // specific symbol name within the legend
  confidence: number | null;
  detectionStatus: string;
  reviewStatus: string;
  evidence: string[];
  bboxX: number | null;
  bboxY: number | null;
  bboxW: number | null;
  bboxH: number | null;
}

export async function buildAssetRegisterWorkbook(
  assets: ExportAsset[],
  legendName: string,
  opts: { includeReviewItems: boolean }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asset Detection";
  wb.created = new Date();

  // Sheet 1: Asset Register (rejected excluded; review filtered by opts)
  const ws = wb.addWorksheet("Asset Register", { properties: { tabColor: { argb: "FF4361EE" } } });
  const filtered = assets.filter((a) => {
    if (a.detectionStatus === "REJECTED" || a.reviewStatus === "REJECTED") return false;
    if (!opts.includeReviewItems && a.reviewStatus === "PENDING") return false;
    return true;
  });

  ws.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "Asset Tag", key: "assetTag", width: 16 },
    { header: "Asset Type", key: "assetType", width: 18 },
    { header: "Equipment Class", key: "equipmentClass", width: 18 },
    { header: "Description", key: "description", width: 28 },
    { header: "P\u0026ID Number", key: "pidNumber", width: 18 },
    { header: "P\u0026ID Page", key: "pidPage", width: 12 },
    { header: "Service", key: "service", width: 14 },
    { header: "Main Equipment", key: "mainEquipment", width: 20 },
    { header: "Location", key: "location", width: 14 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Area", key: "area", width: 10 },
    { header: "Legend", key: "legend", width: 16 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Detection Status", key: "detectionStatus", width: 16 },
    { header: "Review Status", key: "reviewStatus", width: 14 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "P1" };

  filtered.forEach((a, i) => {
    ws.addRow({
      no: i + 1,
      assetTag: a.assetTag ?? "",
      assetType: a.assetType,
      equipmentClass: a.equipmentClass ?? "",
      description: a.description ?? "",
      pidNumber: a.pidNumber ?? "",
      pidPage: a.pidPage ?? "",
      service: a.service ?? "",
      mainEquipment: a.mainEquipment ?? "",
      location: a.location ?? "",
      unit: a.unit ?? "",
      area: a.area ?? "",
      legend: a.legend ?? legendName,
      confidence: a.confidence ?? "",
      detectionStatus: a.detectionStatus,
      reviewStatus: a.reviewStatus,
    });
  });
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } };
    });
  });

  // Sheet 2: Equipment Summary
  const ws2 = wb.addWorksheet("Equipment Summary");
  ws2.columns = [{ header: "Asset Type", key: "t", width: 20 }, { header: "Count", key: "c", width: 10 }];
  ws2.getRow(1).font = { bold: true };
  const byType = new Map<string, number>();
  filtered.forEach((a) => byType.set(a.assetType, (byType.get(a.assetType) ?? 0) + 1));
  [...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, c]) => ws2.addRow({ t, c }));

  // Sheet 3: Detection Summary
  const ws3 = wb.addWorksheet("Detection Summary");
  ws3.columns = [{ header: "Metric", key: "k", width: 24 }, { header: "Value", key: "v", width: 14 }];
  ws3.getRow(1).font = { bold: true };
  ws3.addRows([
    { k: "Total Assets", v: filtered.length },
    { k: "High Confidence (>=0.95)", v: filtered.filter((a) => (a.confidence ?? 0) >= 0.95).length },
    { k: "Medium (0.80-0.94)", v: filtered.filter((a) => { const c = a.confidence ?? 0; return c >= 0.8 && c < 0.95; }).length },
    { k: "Needs Review (<0.80)", v: filtered.filter((a) => (a.confidence ?? 0) < 0.8).length },
  ]);

  // Sheet 4: Legend Used
  const ws4 = wb.addWorksheet("Legend Used");
  ws4.columns = [{ header: "Legend", key: "l", width: 32 }];
  ws4.getRow(1).font = { bold: true };
  ws4.addRow({ l: legendName });

  // Sheet 5: Detection Evidence
  const ws5 = wb.addWorksheet("Detection Evidence");
  ws5.columns = [
    { header: "Asset Tag", key: "tag", width: 16 },
    { header: "Asset Type", key: "type", width: 18 },
    { header: "Confidence", key: "conf", width: 12 },
    { header: "Legend Symbol", key: "sym", width: 16 },
    { header: "Evidence", key: "ev", width: 50 },
    { header: "P\u0026ID Number", key: "pid", width: 18 },
    { header: "Page", key: "pg", width: 10 },
    { header: "BBox (x,y,w,h)", key: "bbox", width: 22 },
  ];
  ws5.getRow(1).font = { bold: true };
  ws5.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  ws5.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws5.views = [{ state: "frozen", ySplit: 1 }];
  ws5.autoFilter = { from: "A1", to: "H1" };
  filtered.forEach((a) =>
    ws5.addRow({
      tag: a.assetTag ?? "",
      type: a.assetType,
      conf: a.confidence != null ? `${Math.round(a.confidence * 100)}%` : "",
      sym: a.legendSymbol ?? a.legend ?? "",
      ev: (a.evidence ?? []).join("; "),
      pid: a.pidNumber ?? "",
      pg: a.pidPage != null ? `Page ${a.pidPage}` : "",
      bbox:
        a.bboxX != null && a.bboxY != null && a.bboxW != null && a.bboxH != null
          ? `${a.bboxX},${a.bboxY},${a.bboxW},${a.bboxH}`
          : "",
    })
  );

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
