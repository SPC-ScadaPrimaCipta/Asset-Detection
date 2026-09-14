import { Worker, Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { getFile } from "@/lib/storage";
import { runDetectionAgent } from "@/lib/ai-agent";
import { associateTagsToSymbols } from "@/lib/spatial";
import { extractPdfTextByPage } from "@/lib/pdf-render";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
export const detectionQueue = new Queue("detection", { connection });

// Observability: jobId, documentId, page, model, duration, status, error — never log secrets
export const worker = new Worker("detection", async (job: Job<{ jobId: string; legendId?: string }>) => {
  const { jobId, legendId } = job.data as { jobId: string; legendId?: string };
  const start = Date.now();
  const log = (msg: string, extra?: Record<string, unknown>) => console.log(`[detection] job=${jobId} ${msg}`, extra ?? "");

  await db.query("UPDATE detection_jobs SET status='PROCESSING', started_at=NOW(), progress_pct=5 WHERE id=$1", [jobId]);
  const agentRunId = uuidv4();
  const modelName = process.env.AI_PROVIDER === "deepseek" ? "deepseek-chat" : "gemini-2.0-flash";
  const promptVersion = "v1";
  await db.query("INSERT INTO agent_runs (id, job_id, model, prompt_version, status, input_metadata) VALUES ($1,$2,$3,'RUNNING',$4)", [agentRunId, jobId, modelName, JSON.stringify({ pageCount: null })]);

  try {
    const jrow = (await db.query("SELECT * FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
    if (!jrow) throw new Error("Job not found");
    const doc = (await db.query("SELECT * FROM documents WHERE id=$1", [jrow.document_id])).rows[0];
    if (!doc) throw new Error("Document not found");

    log("start", { documentId: doc.id, legendId: legendId ?? "none", model: modelName, promptVersion });

    const legendSymbols = legendId ? (await db.query("SELECT * FROM legend_symbols WHERE legend_id=$1", [legendId])).rows : [];
    const tagPatterns: RegExp[] = legendSymbols.filter((s: any) => s.tag_pattern).map((s: any) => {
      const raw = String(s.tag_pattern);
      // Convert P-### style: # -> \d, * -> .* — safe identifier, no SQL interp
      const esc = raw.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/#/g, "\\d").replace(/\*/g, ".*");
      return new RegExp(`^${esc}$`, "i");
    });

    const buf: Buffer = (await getFile(doc.file_path)) as unknown as Buffer;
    const pageCount: number = doc.page_count ?? 1;
    const pdfBase64 = buf.toString("base64");
    const ocrPages = await extractPdfTextByPage(buf);

    await db.query("UPDATE agent_runs SET input_metadata=$1 WHERE id=$2", [JSON.stringify({ pageCount, legendCount: legendSymbols.length }), agentRunId]);

    for (let page = 1; page <= pageCount; page++) {
      const pageStart = Date.now();
      let detections: Awaited<ReturnType<typeof runDetectionAgent>>["detections"] = [];
      try {
        const result = await runDetectionAgent({
          page, pdfBase64, legendId: legendId ?? "", legendSymbols: legendSymbols as any, ocrText: ocrPages[page - 1] ?? "",
        });
        detections = result.detections;
        // Malformed AI output is caught by Zod in ai-agent — if we got here, it's valid
        log(`page ${page}/${pageCount} detections=${detections.length}`, { page, count: detections.length, ms: Date.now() - pageStart });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`page ${page} AI error`, { page, error: msg.slice(0, 500) });
        // Do not persist malformed output — skip page, continue job
        await db.query("UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2", [Math.round(5 + (page / pageCount) * 90), jobId]);
        continue;
      }

      const validated = associateTagsToSymbols(detections, tagPatterns);

      // Mark cancelled check
      const cur = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
      if (cur?.status === "CANCELLED") { log("cancelled by user"); break; }

      for (const d of validated) {
        const legendSym = d.legendSymbol ? legendSymbols.find((s: any) => s.asset_type === d.legendSymbol || s.symbol_name === d.legendSymbol) : null;
        await db.query(
          `INSERT INTO detections (id, job_id, document_id, asset_tag, asset_type, equipment_class, description, service, location, unit, area, pid_number, pid_page, legend_id, legend_symbol_id, confidence, bbox_x, bbox_y, bbox_w, bbox_h, evidence, detection_status, review_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'DETECTED','PENDING')`,
          [uuidv4(), jobId, doc.id, d.assetTag ?? null, d.assetType, (d as any).equipmentClass ?? null, d.description ?? null, (d as any).service ?? null, (d as any).location ?? null, (d as any).unit ?? null, (d as any).area ?? null, doc.filename, page, legendId ?? null, legendSym?.id ?? null, d.confidence, d.bbox.x, d.bbox.y, d.bbox.width, d.bbox.height, JSON.stringify(d.evidence)]
        );
      }
      await db.query("UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2", [Math.round(5 + (page / pageCount) * 90), jobId]);
    }

    const final = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
    if (final?.status === "CANCELLED") {
      await db.query("UPDATE agent_runs SET status='CANCELLED', completed_at=NOW(), output_metadata=$1 WHERE id=$2", [JSON.stringify({ durationMs: Date.now() - start }), agentRunId]);
      return { jobId, status: "CANCELLED" };
    }

    await db.query("UPDATE detection_jobs SET status='COMPLETED', progress_pct=100, completed_at=NOW() WHERE id=$1", [jobId]);
    await db.query("UPDATE agent_runs SET status='COMPLETED', completed_at=NOW(), output_metadata=$1 WHERE id=$2", [JSON.stringify({ durationMs: Date.now() - start }), agentRunId]);
    log("completed", { durationMs: Date.now() - start });
    return { jobId, status: "COMPLETED" };
  } catch (e: unknown) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    await db.query("UPDATE detection_jobs SET status='FAILED', error_detail=$1, completed_at=NOW() WHERE id=$2", [msg, jobId]);
    await db.query("UPDATE agent_runs SET status='FAILED', error=$1, completed_at=NOW() WHERE id=$2", [msg, agentRunId]);
    log("failed", { error: msg.slice(0, 500), durationMs: Date.now() - start });
    throw e;
  }
}, { connection, concurrency: 2 });
