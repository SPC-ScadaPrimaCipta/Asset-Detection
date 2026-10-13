import { Worker, Queue, type Job, type WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { getFile } from "@/lib/storage";
import { runDetectionAgent } from "@/lib/ai-agent";
import { associateTagsToSymbols, applyNMS } from "@/lib/spatial";
import { renderPageToPng } from "@/lib/pdf-render";
import { env } from "@/lib/env";
import { getTuning } from "@/lib/tuning";
import {
  deleteDetectionsForPage,
  persistDetections,
  type PersistableDetection,
} from "@/lib/detection/persistence/detection-repository";
import { isTerminalJobStatus } from "@/lib/detection/job-status";
import { isYoloEnabled } from "@/lib/detection/feature-flags";
import { runYoloGeo2Page } from "@/lib/detection/yolo/yolo-geo2-runner";
import {
  DEFAULT_GEO2_CONFIG,
  getEffectiveGeo2Config,
} from "@/lib/detection/yolo/yolo-geo2-config";

/**
 * Detection worker — 100% Gemini Vision, per page.
 *
 * Pipeline per page (mirrors Scan Legend, lib/legend-extract.ts):
 *   render PDF page → PNG → runDetectionAgent (Gemini vision, legend in prompt)
 *   → rule validation + confidence calibration (inside the agent)
 *   → legend tag-pattern association + NMS
 *   → persist
 *
 * No OCR, no OpenCV/CV sidecar, no tiling, no model fusion. The rendered page
 * PNG is the only model input; provider/model come from Settings via getAiConfig().
 */

/**
 * Infer drawing type from document filename.
 * Returns 'P&ID', 'PFD', 'ISOMETRIC', or null.
 * Used to activate Level 1 company knowledge hierarchy (project + drawing_type + tag).
 */
function inferDrawingType(filename: string): string | null {
  const upper = filename.toUpperCase();
  if (/\bPFD\b/.test(upper)) return "PFD";
  if (/ISOMETR/i.test(upper)) return "ISOMETRIC";
  if (/\bPID\b|\bP&ID\b|P_ID|P-ID/.test(upper)) return "P&ID";
  // Default: most engineering documents are P&ID unless stated otherwise
  if (/\.PDF$/i.test(filename)) return "P&ID";
  return null;
}

/** Legend `tag_pattern` (P-### style) → RegExp, for tag validation. */
function buildTagPatterns(
  symbols: { tag_pattern?: string | null }[],
): RegExp[] {
  return symbols
    .filter((s) => s.tag_pattern)
    .map((s) => {
      const raw = String(s.tag_pattern);
      // Convert P-### style: # → \d, * → .* — safe identifier, no SQL interp
      const esc = raw
        .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
        .replace(/#/g, "\\d")
        .replace(/\*/g, ".*");
      return new RegExp(`^${esc}$`, "i");
    });
}

const REDIS_URL = env.REDIS_URL;

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
export const detectionQueue = new Queue("detection", { connection });

// Observability: jobId, documentId, page, model, duration, status, error — never log secrets
export const worker = new Worker(
  "detection",
  async (job: Job<{ jobId: string; legendId?: string; legendIds?: string[] }>) => {
    const { jobId, legendId, legendIds: payloadLegendIds } = job.data as {
      jobId: string;
      legendId?: string;
      legendIds?: string[];
    };
    const start = Date.now();
    const log = (msg: string, extra?: Record<string, unknown>) =>
      console.log(`[detection] job=${jobId} ${msg}`, extra ?? "");

    const yoloActive = isYoloEnabled();
    const agentRunId = uuidv4();
    const modelName = yoloActive ? "yolo-pid-v8n-203.onnx" : "gemini-vision-only";
    const promptVersion = yoloActive ? "geo2" : "v2";

    try {
      // Terminal-state guard, BEFORE any state write. A stalled or duplicated
      // delivery can reach this processor for a job that already finished:
      // BullMQ re-queues a job whose lock expired, and a manual re-trigger can
      // enqueue one that is still running. Either way the second runner must do
      // no work at all, otherwise it appends a duplicate copy of every detection
      // for the whole document. Claiming the row conditionally (below) also
      // makes the claim itself atomic: only one runner can win the transition
      // out of a non-terminal state.
      const claim = await db.query(
        `UPDATE detection_jobs
            SET status='PROCESSING', started_at=NOW(), progress_pct=5
          WHERE id=$1 AND (status IS NULL OR status NOT IN ('COMPLETED','CANCELLED','FAILED'))
        RETURNING status, document_id, legend_id, project_id`,
        [jobId],
      );
      const claimed = claim.rows[0];
      if (!claimed) {
        const existing = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId]))
          .rows[0] as { status?: string } | undefined;
        if (!existing) throw new Error("Job not found");
        // The claim only misses when the row is already terminal, so this branch
        // is the duplicate-delivery path. Report which terminal state it was.
        log(
          `skipped: job is already ${existing.status ?? 'in a terminal state'}` +
            (isTerminalJobStatus(existing.status) ? '' : ' (unexpected — claimed by another runner)'),
        );
        return { jobId, status: existing.status ?? 'SKIPPED', skipped: true };
      }
      const jrow = claimed;

      const doc = (await db.query("SELECT * FROM documents WHERE id=$1", [jrow.document_id])).rows[0];
      if (!doc) throw new Error("Document not found");

      // Use legendIds from the queue payload if present, else the job row
      // (legend_ids authoritative, legend_id legacy fallback). Order = priority.
      const { effectiveJobLegendIds, mergeLegendSymbols, buildSourcedTagPatterns, toJobLegendSymbolRows } =
        await import("@/lib/job-legends");
      const effectiveLegendIds =
        Array.isArray(payloadLegendIds) && payloadLegendIds.length > 0
          ? payloadLegendIds.filter((v): v is string => typeof v === "string" && v !== "")
          : effectiveJobLegendIds(jrow);
      const effectiveLegendId = effectiveLegendIds[0] ?? legendId ?? jrow.legend_id ?? null;

      // Infer drawing type from filename for company knowledge Level 1 hierarchy
      const drawingType = inferDrawingType(doc.filename);

      const buf = (await getFile(doc.file_path)) as unknown as Buffer;
      const pageCount: number = doc.page_count ?? 1;

      // Resolve tuning once per job, before any page work.
      const tuning = await getTuning();
      const NULL_THRESHOLD = tuning.detection.nullFieldConfidenceThreshold;
      const NMS_IOU = tuning.detection.nmsIouThreshold;
      const renderScale = yoloActive
        ? DEFAULT_GEO2_CONFIG.pdfRenderScale
        : tuning.detection.renderScale;
      const regionMode = yoloActive ? "yolo-tiling-1280" : tuning.regions.mode;

      log("start", {
        documentId: doc.id,
        legendId: effectiveLegendId ?? "none",
        legendIds: effectiveLegendIds.length > 0 ? effectiveLegendIds : "none",
        model: modelName,
        promptVersion,
        renderScale,
        regionMode,
      });
      console.log(`[Detection] pipeline=${yoloActive ? "yolo-geo2-local" : "gemini-vision-only"} regions=${regionMode}`);
      console.log("[Detection] ocr=false");
      console.log("[Detection] cv=false");
      console.log(`[Detection] render scale=${renderScale}`);
      console.log(`[Detection] input pages=${pageCount}`);

      // Multi-legend load, in priority order. Each symbol carries its source
      // legend so conflicts resolve by priority and detections record the
      // legend that actually matched.
      const legendRows = effectiveLegendIds.length > 0
        ? (await db.query("SELECT id, name FROM legends WHERE id = ANY($1::uuid[])", [
            `{${effectiveLegendIds.join(",")}}`,
          ])).rows as { id: string; name: string }[]
        : [];
      const legendById = new Map(legendRows.map((r) => [String(r.id), String(r.name ?? "Legend")]));
      const symbolRows = effectiveLegendIds.length > 0
        ? (await db.query(
            "SELECT * FROM legend_symbols WHERE legend_id = ANY($1::uuid[]) AND status='ACTIVE'",
            [`{${effectiveLegendIds.join(",")}}`],
          )).rows
        : [];
      const legendsInPriorityOrder = effectiveLegendIds.map((id) => ({
        id,
        name: legendById.get(id) ?? "Legend",
        symbols: toJobLegendSymbolRows(
          (symbolRows as Record<string, unknown>[]).filter((s) => String(s.legend_id) === id),
        ),
      }));
      const legendSymbols = mergeLegendSymbols(legendsInPriorityOrder);
      // Prompt-size guard: a merged list from 3 large legends can overflow the
      // prompt. Trim per legend (primary keeps the most) and say so in the log.
      const MAX_PROMPT_SYMBOLS_PER_LEGEND = 120;
      const perLegendCount = new Map<number, number>();
      const cappedSymbols = legendSymbols.filter((s) => {
        const n = (perLegendCount.get(s.sourcePriority) ?? 0) + 1;
        perLegendCount.set(s.sourcePriority, n);
        return n <= MAX_PROMPT_SYMBOLS_PER_LEGEND;
      });
      if (cappedSymbols.length !== legendSymbols.length) {
        log(`legend symbol list trimmed for prompt size`, {
          before: legendSymbols.length,
          after: cappedSymbols.length,
        });
      }
      const sourcedPatterns = buildSourcedTagPatterns(cappedSymbols);
      const tagPatterns = buildTagPatterns(
        cappedSymbols as { tag_pattern?: string | null }[],
      );
      const tagPatternSources = sourcedPatterns.map((p) => p.legendName);

      await db.query(
        `INSERT INTO agent_runs (id, job_id, model, prompt_version, status, input_metadata)
         VALUES ($1,$2,$3,$4,'RUNNING',$5)`,
        [
          agentRunId,
          jobId,
          modelName,
          promptVersion,
          JSON.stringify({
            pageCount,
            engine: yoloActive ? "YOLO_GEO2" : "GEMINI_VISION",
            effectiveConfig: yoloActive ? getEffectiveGeo2Config() : undefined,
            legendCount: cappedSymbols.length,
            legendIds: effectiveLegendIds.length > 0 ? effectiveLegendIds : null,
            renderScale,
            renderMode: "mupdf-png",
          }),
        ],
      );

      // processOnePage: render → Gemini → associate → NMS → persist.
      // Returns detections persisted, 0 on skip, or -1 on AI error.
      // NOTE: DB inserts are safe to run concurrently — each page writes independent rows.
      async function processOnePage(page: number): Promise<number> {
        const pageStart = Date.now();

        let pageImageBase64: string;
        let pngBuffer: Buffer;
        let pngWidth: number;
        let pngHeight: number;
        try {
          const { png, width, height } = await renderPageToPng(
            buf,
            page,
            renderScale,
          );
          pngBuffer = png;
          pageImageBase64 = png.toString("base64");
          pngWidth = width;
          pngHeight = height;
          log(`page ${page} PNG rendered`, {
            page,
            sizeKB: Math.round(png.length / 1024),
          });
        } catch (renderErr: unknown) {
          const rmsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
          log(`page ${page} PNG render failed — page skipped`, {
            page,
            error: rmsg.slice(0, 200),
          });
          return 0;
        }

        let deduped: PersistableDetection[];
        if (yoloActive) {
          try {
            const yoloResult = await runYoloGeo2Page(pngBuffer, pngWidth, pngHeight);
            deduped = yoloResult.detections;
            log(`page ${page} YOLO GEO-2 finished`, {
              page,
              rawCandidates: yoloResult.rawCandidatesBeforeMerge,
              retained: yoloResult.retainedDetections,
              suppressed: yoloResult.suppressedCount,
              durationMs: yoloResult.durationMs,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`page ${page} YOLO error`, { page, error: msg.slice(0, 500) });
            return -1; // -1 = error (distinct from 0 = empty array)
          }
        } else {
          // Legacy Gemini Vision flow
          let detections: Awaited<ReturnType<typeof runDetectionAgent>>["detections"];
          try {
            const result = await runDetectionAgent({
              page,
              pageImageBase64,
              legendId: effectiveLegendId ?? "",
              legendSymbols: cappedSymbols,
              pngWidth,
              pngHeight,
              projectId: jrow.project_id ?? null,
              drawingType,
            });
            detections = result.detections;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`page ${page} AI error`, { page, error: msg.slice(0, 500) });
            return -1; // -1 = AI error (distinct from 0 = AI returned empty detections)
          }

          // Legend tag-pattern validation + proximity tag recovery (pure TS).
          // Sources name the matching legend per tag when several are selected.
          const validated = associateTagsToSymbols(detections, tagPatterns, tagPatternSources);

          // NMS pre-persist — merge overlapping boxes carrying the same tag.
          const nmsInput = validated.map((d) => ({
            ...d,
            bbox: { x: d.bbox.x, y: d.bbox.y, width: d.bbox.width, height: d.bbox.height },
          }));
          deduped = applyNMS(nmsInput, Number.isFinite(NMS_IOU) ? NMS_IOU : 0.5) as PersistableDetection[];
          if (deduped.length !== validated.length) {
            log(`page ${page} NMS merged ${validated.length - deduped.length} overlapping duplicate(s)`, {
              page,
              before: validated.length,
              after: deduped.length,
            });
          }
        }

        // Page persistence is idempotent: drop whatever this job wrote for this
        // page before re-inserting. Without this, any re-run (stalled lock,
        // manual re-trigger, resume after restart) appends a second copy of the
        // page's detections.
        const replaced = await deleteDetectionsForPage(db, jobId, page);
        if (replaced > 0) {
          log(`page ${page} replaced ${replaced} existing detection(s) from a previous run`, {
            page,
            replaced,
          });
        }

        await persistDetections(
          db,
          deduped,
          {
            jobId,
            docId: doc.id,
            filename: doc.filename,
            effectiveLegendId,
            legendSymbols: cappedSymbols,
            nullThreshold: NULL_THRESHOLD,
          },
          page,
        );

        log(`page ${page}/${pageCount} detections=${deduped.length}`, {
          page,
          count: deduped.length,
          ms: Date.now() - pageStart,
        });
        return deduped.length;
      }

      // Pages are processed in batches. The configured size always wins; when it
      // is null it is derived from the render scale, because a high scale means
      // a large PNG per page and the batch is what bounds peak memory.
      const defaultBatch = yoloActive ? 1 : (renderScale >= 5 ? 2 : 3);
      const PAGE_BATCH_SIZE = tuning.detection.pageBatchSize ?? defaultBatch;

      // Cancellation is checked between batches (not mid-batch).
      let totalPagesProcessed = 0;
      let totalAiErrors = 0; // pages that failed due to AI error (not 0-detection pages)
      for (let batchStart = 1; batchStart <= pageCount; batchStart += PAGE_BATCH_SIZE) {
        const cur = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
        if (cur?.status === "CANCELLED") {
          log("cancelled by user");
          break;
        }

        const batchEnd = Math.min(batchStart + PAGE_BATCH_SIZE - 1, pageCount);
        const batchPages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

        log(`processing page batch [${batchStart}-${batchEnd}]`);
        const batchResults = await Promise.all(batchPages.map((p) => processOnePage(p)));
        totalAiErrors += batchResults.filter((r) => r < 0).length;
        totalPagesProcessed += batchPages.length;

        await db.query("UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2", [
          Math.round(5 + (totalPagesProcessed / pageCount) * 90),
          jobId,
        ]);
      }

      // If every page failed with AI error → mark job FAILED so user knows to retry
      if (totalAiErrors === pageCount) {
        throw new Error(
          yoloActive
            ? `All ${pageCount} page(s) failed YOLO detection. Check model path and ONNX runtime.`
            : `All ${pageCount} page(s) failed AI detection — Gemini API unavailable or all models exhausted. Check API key and model availability.`,
        );
      }

      // Post-job entity resolution: group detections by normalized asset_tag in
      // this job. Highest-confidence becomes CANONICAL, the rest DUPLICATE and
      // NEEDS_REVIEW. Never auto-rejects — the human reviewer decides.
      try {
        const dupRows = await db.query(
          `SELECT
             UPPER(TRIM(asset_tag)) AS normalized_tag,
             COUNT(*) AS cnt,
             array_agg(id ORDER BY confidence DESC NULLS LAST) AS ids
           FROM detections
           WHERE job_id = $1
             AND asset_tag IS NOT NULL
             AND asset_tag != ''
             AND detection_status != 'REJECTED'
           GROUP BY UPPER(TRIM(asset_tag))
           HAVING COUNT(*) > 1`,
          [jobId],
        );

        if (dupRows.rows.length > 0) {
          log(`entity resolution: ${dupRows.rows.length} tag(s) with multiple detections`);

          for (const row of dupRows.rows) {
            const normalizedTag = row.normalized_tag as string;
            const detectionIds = row.ids as string[];
            const canonicalId = detectionIds[0]; // highest confidence is first
            const duplicateIds = detectionIds.slice(1);

            const canonicalNote = `CANONICAL: this detection selected as representative for tag "${normalizedTag}" (highest confidence among ${detectionIds.length} detections)`;
            await db.query(
              `UPDATE detections
               SET evidence = evidence || $1::jsonb
               WHERE id = $2
                 AND NOT (evidence::text LIKE '%CANONICAL:%')`,
              [JSON.stringify([canonicalNote]), canonicalId],
            );

            if (duplicateIds.length > 0) {
              const dupNote = `DUPLICATE: tag "${normalizedTag}" also detected in ${duplicateIds.length + 1} locations — canonical detection is ${canonicalId.slice(0, 8)}… — review required`;
              await db.query(
                `UPDATE detections
                 SET evidence = evidence || $1::jsonb,
                     validation_status = CASE
                       WHEN validation_status = 'CONFLICT' THEN 'CONFLICT'
                       ELSE 'NEEDS_REVIEW'
                     END
                 WHERE id = ANY($2::uuid[])
                   AND NOT (evidence::text LIKE '%DUPLICATE:%')`,
                [JSON.stringify([dupNote]), `{${duplicateIds.join(",")}}`],
              );
            }
          }

          const totalResolved = dupRows.rows.reduce(
            (s: number, r: { cnt: string }) => s + parseInt(r.cnt, 10),
            0,
          );
          log(
            `entity resolution complete: ${totalResolved} detections resolved across ${dupRows.rows.length} canonical groups`,
          );
        }
      } catch (resolveErr: unknown) {
        // Non-fatal — entity resolution is advisory only
        console.warn(
          "[entity-resolution] post-job check failed (non-fatal):",
          resolveErr instanceof Error ? resolveErr.message : resolveErr,
        );
      }

      const final = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];

      if (final?.status === "CANCELLED") {
        await db.query(
          "UPDATE agent_runs SET status='CANCELLED', completed_at=NOW(), output_metadata=$1 WHERE id=$2",
          [JSON.stringify({ durationMs: Date.now() - start }), agentRunId],
        );
        return { jobId, status: "CANCELLED" };
      }

      await db.query(
        "UPDATE detection_jobs SET status='COMPLETED', progress_pct=100, completed_at=NOW() WHERE id=$1",
        [jobId],
      );
      await db.query(
        "UPDATE agent_runs SET status='COMPLETED', completed_at=NOW(), output_metadata=$1 WHERE id=$2",
        [
          JSON.stringify({
            durationMs: Date.now() - start,
            engine: yoloActive ? "YOLO_GEO2" : "GEMINI_VISION",
            effectiveConfig: yoloActive ? getEffectiveGeo2Config() : undefined,
          }),
          agentRunId,
        ],
      );
      log("completed", { durationMs: Date.now() - start });
      return { jobId, status: "COMPLETED" };
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      await db.query(
        "UPDATE detection_jobs SET status='FAILED', error_detail=$1, completed_at=NOW() WHERE id=$2",
        [msg, jobId],
      );
      await db.query(
        "UPDATE agent_runs SET status='FAILED', error=$1, completed_at=NOW() WHERE id=$2",
        [msg, agentRunId],
      );
      log("failed", { error: msg.slice(0, 500), durationMs: Date.now() - start });
      throw e;
    }
  },
  workerRuntimeOptions(),
);

