import ExcelJS from "exceljs";

export interface ExportAsset {
  assetTag: string | null;
  assetType: string;
  equipmentClass: string | null;
  description: string | null;
  pidNumber: string | null;
  pidPage: number | null;
  service: string | null;
  mainEquipment: string | null;
  location: string | null;
  unit: string | null;
  area: string | null;
  legend: string | null;
  legendSymbol: string | null;
  confidence: number | null;
  detectionStatus: string;
  reviewStatus: string;
  evidence: string[];
  bboxX: number | null;
  bboxY: number | null;
  bboxW: number | null;
  bboxH: number | null;

  // New 6 fields for SAP-ready format
  size: string | null;
  fromRef: string | null;
  toRef: string | null;
  ofOrAtRef: string | null;
  descriptionProposed: string | null;
  tagNoProposed: string | null;
}

export interface ExportThresholds {
  /** Confidence >= this = "High". Default 0.95. */
  high: number;
  /** Confidence >= this AND < high = "Medium". Default 0.80. */
  medium: number;
  /** Confidence < medium = "Needs Review". Should match DETECTION_REVIEW_THRESHOLD. Default 0.65. */
  review: number;
}

const DEFAULT_THRESHOLDS: ExportThresholds = { high: 0.95, medium: 0.80, review: 0.65 };

export async function buildAssetRegisterWorkbook(
  assets: ExportAsset[],
  legendName: string,
  opts: { includeReviewItems: boolean; thresholds?: Partial<ExportThresholds> }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asset Detection";
  wb.created = new Date();

  // Merge caller thresholds with defaults — ensures Excel bands match the real
  // DETECTION_REVIEW_THRESHOLD used by UI and DB validation_status.
  const thr: ExportThresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };

  // Sheet 1: Asset Register (rejected excluded; review filtered by opts)
  const ws = wb.addWorksheet("Asset Register", { properties: { tabColor: { argb: "FF4361EE" } } });
  const filtered = assets.filter((a) => {
    if (a.detectionStatus === "REJECTED" || a.reviewStatus === "REJECTED") return false;
    if (!opts.includeReviewItems && a.reviewStatus === "PENDING") return false;
    return true;
  });

  const colWidths = [
    6,   // 1. #
    15,  // 2. Equipment
    20,  // 3. Tag No Proposed
    16,  // 4. Equipment Type
    22,  // 5. For Description
    12,  // 6. Size
    14,  // 7. From
    14,  // 8. To
    12,  // 9. Of
    12,  // 10. At
    18,  // 11. Tag Number
    22,  // 12. Alternative Description by ACN (OLD)
    22,  // 13. Alternative Description by ACN
    24,  // 14. Description Proposed
    25,  // 15. Description
    8,   // 16. Len
    14,  // 17. Class
    14,  // 18. Object Type
    14,  // 19. Type
    12,  // 20. Weight
    8,   // 21. UOM
    16,  // 22. Inventory No.
    16,  // 23. Size/Dimension
    14,  // 24. Start-up Date
    16,  // 25. Acquisition Value
    10,  // 26. Currency
    16,  // 27. Acquisition Date
    16,  // 28. Location
    25,  // 29. Manufacture Drawing No.
  ];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: SAP codes mapped logically to their respective headers
  const row1 = ws.addRow([
    "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    "KLASSE", "OBJECT_TYPE", "TYPE", "BRGEW", "GEWEI", "INVNR", "GROES", "INBDT", "ANSWT", "WAERS", "ANSDT", "STORT", "HZEIN"
  ]);

  // Row 2: Lengths mapped logically to their respective SAP codes
  const row2 = ws.addRow([
    "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    "18", "10", "10", "17", "3", "25", "18", "8", "17", "4", "17", "10", "45"
  ]);

  // Row 3: Descriptive headers (29 columns)
  const row3 = ws.addRow([
    "#",
    "Equipment",
    "Tag No Proposed",
    "Equipment Type",
    "For Description",
    "Size",
    "From",
    "To",
    "Of",
    "At",
    "Tag Number",
    "Alternative Description by ACN (OLD)",
    "Alternative Description by ACN",
    "Description Proposed",
    "Description",
    "Len",
    "Class",
    "Object Type",
    "Type",
    "Weight",
    "UOM",
    "Inventory No.",
    "Size/Dimension",
    "Start-up Date",
    "Acquisition Value",
    "Currency",
    "Acquisition Date",
    "Location",
    "Manufacture Drawing No."
  ]);

  row1.font = { bold: true, size: 9, color: { argb: "FF595959" } };
  row1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  row1.alignment = { vertical: "middle", horizontal: "center" };

  row2.font = { bold: true, size: 9, color: { argb: "FF595959" } };
  row2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  row2.alignment = { vertical: "middle", horizontal: "center" };

  row3.height = 26;
  const redHeaderCols = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 19]);
  row3.eachCell((cell, colNum) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF70AD47" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.font = {
      bold: true,
      color: { argb: redHeaderCols.has(colNum) ? "FFC00000" : "FF000000" }
    };
  });

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: "A3", to: "AC3" };

  filtered.forEach((a, i) => {
    ws.addRow([
      i + 1,                                                 // 1. #
      a.mainEquipment ?? `EQ-${String(i + 1).padStart(6, '0')}`, // 2. Equipment
      a.tagNoProposed ?? a.assetTag ?? "",                   // 3. Tag No Proposed
      a.assetType ?? "",                                     // 4. Equipment Type
      a.descriptionProposed ?? a.description ?? "",          // 5. For Description
      a.size ?? "",                                          // 6. Size
      a.fromRef ?? "",                                       // 7. From
      a.toRef ?? "",                                         // 8. To
      a.ofOrAtRef ?? "",                                     // 9. Of
      "",                                                    // 10. At
      a.assetTag ?? "",                                      // 11. Tag Number
      "",                                                    // 12. Alternative Description by ACN (OLD)
      "",                                                    // 13. Alternative Description by ACN
      a.descriptionProposed ?? "",                           // 14. Description Proposed
      a.description ?? "",                                   // 15. Description
      a.description ? a.description.length : 0,              // 16. Len
      a.equipmentClass ?? "",                                // 17. Class
      "",                                                    // 18. Object Type
      "",                                                    // 19. Type
      "",                                                    // 20. Weight
      "",                                                    // 21. UOM
      "",                                                    // 22. Inventory No.
      a.size ?? "",                                          // 23. Size/Dimension
      "",                                                    // 24. Start-up Date
      "",                                                    // 25. Acquisition Value
      "",                                                    // 26. Currency
      "",                                                    // 27. Acquisition Date
      a.location ?? "",                                      // 28. Location
      a.pidNumber ?? ""                                      // 29. Manufacture Drawing No.
    ]);
  });

  ws.eachRow((row, n) => {
    if (n <= 3) return;
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } }
      };
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
    { k: `High Confidence (>=${thr.high})`, v: filtered.filter((a) => (a.confidence ?? 0) >= thr.high).length },
    { k: `Medium (${thr.medium}-${thr.high - 0.01})`, v: filtered.filter((a) => { const c = a.confidence ?? 0; return c >= thr.medium && c < thr.high; }).length },
    { k: `Needs Review (<${thr.medium})`, v: filtered.filter((a) => (a.confidence ?? 0) < thr.medium).length },
    { k: `Review Threshold (DETECTION_REVIEW_THRESHOLD)`, v: thr.review },
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
    { header: "P&ID Number", key: "pid", width: 18 },
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
