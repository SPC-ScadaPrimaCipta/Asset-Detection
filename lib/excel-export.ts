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

  const colWidths = [6, 20, 25, 25, 16, 25, 28, 12, 18, 15, 12, 8, 18, 15, 15, 10, 15, 18, 14, 25];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: SAP codes mapped logically to their respective headers
  const row1 = ws.addRow([
    "", "", "", "", "", "", "", "",
    "KLASSE", "EQART", "BRGEW", "GEWEI", "INVNR", "INBDT", "ANSWT", "WAERS", "ANSDT", "GROES", "STORT", "HZEIN"
  ]);

  // Row 2: Lengths mapped logically to their respective SAP codes (KLASSE=18, EQART=10, BRGEW=17, GEWEI=3)
  const row2 = ws.addRow([
    "", "", "", "", "", "", "", "",
    "18", "10", "17", "3", "", "", "", "", "", "", "", ""
  ]);

  // Row 3: Descriptive headers
  const row3 = ws.addRow([
    "No",
    "Equipment Tag No Proposed",
    "Equipment Type For Description",
    "Size / From / To / Of / At",
    "Tag Number",
    "Alternative Description OLD / by ACN",
    "Description Proposed",
    "Description Len",
    "Class",
    "Object Type",
    "Weight",
    "UOM",
    "Inventory No.",
    "Start-up Date",
    "Acquisition Value",
    "Currency",
    "Acquisition Date",
    "Size/Dimension",
    "Location",
    "Manufacture Drawing No."
  ]);

  row1.font = { bold: true };
  row2.font = { bold: true };

  row3.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  row3.alignment = { vertical: "middle", horizontal: "center" };
  row3.height = 22;

  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: "A3", to: "T3" };

  filtered.forEach((a, i) => {
    const sizeFromToOfAt = [a.size, a.fromRef, a.toRef, a.ofOrAtRef].filter(Boolean).join(" / ");

    ws.addRow([
      i + 1,
      a.tagNoProposed ?? "",
      a.assetType ?? "",
      sizeFromToOfAt,
      a.assetTag ?? "",
      "", // Alternative Description OLD / by ACN
      a.descriptionProposed ?? "",
      a.description ? a.description.length : 0,
      a.equipmentClass ?? "",
      "", // Object Type
      "", // Weight
      "", // UOM
      "", // Inventory No.
      "", // Start-up Date
      "", // Acquisition Value
      "", // Currency
      "", // Acquisition Date
      a.size ?? "",
      a.location ?? "",
      a.pidNumber ?? ""
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