// Recovery: on worker startup, re-queue any PENDING jobs left over from previous crashes/restarts
async function recoverPendingJobs() {
  try {
    const rows = (
      await db.query(
        "SELECT id, legend_id FROM detection_jobs WHERE status='PENDING' ORDER BY created_at ASC LIMIT 50",
      )
    ).rows;

    if (rows.length === 0) return;
    console.log(`[detection] recovery: found ${rows.length} PENDING job(s), re-queuing...`);

    for (const row of rows) {
      try {
        await detectionQueue.add(
          "detection",
          { jobId: row.id, legendId: row.legend_id ?? null },
          { jobId: row.id, removeOnComplete: true, removeOnFail: 100 },
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

/**
 * Startup delays, read from the env layer.
 *
 * These run at module load, before any job exists, so they cannot await the
 * settings DB. `getTuning` (which can) is used inside the job body.
 */
/**
 * BullMQ worker options, read from the env layer.
 *
 * These are fixed when the Worker is constructed, before any job exists, so they
 * cannot await the settings DB. Restart the worker after changing them.
 *
 * lockDuration is the important one: BullMQ's default is 30s, which expires in
 * the middle of a region sweep (one page = one call per region, times the number
 * of models walked before one succeeds). On expiry BullMQ declares the job
 * stalled, re-queues it, and the duplicate runner persists a second copy of
 * every detection. The lock is renewed every lockRenewTimeMs, so only a truly
 * dead worker's lock is ever lost.
 */
function workerRuntimeOptions(): WorkerOptions {
  const lockDuration = env.WORKER_LOCK_DURATION_MS;
  const lockRenewTime = env.WORKER_LOCK_RENEW_TIME_MS;
  // BullMQ throws when lockRenewTime is not comfortably below lockDuration;
  // clamping keeps a bad config pair from crashing the worker at import time.
  const safeRenewTime =
    lockRenewTime > 0 && lockRenewTime < lockDuration ? lockRenewTime : Math.floor(lockDuration / 3);
  return {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration,
    lockRenewTime: safeRenewTime,
    stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
    maxStalledCount: env.WORKER_MAX_STALLED_COUNT,
  };
}

function startupDelayMs(): { recovery: number; prewarm: number } {
  return { recovery: env.WORKER_RECOVERY_DELAY_MS, prewarm: env.WORKER_PREWARM_DELAY_MS };
}

// Startup delays are tuning: they only need to be long enough for the DB pool to
// settle, and a faster local machine should not have to wait.
setTimeout(recoverPendingJobs, startupDelayMs().recovery);

// Pre-warm ISA/ISO builtin cache at worker startup.
// loadBuiltinSymbols() in rule-validator.ts has a module-level in-memory Map,
// but it only fills on first use. Pre-warming here fills the cache once so every
// job starts with the cache hot.
async function prewarmBuiltinCache() {
  try {
    const { validateDetection } = await import("@/lib/rule-validator");
    // Trigger a no-op validation that walks to ISA/ISO steps and loads both tables.
    await validateDetection({
      tagPrefix: "__PREWARM__",
      detectedAssetType: "__PREWARM__",
      aiConfidence: 0,
      legendId: null,
      legendSymbols: [],
      projectId: null,
    });
    console.log("[detection] ISA/ISO builtin cache pre-warmed");
  } catch {
    // Non-fatal — cache will fill on first real job
  }
}
setTimeout(prewarmBuiltinCache, startupDelayMs().prewarm);
