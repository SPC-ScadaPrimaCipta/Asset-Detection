import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { v4 as uuidv4 } from "uuid";
import IORedis from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";

import type { ExportAsset } from "../lib/excel-export";

async function main() {
  console.log("===============================================================================");
  console.log("            YOLO GEO-2 END-TO-END (E2E) SINGLE LOCAL TEST RUNNER              ");
  console.log("===============================================================================");

  // 1. Environment & Feature Flags Check
  const { default: db } = await import("../lib/db");
  const { env } = await import("../lib/env");
  const { isYoloEnabled } = await import("../lib/detection/feature-flags");
  const { getEffectiveGeo2Config } = await import("../lib/detection/yolo/yolo-geo2-config");
  const { buildAssetRegisterWorkbook } = await import("../lib/excel-export");
  const { computeIoU } = await import("../lib/detection/yolo/yolo-geo2-runner");

  console.log("\n[1. VERIFIKASI ENVIRONMENT & FLAGS]");
  console.log("• Database URL:", env.DATABASE_URL.replace(/:[^:@]+@/, ":***@"));
  console.log("• Redis URL:", env.REDIS_URL);
  console.log("• Storage Path:", env.STORAGE_PATH);
  console.log("• DETECTION_V3_ENABLED:", process.env.DETECTION_V3_ENABLED);
  console.log("• YOLO_ENABLED:", process.env.YOLO_ENABLED);
  console.log("• isYoloEnabled():", isYoloEnabled());

  if (!isYoloEnabled()) {
    console.error("FATAL: YOLO_ENABLED is not active in environment! Aborting.");
    process.exit(1);
  }

  // Pre-queue check: ensure no other jobs in BullMQ queue
  const redisConn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const checkQueue = new Queue("detection", { connection: redisConn });
  const waitingCount = await checkQueue.getWaitingCount();
  const activeCount = await checkQueue.getActiveCount();
  console.log(`• Antrean Redis 'detection': waiting=${waitingCount}, active=${activeCount}`);
  if (waitingCount > 0 || activeCount > 0) {
    console.error("FATAL: Ada job tertunda atau aktif di antrean! Aborting demi keselamatan.");
    await checkQueue.close();
    await redisConn.quit();
    process.exit(1);
  }

  // 2. Setup Dedicated Test Record for sheet-1-p1
  console.log("\n[2. MENYIAPKAN RECORD TEST BARU (ISOLATED)]");
  const sourcePdfPath = path.resolve(
    process.cwd(),
    "storage/eval-ab6fa321-0671-4518-8b56-fb1117d91068-ASBUILTSPPDT_11_PE_01_PP_001_Rev_1_P&ID_SP_Pondok_Tengah_Sheet_1.pdf"
  );
  if (!fs.existsSync(sourcePdfPath)) {
    console.error("FATAL: Source PDF sheet-1-p1 tidak ditemukan di storage!");
    process.exit(1);
  }

  const testFileStorageName = `test-e2e-${Date.now()}-sheet_1.pdf`;
  const destPdfPath = path.resolve(process.cwd(), "storage", testFileStorageName);
  fs.copyFileSync(sourcePdfPath, destPdfPath);
  const pdfStat = fs.statSync(destPdfPath);
  console.log(`• File PDF test disalin ke: storage/${testFileStorageName} (${pdfStat.size} bytes)`);

  // Target project (use existing 'test' project or pick the first available)
  const projRes = await db.query("SELECT id, name FROM projects WHERE name = 'test' LIMIT 1");
  const projectId = projRes.rows.length > 0 ? projRes.rows[0].id : (await db.query("SELECT id FROM projects LIMIT 1")).rows[0].id;
  console.log(`• Target Project ID: ${projectId}`);

  const testDocId = uuidv4();
  const testJobId = uuidv4();
  const testDocFilename = `E2E-TEST-YOLO-SHEET-1-${Date.now()}.pdf`;

  // Insert test document
  await db.query(
    `INSERT INTO documents (id, project_id, filename, file_path, page_count, mime_type, file_size)
     VALUES ($1, $2, $3, $4, 1, 'application/pdf', $5)`,
    [testDocId, projectId, testDocFilename, testFileStorageName, pdfStat.size]
  );
  console.log(`• Test Document dibuat: ID=${testDocId}, Filename=${testDocFilename}`);

  // Insert document_pages row for page 1
  await db.query(
    `INSERT INTO document_pages (id, document_id, page_number, width, height)
     VALUES ($1, $2, 1, 3573, 2526)`,
    [uuidv4(), testDocId]
  );
  console.log(`• Test Document Page 1 dibuat: 3573x2526`);

  // Insert detection_jobs record
  await db.query(
    `INSERT INTO detection_jobs (id, document_id, project_id, status, progress_pct)
     VALUES ($1, $2, $3, 'PENDING', 0)`,
    [testJobId, testDocId, projectId]
  );
  console.log(`• Test Detection Job dibuat: ID=${testJobId}, Status=PENDING`);

  // 3. Eksekusi alur aplikasi via BullMQ Detection Worker
  console.log("\n[3. MENJALANKAN WORKER DETEKSI APLIKASI (BULLMQ + YOLO GEO-2)]");
  // Import the real application worker & queue
  const { worker, detectionQueue } = await import("../workers/detection-worker");

  const startTime = Date.now();
  console.log(`• Mengirim job ${testJobId} ke antrean BullMQ...`);
  await detectionQueue.add(
    "detection",
    { jobId: testJobId },
    { jobId: testJobId, removeOnComplete: false, removeOnFail: false }
  );

  console.log("• Menunggu worker memproses job via BullMQ events...");
  let finalJobRow: any = null;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout: Worker tidak menyelesaikan job dalam 60 detik"));
    }, 60000);

    const onCompleted = (job: any) => {
      if (job.id === testJobId || job.data?.jobId === testJobId) {
        clearTimeout(timer);
        worker.off("completed", onCompleted);
        worker.off("failed", onFailed);
        resolve();
      }
    };

    const onFailed = (job: any, err: any) => {
      if (job?.id === testJobId || job?.data?.jobId === testJobId) {
        clearTimeout(timer);
        worker.off("completed", onCompleted);
        worker.off("failed", onFailed);
        reject(err);
      }
    };

    worker.on("completed", onCompleted);
    worker.on("failed", onFailed);
  });

  const jobQueryRes = await db.query("SELECT * FROM detection_jobs WHERE id = $1", [testJobId]);
  finalJobRow = jobQueryRes.rows[0];

  if (!finalJobRow) {
    console.error("FATAL: Job timeout setelah 60 detik!");
    process.exit(1);
  }

  console.log(`• Job selesai dengan status: ${finalJobRow.status} (Waktu: ${Date.now() - startTime}ms)`);
  if (finalJobRow.status !== "COMPLETED") {
    console.error("FATAL: Job gagal dengan error:", finalJobRow.error_detail);
    process.exit(1);
  }

  // 4. Verifikasi Hasil Nyata di Database
  console.log("\n[4. VERIFIKASI HASIL NYATA (PERSISTENCE & CONTRACTS)]");

  // A. Agent run check
  const agentRunRes = await db.query("SELECT * FROM agent_runs WHERE job_id = $1", [testJobId]);
  const agentRun = agentRunRes.rows[0];
  console.log("A. agent_runs Record:");
  console.log("   • ID:", agentRun?.id);
  console.log("   • Model:", agentRun?.model);
  console.log("   • Prompt Version:", agentRun?.prompt_version);
  console.log("   • Status:", agentRun?.status);
  console.log("   • Input Metadata:", agentRun?.input_metadata);
  console.log("   • Output Metadata:", agentRun?.output_metadata);

  if (agentRun?.model !== "yolo-pid-v8n-203.onnx" || agentRun?.prompt_version !== "geo2") {
    console.error("FATAL: agent_runs tidak mencerminkan YOLO GEO-2!");
    process.exit(1);
  }

  // B. Detections count & columns
  const detRes = await db.query("SELECT * FROM detections WHERE job_id = $1 ORDER BY confidence DESC", [testJobId]);
  const detections = detRes.rows;
  console.log(`\nB. Detections di Database: ${detections.length} rows`);

  if (detections.length !== 87) {
    console.error(`FATAL: Jumlah deteksi ${detections.length} tidak cocok dengan baseline 87!`);
    process.exit(1);
  }

  // Check attributes across all detections
  let invalidTagCount = 0;
  let invalidDescCount = 0;
  let invalidSourceCount = 0;
  let invalidStatusCount = 0;
  let invalidCoordCount = 0;

  for (const d of detections) {
    if (d.asset_tag !== null && d.asset_tag !== "") invalidTagCount++;
    if (d.description !== null && d.description !== "") invalidDescCount++;
    if (d.detection_source !== "YOLO_GEO2") invalidSourceCount++;
    if (d.detection_status !== "DETECTED" || d.review_status !== "PENDING") invalidStatusCount++;
    if (
      d.symbol_bbox_x === null ||
      d.symbol_bbox_y === null ||
      d.symbol_bbox_w === null ||
      d.symbol_bbox_h === null ||
      d.bbox_x === null ||
      d.bbox_y === null ||
      d.bbox_w === null ||
      d.bbox_h === null ||
      d.page_width !== 3573 ||
      d.page_height !== 2526
    ) {
      invalidCoordCount++;
    }
  }

  console.log("   • asset_tag IS NULL/kosong pada semua row:", invalidTagCount === 0);
  console.log("   • description IS NULL/kosong pada semua row:", invalidDescCount === 0);
  console.log("   • detection_source === 'YOLO_GEO2':", invalidSourceCount === 0);
  console.log("   • detection_status === 'DETECTED' & review_status === 'PENDING':", invalidStatusCount === 0);
  console.log("   • Dual-write koordinat kanonikal (symbol_bbox_*) & legacy (bbox_*) valid:", invalidCoordCount === 0);

  if (invalidTagCount > 0 || invalidDescCount > 0 || invalidSourceCount > 0 || invalidStatusCount > 0 || invalidCoordCount > 0) {
    console.error("FATAL: Terdapat anomali pada kolom deteksi!");
    process.exit(1);
  }

  // C. Periksa kesesuaian dengan Baseline 87 Fixture
  console.log("\nC. Baseline Comparison (87 GEO-2 Reference Detections):");
  const baselinePath = path.resolve(process.cwd(), "fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html");
  const fullPageHtml = fs.readFileSync(baselinePath, "utf8");
  const match = fullPageHtml.match(/const data = (\{[\s\S]*?\});\n/);
  const fullPageData = JSON.parse(match![1]);
  const baselineItems: Array<{
    id: string;
    rawLabel: string;
    confidence: number;
    box: { x1: number; y1: number; x2: number; y2: number };
  }> = fullPageData.configs.geo2.items;

  let exactMatches = 0;
  let maxCoordDiff = 0;
  let maxConfDiff = 0;

  for (const b of baselineItems) {
    let bestIoU = 0;
    let matchedDet: any = null;

    for (const d of detections) {
      const iou = computeIoU(
        {
          x1: d.symbol_bbox_x,
          y1: d.symbol_bbox_y,
          x2: d.symbol_bbox_x + d.symbol_bbox_w,
          y2: d.symbol_bbox_y + d.symbol_bbox_h,
        },
        b.box
      );
      if (iou > bestIoU) {
        bestIoU = iou;
        matchedDet = d;
      }
    }

    const evStr = Array.isArray(matchedDet?.evidence)
      ? matchedDet.evidence.join("; ")
      : JSON.stringify(matchedDet?.evidence);
    const cb = typeof matchedDet?.confidence_breakdown === 'string'
      ? JSON.parse(matchedDet.confidence_breakdown)
      : matchedDet?.confidence_breakdown;

    const labelMatches = cb?.rawLabel === b.rawLabel || evStr.includes(b.rawLabel);

    if (bestIoU >= 0.90 && matchedDet && labelMatches) {
      exactMatches++;
      const cDiff = Math.abs(matchedDet.confidence - b.confidence);
      if (cDiff > maxConfDiff) maxConfDiff = cDiff;
      const bDiff = Math.max(
        Math.abs(matchedDet.symbol_bbox_x - b.box.x1),
        Math.abs(matchedDet.symbol_bbox_y - b.box.y1),
        Math.abs(matchedDet.symbol_bbox_x + matchedDet.symbol_bbox_w - b.box.x2),
        Math.abs(matchedDet.symbol_bbox_y + matchedDet.symbol_bbox_h - b.box.y2),
      );
      if (bDiff > maxCoordDiff) maxCoordDiff = bDiff;
    }
  }

  console.log(`   • Baseline exact matches (IoU >= 0.90, label match): ${exactMatches} / 87`);
  console.log(`   • Max coordinate diff: ${maxCoordDiff.toFixed(3)} px (integer rounding tolerance)`);
  console.log(`   • Max confidence diff: ${maxConfDiff.toExponential(4)}`);
  if (exactMatches !== 87) {
    console.error(`FATAL: Hanya ${exactMatches} dari 87 deteksi yang cocok persis dengan baseline!`);
    process.exit(1);
  }

  // D. Verifikasi Viewer Alignment Contract
  console.log("\n[5. VERIFIKASI VIEWER ALIGNMENT CONTRACT]");
  // Test sample detection scaling
  const sample = detections[0];
  const imgNaturalW = 3573;
  const imgNaturalH = 2526;
  const canonicalX = (sample.symbol_bbox_x / sample.page_width) * imgNaturalW;
  const canonicalY = (sample.symbol_bbox_y / sample.page_height) * imgNaturalH;
  const legacyX = (sample.bbox_x / 1000) * imgNaturalW;
  const legacyY = (sample.bbox_y / 1000) * imgNaturalH;

  console.log(`   • Sample ${sample.asset_type} (conf: ${sample.confidence}):`);
  console.log(`     - Canonical pixel bbox: [${sample.symbol_bbox_x}, ${sample.symbol_bbox_y}, ${sample.symbol_bbox_w}, ${sample.symbol_bbox_h}]`);
  console.log(`     - Viewer SVG calculated position: (${canonicalX.toFixed(1)}, ${canonicalY.toFixed(1)})`);
  console.log(`     - Legacy fallback position: (${legacyX.toFixed(1)}, ${legacyY.toFixed(1)})`);
  console.log(`     - Canonical alignment diff: ${Math.abs(canonicalX - sample.symbol_bbox_x)}px (0px diff expected)`);

  // E. Uji Alur Review Manusia (Confirm & Reject)
  console.log("\n[6. VERIFIKASI HUMAN REVIEW WORKFLOW]");
  const firstId = detections[0].id;
  const secondId = detections[1].id;

  // Confirm detection 1
  await db.query("UPDATE detections SET review_status = 'APPROVED' WHERE id = $1", [firstId]);
  // Reject detection 2
  await db.query("UPDATE detections SET review_status = 'REJECTED' WHERE id = $1", [secondId]);

  const reviewCheck = await db.query(
    "SELECT review_status, count(*) FROM detections WHERE job_id = $1 GROUP BY review_status",
    [testJobId]
  );
  console.log("   • Status Review setelah simulasi human review:", reviewCheck.rows);

  // F. Uji Export Excel
  console.log("\n[7. VERIFIKASI EXCEL ASSET REGISTER EXPORT]");
  const allExportAssets: ExportAsset[] = detections.map((d) => ({
    assetTag: d.id === firstId ? d.asset_tag : d.id === secondId ? d.asset_tag : d.asset_tag,
    assetType: d.asset_type,
    equipmentClass: d.equipment_class,
    description: d.description,
    pidNumber: d.pid_number,
    pidPage: d.pid_page,
    service: d.service,
    mainEquipment: d.main_equipment,
    location: d.location,
    unit: d.unit,
    area: d.area,
    legend: d.legend_id,
    legendSymbol: d.legend_symbol_id,
    confidence: d.confidence,
    detectionStatus: d.detection_status,
    reviewStatus: d.id === firstId ? "APPROVED" : d.id === secondId ? "REJECTED" : "PENDING",
    evidence: Array.isArray(d.evidence) ? d.evidence : JSON.parse(d.evidence || "[]"),
    bboxX: d.bbox_x,
    bboxY: d.bbox_y,
    bboxW: d.bbox_w,
    bboxH: d.bbox_h,
    size: null,
    fromRef: null,
    toRef: null,
    ofOrAtRef: null,
    descriptionProposed: null,
    tagNoProposed: null,
  }));

  // Build workbook with includeReviewItems = true
  const excelBuffer = await buildAssetRegisterWorkbook(allExportAssets, "ISO 10628-2", {
    includeReviewItems: true,
  });
  console.log(`   • Excel Workbook berhasil digenerate: ${excelBuffer.length} bytes`);

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excelBuffer);

  const sheet1 = wb.getWorksheet("Asset Register");
  const sheet5 = wb.getWorksheet("Detection Evidence");

  console.log(`   • Sheet 1 ("Asset Register") row count: ${sheet1?.rowCount}`);
  console.log(`   • Sheet 5 ("Detection Evidence") row count: ${sheet5?.rowCount}`);

  // In Sheet 1:
  // Total filtered items = 87 - 1 (REJECTED excluded) = 86 items.
  // Header is 3 rows, so total rows = 3 + 86 = 89.
  console.log(`   • Sheet 1 row count expected: 89 (3 headers + 86 non-rejected rows) -> Actual: ${sheet1?.rowCount}`);
  if (sheet1?.rowCount !== 89) {
    console.error(`FATAL: Sheet 1 row count tidak sesuai!`);
    process.exit(1);
  }

  // Check fabricated metadata in Sheet 1: all asset tags must be empty string
  let fabricatedTagCount = 0;
  sheet1?.eachRow((row, rowNumber) => {
    if (rowNumber > 3) {
      const tagVal = row.getCell(5).value; // Tag Number column
      if (tagVal !== "" && tagVal !== null && tagVal !== undefined) {
        fabricatedTagCount++;
      }
    }
  });
  console.log(`   • Tag rekaan / fabricated di Sheet 1: ${fabricatedTagCount} (0 expected)`);
  if (fabricatedTagCount > 0) {
    console.error("FATAL: Ditemukan tag rekaan pada export!");
    process.exit(1);
  }

  // Close connections
  await worker.close();
  await detectionQueue.close();
  await checkQueue.close();
  await redisConn.quit();
  await db.end();

  console.log("\n===============================================================================");
  console.log("                     E2E TEST BERHASIL SEMPURNA (100% PASS)                    ");
  console.log(`  Job ID: ${testJobId}`);
  console.log(`  Document ID: ${testDocId}`);
  console.log(`  Document Filename: ${testDocFilename}`);
  console.log(`  PDF Storage: ${testFileStorageName}`);
  console.log("===============================================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E Runner Error:", err);
  process.exit(1);
});
