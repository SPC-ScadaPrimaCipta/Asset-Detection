import 'dotenv/config';
// Override GEMINI_API_KEY from .env directly — dotenv v16 may decrypt AQ. keys incorrectly
import { readFileSync } from 'fs';
import { resolve } from 'path';
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    // Set directly — do not let dotenv decrypt/override
    if (val) process.env[key] = val;
  }
} catch { /* .env not found — rely on system env */ }
import { Worker, Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { getFile } from "@/lib/storage";
import { runDetectionAgent } from "@/lib/ai-agent";
import { associateTagsToSymbols } from "@/lib/spatial";
import { renderPageToPng, extractPdfTextByPage } from "@/lib/pdf-render";
import { getAiConfig } from "@/lib/ai-config";
import { env } from "@/lib/env";

const REDIS_URL = env.REDIS_URL;

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
export const detectionQueue = new Queue("detection", { connection });

// Observability: jobId, documentId, page, model, duration, status, error — never log secrets
export const worker = new Worker(
  "detection",
  async (job: Job<{ jobId: string; legendId?: string }>) => {
    const { jobId, legendId } = job.data as { jobId: string; legendId?: string };
    const start = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      console.log(`[detection] job=${jobId} ${msg}`, extra ?? "");

    await db.query(
      "UPDATE detection_jobs SET status='PROCESSING', started_at=NOW(), progress_pct=5 WHERE id=$1",
      [jobId]
    );
    const aiCfg = await getAiConfig();
    const agentRunId = uuidv4();
    const modelName = aiCfg.provider === "deepseek" ? aiCfg.deepseekModel : aiCfg.geminiModel;
    const promptVersion = "v1";
    // Hoisted — referenced in both try and catch for cleanup
    let geminiFileUri: string | undefined;
    await db.query(
      "INSERT INTO agent_runs (id, job_id, model, prompt_version, status, input_metadata) VALUES ($1,$2,$3,$4,'RUNNING',$5)",
      [agentRunId, jobId, modelName, promptVersion, JSON.stringify({ pageCount: null })]
    );

    try {
      const jrow = (await db.query("SELECT * FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
      if (!jrow) throw new Error("Job not found");
      const doc = (await db.query("SELECT * FROM documents WHERE id=$1", [jrow.document_id])).rows[0];
      if (!doc) throw new Error("Document not found");

      // Use legendId from job row if not passed in job data
      const effectiveLegendId = legendId ?? jrow.legend_id ?? null;

      log("start", {
        documentId: doc.id,
        legendId: effectiveLegendId ?? "none",
        model: modelName,
        promptVersion,
      });

      const legendSymbols = effectiveLegendId
        ? (await db.query("SELECT * FROM legend_symbols WHERE legend_id=$1", [effectiveLegendId])).rows
        : [];

      const tagPatterns: RegExp[] = legendSymbols
        .filter((s: Record<string, unknown>) => s.tag_pattern)
        .map((s: Record<string, unknown>) => {
          const raw = String(s.tag_pattern);
          // Convert P-### style: # → \d, * → .* — safe identifier, no SQL interp
          const esc = raw
            .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
            .replace(/#/g, "\\d")
            .replace(/\*/g, ".*");
          return new RegExp(`^${esc}$`, "i");
        });

      const buf = (await getFile(doc.file_path)) as unknown as Buffer;
      const pageCount: number = doc.page_count ?? 1;
      const ocrPages = await extractPdfTextByPage(buf);

      // PNG render mode: render each page individually via mupdf → send to Gemini Vision.
      // This is significantly more accurate than sending the full PDF:
      //   - Gemini Vision focuses on exactly one page at a time (no ambiguity)
      //   - High-res PNG (3x scale ≈ 216 dpi) captures fine P&ID symbols clearly
      //   - Bounding box coordinates map directly to PNG pixel space
      //
      // Fallback chain:
      //   1. Per-page PNG via mupdf (best accuracy)
      //   2. Gemini Files API fileUri (if mupdf fails for a page)
      //   3. Inline full PDF base64 (last resort, least accurate)

      // Pre-upload PDF to Gemini Files API as fallback if mupdf render fails per-page
      let geminiFileUriFallback: string | undefined;
      if (aiCfg.provider !== "deepseek" && aiCfg.geminiKey) {
        try {
          const { uploadPdfToGemini } = await import("@/lib/gemini");
          const uploaded = await uploadPdfToGemini(buf, doc.filename);
          geminiFileUri = uploaded.fileUri;
          geminiFileUriFallback = geminiFileUri;
          log("gemini file uploaded (fallback ready)", { fileUri: geminiFileUri });
        } catch (uploadErr: unknown) {
          const umsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          log("gemini file upload failed (will use inline base64 as last fallback)", { error: umsg.slice(0, 200) });
        }
      }

      await db.query("UPDATE agent_runs SET input_metadata=$1 WHERE id=$2", [
        JSON.stringify({
          pageCount,
          legendCount: legendSymbols.length,
          renderMode: "mupdf-png",
          geminiFileUriFallback: geminiFileUriFallback ?? null,
        }),
        agentRunId,
      ]);

      for (let page = 1; page <= pageCount; page++) {
        const pageStart = Date.now();
        let detections: Awaited<ReturnType<typeof runDetectionAgent>>["detections"] = [];

        // Render page to PNG — primary input for Gemini Vision
        let pageImageBase64: string | undefined;
        let pngDimensions: { width: number; height: number } | undefined;
        try {
          const { png, width, height } = await renderPageToPng(buf, page, 3.0);
          pageImageBase64 = png.toString("base64");
          pngDimensions = { width, height };
          log(`page ${page} PNG rendered`, {
            page,
            sizeKB: Math.round(png.length / 1024),
          });
        } catch (renderErr: unknown) {
          const rmsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
          log(`page ${page} PNG render failed, falling back to fileUri/PDF`, {
            page,
            error: rmsg.slice(0, 200),
          });
          // pageImageBase64 stays undefined → agent uses fileUri or pdfBase64 fallback
        }

        try {
          const result = await runDetectionAgent({
            page,
            pageImageBase64,
            fileUri: geminiFileUriFallback,
            pdfBase64: !pageImageBase64 && !geminiFileUriFallback
              ? buf.toString("base64")
              : undefined,
            legendId: effectiveLegendId ?? "",
            legendSymbols: legendSymbols as Parameters<typeof runDetectionAgent>[0]["legendSymbols"],
            ocrText: ocrPages[page - 1] ?? "",
            pngWidth: pngDimensions?.width,
            pngHeight: pngDimensions?.height,
          });
          detections = result.detections;

          log(`page ${page}/${pageCount} detections=${detections.length}`, {
            page,
            count: detections.length,
            ms: Date.now() - pageStart,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`page ${page} AI error`, { page, error: msg.slice(0, 500) });
          // Do not persist malformed output — skip page, continue job
          await db.query("UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2", [
            Math.round(5 + (page / pageCount) * 90),
            jobId,
          ]);
          continue;
        }

        const validated = associateTagsToSymbols(detections, tagPatterns);

        // Cancelled check
        const cur = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
        if (cur?.status === "CANCELLED") {
          log("cancelled by user");
          break;
        }

        for (const d of validated) {
          const legendSym = d.legendSymbol
            ? legendSymbols.find(
                (s: Record<string, unknown>) =>
                  s.asset_type === d.legendSymbol || s.symbol_name === d.legendSymbol
              )
            : null;
          await db.query(
            `INSERT INTO detections
               (id, job_id, document_id, asset_tag, asset_type, equipment_class, description,
                service, location, unit, area, pid_number, pid_page,
                legend_id, legend_symbol_id, confidence,
                bbox_x, bbox_y, bbox_w, bbox_h, evidence, detection_status, review_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'DETECTED','PENDING')`,
            [
              uuidv4(),
              jobId,
              doc.id,
              d.assetTag ?? null,
              d.assetType,
              (d as Record<string, unknown>).equipmentClass ?? null,
              d.description ?? null,
              (d as Record<string, unknown>).service ?? null,
              (d as Record<string, unknown>).location ?? null,
              (d as Record<string, unknown>).unit ?? null,
              (d as Record<string, unknown>).area ?? null,
              doc.filename,
              page,
              effectiveLegendId ?? null,
              (legendSym as Record<string, unknown> | undefined)?.id ?? null,
              d.confidence,
              Number.isFinite(d.bbox.x) ? d.bbox.x : 0,
              Number.isFinite(d.bbox.y) ? d.bbox.y : 0,
              Number.isFinite(d.bbox.width) ? d.bbox.width : 0,
              Number.isFinite(d.bbox.height) ? d.bbox.height : 0,
              JSON.stringify(d.evidence),
            ]
          );
        }

        await db.query("UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2", [
          Math.round(5 + (page / pageCount) * 90),
          jobId,
        ]);
      }

      const final = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];

      // Cleanup Gemini uploaded file — non-fatal, files expire after 48h anyway
      if (geminiFileUri) {
        const { deleteGeminiFile } = await import("@/lib/gemini");
        await deleteGeminiFile(geminiFileUri);
        log("gemini file deleted", { fileUri: geminiFileUri });
      }

      if (final?.status === "CANCELLED") {
        await db.query(
          "UPDATE agent_runs SET status='CANCELLED', completed_at=NOW(), output_metadata=$1 WHERE id=$2",
          [JSON.stringify({ durationMs: Date.now() - start }), agentRunId]
        );
        return { jobId, status: "CANCELLED" };
      }

      await db.query(
        "UPDATE detection_jobs SET status='COMPLETED', progress_pct=100, completed_at=NOW() WHERE id=$1",
        [jobId]
      );
      await db.query(
        "UPDATE agent_runs SET status='COMPLETED', completed_at=NOW(), output_metadata=$1 WHERE id=$2",
        [JSON.stringify({ durationMs: Date.now() - start }), agentRunId]
      );
      log("completed", { durationMs: Date.now() - start });
      return { jobId, status: "COMPLETED" };
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      // Best-effort cleanup even on failure
      if (geminiFileUri) {
        const { deleteGeminiFile } = await import("@/lib/gemini").catch(() => ({ deleteGeminiFile: async () => {} }));
        await deleteGeminiFile(geminiFileUri);
      }
      await db.query(
        "UPDATE detection_jobs SET status='FAILED', error_detail=$1, completed_at=NOW() WHERE id=$2",
        [msg, jobId]
      );
      await db.query(
        "UPDATE agent_runs SET status='FAILED', error=$1, completed_at=NOW() WHERE id=$2",
        [msg, agentRunId]
      );
      log("failed", { error: msg.slice(0, 500), durationMs: Date.now() - start });
      throw e;
    }
  },
  { connection, concurrency: 1 }
);

// Recovery: on worker startup, re-queue any PENDING jobs left over from previous crashes/restarts
async function recoverPendingJobs() {
  try {
    const rows = (
      await db.query(
        "SELECT id, legend_id FROM detection_jobs WHERE status='PENDING' ORDER BY created_at ASC LIMIT 50"
      )
    ).rows;

    if (rows.length === 0) return;
    console.log(`[detection] recovery: found ${rows.length} PENDING job(s), re-queuing...`);

    for (const row of rows) {
      try {
        await detectionQueue.add(
          "detection",
          { jobId: row.id, legendId: row.legend_id ?? null },
          { jobId: row.id, removeOnComplete: true, removeOnFail: 100 }
        );
        console.log(`[detection] recovery: queued job=${row.id}`);
      } catch (e: unknown) {
        // Job may already be in queue — ignore duplicate key errors
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("Job")) {
          console.warn(`[detection] recovery: failed to queue job=${row.id}`, msg.slice(0, 200));
        }
      }
    }
  } catch (e: unknown) {
    console.warn("[detection] recovery error:", e instanceof Error ? e.message : String(e));
  }
}

// Run recovery after a short delay to let DB connection settle
setTimeout(recoverPendingJobs, 3000);
