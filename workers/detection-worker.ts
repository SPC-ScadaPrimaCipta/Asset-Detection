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
  ensureSizeColumn,
  type PersistableDetection,
} from "@/lib/detection/persistence/detection-repository";
import { isTerminalJobStatus } from "@/lib/detection/job-status";
import { findDuplicates, type DuplicateRow } from "@/lib/detection/duplicate-detection";
import { isYoloEnabled } from "@/lib/detection/feature-flags";
import { runYoloGeo2Page } from "@/lib/detection/yolo/yolo-geo2-runner";
import {
  DEFAULT_GEO2_CONFIG,
  getEffectiveGeo2Config,
} from "@/lib/detection/yolo/yolo-geo2-config";
import { runHybridPipeline } from "@/lib/detection/hybrid-pipeline";
import { runDxfDetection } from "@/lib/dxf-detection";
import { qualityGate } from "@/lib/mdo-pid-rules";
import type { LegendSymbolRef } from "@/lib/dxf-detection";
import {
  loadProjectExistingTags,
  applyProjectAutoTagging,
} from "@/lib/tag-generator";

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

type WorkerLog = (msg: string, extra?: Record<string, unknown>) => void;

/**
 * Post-job entity resolution for every pipeline (DXF and PDF).
 *
 * Rules live in lib/detection/duplicate-detection.ts — the same rules the UI
 * preview and Remove Duplicates button use. Duplicates are annotated for
 * review; DETECTION_AUTO_DEDUPE=true additionally deletes them, but never
 * rows the user already reviewed or approved.
 */
async function resolveJobDuplicates(jobId: string, log: WorkerLog): Promise<void> {
  try {
    const allDetRows = await db.query<{
      id: string;
      asset_tag: string | null;
      asset_type: string;
      confidence: number | null;
      review_status: string;
      created_at: string;
      pid_page: number | null;
      bbox_x: number | null;
      bbox_y: number | null;
      bbox_w: number | null;
      bbox_h: number | null;
    }>(
      `SELECT id, asset_tag, asset_type, confidence, review_status, created_at,
              pid_page, bbox_x, bbox_y, bbox_w, bbox_h
       FROM detections
       WHERE job_id = $1
         AND detection_status != 'REJECTED'`,
      [jobId],
    );

    const candidates: DuplicateRow[] = allDetRows.rows.map((r) => ({
      id: r.id,
      assetTag: r.asset_tag,
      assetType: r.asset_type,
      confidence: r.confidence,
      reviewStatus: r.review_status,
      createdAt: r.created_at,
      page: r.pid_page,
      bbox:
        r.bbox_x !== null && r.bbox_y !== null && r.bbox_w !== null && r.bbox_h !== null
          ? { x: r.bbox_x, y: r.bbox_y, width: r.bbox_w, height: r.bbox_h }
          : null,
    }));

    const { groups } = findDuplicates(candidates);

    if (groups.length > 0) {
      log(`entity resolution: ${groups.length} canonical group(s) with duplicates`);

      for (const group of groups) {
        const canonicalNote = `CANONICAL: selected as representative (duplicate group of ${group.duplicateIds.length + 1})`;
        await db.query(
          `UPDATE detections SET evidence = evidence || $1::jsonb
           WHERE id = $2 AND NOT (evidence::text LIKE '%CANONICAL:%')`,
          [JSON.stringify([canonicalNote]), group.winnerId],
        );

        const dupNote = `DUPLICATE: same symbol detected at overlapping location — canonical is ${group.winnerId.slice(0, 8)}… — review required`;
        await db.query(
          `UPDATE detections
           SET evidence = evidence || $1::jsonb,
               validation_status = CASE WHEN validation_status = 'CONFLICT' THEN 'CONFLICT' ELSE 'NEEDS_REVIEW' END
           WHERE id = ANY($2::uuid[]) AND NOT (evidence::text LIKE '%DUPLICATE:%')`,
          [JSON.stringify([dupNote]), group.duplicateIds],
        );
      }

      log(`entity resolution complete: ${groups.length} canonical groups, ${groups.reduce((s, g) => s + g.duplicateIds.length, 0)} duplicates marked`);

      if (env.DETECTION_AUTO_DEDUPE === 'true') {
        const duplicateIds = groups.flatMap((g) => g.duplicateIds);
        if (duplicateIds.length > 0) {
          const deleted = await db.query<{ id: string }>(
            `DELETE FROM detections
             WHERE id = ANY($1::uuid[])
               AND review_status NOT IN ('APPROVED', 'REVIEWED')
             RETURNING id`,
            [duplicateIds],
          );
          log(`auto-dedupe removed ${deleted.rowCount ?? 0} duplicate(s); kept reviewed/approved rows`);
        }
      }
    }
  } catch (resolveErr: unknown) {
    // Non-fatal — entity resolution is advisory only
    console.warn(
      "[entity-resolution] post-job check failed (non-fatal):",
      resolveErr instanceof Error ? resolveErr.message : resolveErr,
    );
  }
}

/** Legend `tag_pattern` (P-### style) → RegExp, for tag validation. */function buildTagPatterns(
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
    const modelName = yoloActive ? "yolo-pid-v8n-203.onnx" : "ai-vision-only";
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

      // Load all allocated asset tags for this project to ensure project-level uniqueness
      const effectiveProjectId = jrow.project_id ?? doc.project_id ?? null;
      const existingProjectTags = await loadProjectExistingTags(db, effectiveProjectId);
      log(`project tag registry: loaded ${existingProjectTags.size} existing tag(s) for project ${effectiveProjectId ?? 'none'}`);

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

      // ── DXF fast path ────────────────────────────────────────────────────
      // DXF documents skip PDF render + Gemini Vision for primary detection.
      // Re-parse from raw file (not cached entities) for accuracy.
      // Optional Gemini fallback runs post-sync for unmatched blocks only.
      if (doc.file_type === 'dxf') {
        log("dxf pipeline start", { documentId: doc.id });
        const tuningForDxf = await getTuning();

        // Build legend symbol refs for DXF block matching.
        // Only include symbols that are ACTIVE AND not quality-rejected.
        // quality_status NULL (unassessed) is allowed — only 'rejected' is excluded.
        const dxfLegendSymbols: Array<LegendSymbolRef & { legend_id: string }> = effectiveLegendIds.length > 0
          ? ((await db.query(
              `SELECT id, legend_id, asset_type, symbol_name, tag_pattern, aliases
               FROM legend_symbols
               WHERE legend_id = ANY($1::uuid[])
                 AND status = 'ACTIVE'
                 AND (quality_status IS NULL OR quality_status != 'rejected')`,
              [`{${effectiveLegendIds.join(",")}}`],
            )).rows as Array<LegendSymbolRef & { legend_id: string }>)
          : [];

        await db.query(
          "UPDATE detection_jobs SET progress_pct=5 WHERE id=$1",
          [jobId]
        );

        // ── AI pre-pass: layer auto-classification (#4) ───────────────────
        // Load any stored layer profiles for this project, then run AI
        // classification for layers not yet profiled. Non-fatal.
        const { collectLayerSamples, classifyLayersWithAI } = await import('@/lib/dxf-detection');
        type LayerProfileRow = { layer_name: string; short_name: string; category: string; tag_priority: number };
        type LayerProfile = import('@/lib/dxf-detection').LayerProfile;

        let layerProfiles: LayerProfile[] = [];
        try {
          const profileRows = (await db.query(
            "SELECT layer_name, short_name, category, tag_priority FROM dxf_layer_profiles WHERE project_id=$1",
            [jrow.project_id],
          )).rows as LayerProfileRow[];
          layerProfiles = profileRows.map(r => ({
            layer_name: r.layer_name,
            short_name: r.short_name,
            category: r.category as LayerProfile['category'],
            tag_priority: r.tag_priority,
          }));
        } catch { /* table may not exist yet — proceed with empty */ }

        // Check if this document already has AI layer analysis
        let hasLayerAnalysis = false;
        try {
          const laRow = (await db.query(
            "SELECT COUNT(*) AS cnt FROM dxf_layer_analysis WHERE document_id=$1",
            [doc.id],
          )).rows[0] as { cnt: string };
          hasLayerAnalysis = parseInt(laRow.cnt) > 0;
        } catch { /* ignore */ }

        if (!hasLayerAnalysis) {
          try {
            const samples = collectLayerSamples(buf);
            // Filter to layers not already profiled
            const profiled = new Set(layerProfiles.map(p => p.short_name.toLowerCase()));
            const unprofiledSamples = samples.filter(s => !profiled.has(s.shortName.toLowerCase()));
            if (unprofiledSamples.length > 0) {
              const aiResults = await classifyLayersWithAI(unprofiledSamples);
              // Persist to dxf_layer_analysis
              for (const r of aiResults) {
                try {
                  await db.query(
                    `INSERT INTO dxf_layer_analysis
                       (document_id, layer_name, short_name, sample_texts, ai_category, ai_confidence, ai_reasoning, final_category)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$5)
                     ON CONFLICT (document_id, layer_name) DO UPDATE
                       SET ai_category=$5, ai_confidence=$6, ai_reasoning=$7, final_category=$5`,
                    [doc.id, r.layerName, r.shortName, JSON.stringify(
                      samples.find(s => s.shortName === r.shortName)?.sampleTexts ?? []
                    ), r.category, r.confidence, r.reasoning],
                  );
                } catch { /* non-fatal */ }
              }
              // Merge high-confidence AI results into layerProfiles for this run
              for (const r of aiResults) {
                if (r.confidence >= 0.75 && r.category !== 'unknown') {
                  layerProfiles.push({
                    layer_name: r.layerName,
                    short_name: r.shortName,
                    category: r.category,
                    tag_priority: r.category === 'tag' ? 3 : 99,
                  });
                }
              }
              log("ai layer pre-pass done", { classified: aiResults.length });
            }
          } catch (prePassErr) {
            log("ai layer pre-pass skipped", {
              reason: prePassErr instanceof Error ? prePassErr.message.slice(0, 100) : String(prePassErr),
            });
          }
        } else if (layerProfiles.length === 0) {
          // Load from dxf_layer_analysis final_category instead
          try {
            const laRows = (await db.query(
              "SELECT layer_name, short_name, final_category FROM dxf_layer_analysis WHERE document_id=$1 AND final_category IS NOT NULL",
              [doc.id],
            )).rows as Array<{ layer_name: string; short_name: string; final_category: string }>;
            for (const r of laRows) {
              layerProfiles.push({
                layer_name: r.layer_name,
                short_name: r.short_name,
                category: r.final_category as LayerProfile['category'],
                tag_priority: r.final_category === 'tag' ? 3 : 99,
              });
            }
          } catch { /* non-fatal */ }
        }

        await db.query(
          "UPDATE detection_jobs SET progress_pct=15 WHERE id=$1",
          [jobId]
        );

        let dxfResult: Awaited<ReturnType<typeof runDxfDetection>>;
        // Keep parsed result for rawEntities (Gemini fallback)
        let parsedDxf: import('@/lib/dxf-parser').DxfParseResult | null = null;
        try {
          const { parseDxf } = await import('@/lib/dxf-parser');
          parsedDxf = parseDxf(buf);
          dxfResult = runDxfDetection(buf, dxfLegendSymbols, {
            layerProfiles,
            adaptiveSpatial: true,
            parsed: parsedDxf, // Blok 9: jangan parse 6MB dua kali
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          await db.query(
            "UPDATE detection_jobs SET status='FAILED', error_detail=$1, completed_at=NOW() WHERE id=$2",
            [msg.slice(0, 500), jobId]
          );
          log("dxf parse failed", { error: msg.slice(0, 200) });
          return { jobId, status: "FAILED" };
        }

        const aiCandidates = dxfResult.parseStats.aiCandidates ?? dxfResult.parseStats.geminiCandidates;
        log("dxf parse done", {
          entities: dxfResult.parseStats.totalEntities,
          inserts: dxfResult.parseStats.insertCount,
          circles: dxfResult.parseStats.circleCount,
          detections: dxfResult.detections.length,
          aiCandidates,
        });

        await db.query(
          "UPDATE detection_jobs SET progress_pct=45 WHERE id=$1",
          [jobId]
        );

        // ── AI text-prompt fallback for unmatched blocks (#7) ─────────
        // Uses text prompt (block name + nearby texts) — no SVG crop needed.
        // Non-fatal: failures leave detections at their current confidence.
        if (aiCandidates > 0 && dxfLegendSymbols.length > 0) {
          try {
            const { applyAiFallback } = await import('@/lib/dxf-detection');
            // Pass empty buffer for svgBuffer (text-prompt path doesn't use it)
            await applyAiFallback(
              dxfResult.detections,
              Buffer.alloc(0),
              dxfLegendSymbols,
              parsedDxf!.extents,
              parsedDxf!.entities,
            );
            log("ai text-prompt fallback done", {
              candidates: aiCandidates,
            });
          } catch (gErr) {
            log("ai fallback skipped", {
              reason: gErr instanceof Error ? gErr.message.slice(0, 120) : String(gErr),
            });
          }
        }

        // Legend symbols in rule-validator shape (shared by enrichment + vision Lap-2).
        const dxfRuleLegendSymbols = dxfLegendSymbols.map((s) => ({
          id: s.id,
          legend_id: s.legend_id ?? effectiveLegendId ?? '',
          asset_type: s.asset_type,
          symbol_name: s.symbol_name,
          tag_pattern: s.tag_pattern,
          description: null as string | null,
          aliases: s.aliases ?? [],
          standard_code: null as string | null,
          isa_function_code: null as string | null,
          iso_category: null as string | null,
        }));

        // ── Rule-validator enrichment: UNKNOWN-typed tagged detections ──
        // Lap 1 vektor tidak lagi menebak tipe dari prefix; rantai
        // Legend > KB > ISA > ISO yang memutuskan. Non-fatal, cap 150/job.
        if (dxfResult.detections.length > 0 && dxfLegendSymbols.length > 0) {
          try {
            const { validateDetection, extractTagPrefix } = await import('@/lib/rule-validator');
            const legendSymbols = dxfRuleLegendSymbols;
            const { isValidAssetTag: isTagOk } = await import('@/lib/validation');
            // Blok 9: kandidat enrichment paralel (pool 8) — isinya query DB I/O-bound.
            const enrichCands = dxfResult.detections.filter(
              (det) => det.assetType !== 'UNKNOWN' || !det.assetTag ? false : isTagOk(det.assetTag),
            ).slice(0, 150);
            let enriched = 0;
            const ENRICH_POOL = 8;
            for (let w = 0; w < enrichCands.length; w += ENRICH_POOL) {
              const batch = enrichCands.slice(w, w + ENRICH_POOL);
              const results = await Promise.all(batch.map(async (det) => {
                try {
                  const vr = await validateDetection({
                    tagPrefix: extractTagPrefix(det.assetTag),
                    detectedAssetType: null,
                    detectedAssetTag: det.assetTag,
                    aiConfidence: det.confidence,
                  legendId: effectiveLegendId,
                  legendSymbols,
                  projectId: jrow.project_id ?? null,
                  ocrText: det.assetTag ?? undefined,
                  drawingType,
                });
                return { det, vr };
                } catch {
                  return { det, vr: null };
                }
              }));
              for (const { det, vr } of results) {
                if (vr && vr.source !== 'UNKNOWN' && vr.resolvedAssetType && vr.resolvedAssetType !== 'UNKNOWN') {
                  det.assetType = vr.resolvedAssetType;
                  det.evidence.push(`Rule-validator [${vr.source}]: ${vr.ruleApplied} (${Math.round(vr.confidence * 100)}%)`);
                  if (vr.confidence >= 0.6) {
                    det.needsAiClassification = false;
                    det.needsGeminiClassification = false;
                  }
                  enriched++;
                }
              }
            }
            log("dxf rule-validator enrichment done", { enriched, candidates: enrichCands.length });
          } catch (vErr) {
            log("dxf rule-validator enrichment skipped", {
              reason: vErr instanceof Error ? vErr.message.slice(0, 120) : String(vErr),
            });
          }
        }

        // ── Vision Lap-2 per sheet region (Blok 3.2) ──────────────────────
        // Render region (tema terang) → hybrid vision (YOLO+OCR+rule+Gemini)
        // → IoU-merge ke Lap-1 vektor. Vektor menang untuk tag+tipe bila sudah
        // resolved; vision menambah simbol tak-bertag + koreksi box estimasi.
        // Sepenuhnya non-fatal: gagal = Lap-1 vektor tetap persist utuh.
        // Matikan via DXF_VISION_ENABLED=false bila biaya/latensi keberatan.
        if (process.env.DXF_VISION_ENABLED !== 'false' && parsedDxf && dxfLegendSymbols.length > 0) {
          try {
            const { renderDxfRegionToPng } = await import('@/lib/dxf-svg-renderer');
            const { runHybridPipeline } = await import('@/lib/detection/hybrid-pipeline');
            const { splitDxfRegions } = await import('@/lib/dxf-parser');
            const { mergeVisionDetections } = await import('@/lib/dxf-vision');
            const visionRegions = splitDxfRegions(parsedDxf);
            const { isValidAssetTag, buildTagRegexes } = await import('@/lib/validation');
            const tagRegexes = buildTagRegexes(dxfLegendSymbols.map((s) => s.tag_pattern));
            const isTagValid = (t: string | null) => isValidAssetTag(t, tagRegexes);
            let vMerged = 0, vNew = 0, vUp = 0, vDropTag = 0, vDropQ = 0;
            // Blok 9: region paralel — render + YOLO jalan bareng.
            // Panggilan Gemini di dalamnya tetap antri via request-gate (kuota aman).
            // Merge ke Lap-1 dilakukan SEQUENSIAL setelahnya (hindari race push).
            const regionOutputs = await Promise.all(visionRegions.map(async (vr) => {
              try {
                const { png, width, height, view } = await renderDxfRegionToPng(parsedDxf, vr, { theme: 'light' });
                const hybrid = await runHybridPipeline(
                  {
                    pngBuffer: png,
                    pageImageBase64: png.toString('base64'),
                    pageWidth: width,
                    pageHeight: height,
                    page: vr.index + 1,
                    legendId: effectiveLegendId ?? '',
                    legendSymbols: dxfRuleLegendSymbols as Parameters<typeof runHybridPipeline>[0]['legendSymbols'],
                    projectId: jrow.project_id ?? null,
                    drawingType,
                    // Tag DXF dari vektor eksak — OCR hanya bakar waktu tesseract.
                    skipOcr: true,
                  },
                  (msg, extra) => log(`dxf-vision r${vr.index + 1} ${msg}`, extra),
                );
                return { vr, view, hybrid, error: null as string | null };
              } catch (regionErr) {
                return {
                  vr, view: null, hybrid: null,
                  error: regionErr instanceof Error ? regionErr.message.slice(0, 120) : String(regionErr),
                };
              }
            }));
            for (const out of regionOutputs) {
              if (out.error || !out.hybrid || !out.view) {
                log('dxf vision region skipped', { region: out.vr.index + 1, reason: out.error });
                continue;
              }
              const st = mergeVisionDetections(
                dxfResult.detections,
                out.hybrid.detections,
                out.view,
                parsedDxf.extents,
                out.vr.index + 1,
                out.vr.index,
                isTagValid,
              );
              vMerged += st.mergedIntoVector;
              vNew += st.visionOnlyNew;
              vUp += st.typeUpgraded + st.boxUpgraded;
              vDropTag += st.droppedInvalidTag;
              vDropQ += st.droppedLowQuality;
              log('dxf vision region done', {
                region: out.vr.index + 1,
                yolo: out.hybrid.stats.yoloDetections,
                fallback: out.hybrid.stats.aiFallbackDetections,
                merged: st.mergedIntoVector,
                new: st.visionOnlyNew,
              });
              // Progress per region — UI tidak macet di 45% selama vision berjalan.
              const doneCount = regionOutputs.indexOf(out) + 1;
              await db.query('UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2', [
                45 + Math.round((doneCount / regionOutputs.length) * 20),
                jobId,
              ]);
            }
            log('dxf vision lap-2 done', {
              merged: vMerged,
              visionOnlyNew: vNew,
              upgraded: vUp,
              droppedInvalidTag: vDropTag,
              droppedLowQuality: vDropQ,
              agreementPct: vMerged + vNew > 0 ? Math.round((vMerged / (vMerged + vNew)) * 100) : null,
            });
          } catch (vErr) {
            log('dxf vision lap-2 skipped', {
              reason: vErr instanceof Error ? vErr.message.slice(0, 120) : String(vErr),
            });
          }
        }

        await db.query(
          "UPDATE detection_jobs SET progress_pct=70 WHERE id=$1",
          [jobId]
        );

        // Ensure document_pages rows exist — satu per sheet region DXF
        // (pid_page = region index + 1). Fallback 1 row bila regions kosong.
        const regionPages = dxfResult.regions.length > 0
          ? dxfResult.regions.map((r) => r.pidPage)
          : [1];
        const pageIdByNumber = new Map<number, string>();
        try {
          for (const pageNum of regionPages) {
            const pageRow = (await db.query(
              "SELECT id FROM document_pages WHERE document_id=$1 AND page_number=$2",
              [doc.id, pageNum],
            )).rows[0] as { id: string } | undefined;
            if (pageRow) {
              pageIdByNumber.set(pageNum, pageRow.id);
              continue;
            }
            const inserted = (await db.query(
              `INSERT INTO document_pages (document_id, page_number, width, height)
               VALUES ($1, $2, 1000, 1000)
               ON CONFLICT (document_id, page_number) DO NOTHING
               RETURNING id`,
              [doc.id, pageNum],
            )).rows[0] as { id: string } | undefined;
            if (inserted) {
              pageIdByNumber.set(pageNum, inserted.id);
            } else {
              const refetch = (await db.query(
                "SELECT id FROM document_pages WHERE document_id=$1 AND page_number=$2",
                [doc.id, pageNum],
              )).rows[0] as { id: string } | undefined;
              if (refetch) pageIdByNumber.set(pageNum, refetch.id);
            }
          }
          log("document_pages rows ensured for DXF regions", { pages: regionPages });
        } catch (pgErr) {
          log("document_pages insert failed (non-fatal)", {
            reason: pgErr instanceof Error ? pgErr.message.slice(0, 120) : String(pgErr),
          });
        }
        const documentPageId: string | null = pageIdByNumber.get(1) ?? null;

        // Delete previous detections for this job (re-run safety)
        await db.query("DELETE FROM detections WHERE job_id=$1", [jobId]);

        // Final safety net (Blok 6): type vocabulary + tag validity.
        // Even if a pipeline stage slips junk through ("iso", "9"), it dies here.
        const { isValidAssetTag: isTagOk2, resolveAssetType } =
          await import('@/lib/validation');
        const { formatLegendAssetType } = await import('@/lib/rule-validator');
        const vocabRows = (await db.query(
          `SELECT DISTINCT LOWER(ls.asset_type) AS t, LOWER(ls.symbol_name) AS s FROM legend_symbols ls
           LEFT JOIN legends l ON l.id = ls.legend_id
           WHERE ls.status='ACTIVE' AND (
             ($1::text <> '' AND ls.legend_id = ANY($1::uuid[]))
             OR COALESCE(l.is_builtin, FALSE) = TRUE
           )`,
          [effectiveLegendIds.length > 0 ? `{${effectiveLegendIds.join(',')}}` : ''],
        )).rows as Array<{ t: string | null; s: string | null }>;
        const typeVocab = new Set<string>();
        for (const row of vocabRows) {
          if (row.t) typeVocab.add(row.t.trim().toLowerCase());
          if (row.s) {
            typeVocab.add(row.s.trim().toLowerCase());
            const formatted = formatLegendAssetType(row.s, row.t ?? '').trim().toLowerCase();
            if (formatted) typeVocab.add(formatted);
          }
        }
        const tagRegexesFinal = (await import('@/lib/validation')).buildTagRegexes(
          dxfLegendSymbols.map((s) => s.tag_pattern),
        );
        let droppedTag = 0, fixedType = 0;

        // Persist DXF detections
        applyProjectAutoTagging(dxfResult.detections, {
          existingProjectTags,
          legendSymbols: dxfLegendSymbols,
          allowGeneratedTags: false,
        });

        const NULL_THR = tuningForDxf.detection.nullFieldConfidenceThreshold;
        const dxfInserts: Array<unknown[]> = [];
        for (const det of dxfResult.detections) {
          let tag = det.confidence >= NULL_THR ? (det.assetTag ?? null) : null;
          if (tag && !isTagOk2(tag, tagRegexesFinal)) {
            tag = null;
            det.evidence.push(`Tag "${det.assetTag}" rejected by validator — not persisted`);
            droppedTag++;
          }
          const resolved = resolveAssetType(det.assetType, typeVocab.size > 0 ? typeVocab : undefined);
          let atype = resolved.assetType;
          if (atype === 'UNKNOWN') {
            const { inferAssetTypeFromEvidence, GENERIC_ASSET_TYPE } = await import('@/lib/detection/type-inference');
            const inferred = inferAssetTypeFromEvidence({ evidence: det.evidence, assetTag: tag, legendSymbols: dxfLegendSymbols as any });
            if (inferred) {
              atype = inferred.assetType;
              det.evidence.push(`Type inferred: ${inferred.reason}`);
            } else if (tag) {
              atype = GENERIC_ASSET_TYPE;
              det.evidence.push(`No evidence-based type; assigned fallback: ${GENERIC_ASSET_TYPE}`);
            }
          }

          // Untagged unresolved vector geometry is not an asset. Persisting it
          // creates false positives such as standalone pipe circles and line-size marks.
          if (atype === 'UNKNOWN' && !tag) continue;
          if (qualityGate({ source: 'DXF', assetTag: tag, assetType: atype, confidence: det.confidence, evidence: det.evidence }) === 'DROP') continue;

          if (!resolved.matchedVocabulary && atype !== 'UNKNOWN') {
            det.evidence.push(`Type "${det.assetType}" has no exact standards match — kept for review`);
            fixedType++;
          } else if (atype !== det.assetType) {
            det.evidence.push(`Type "${det.assetType}" mapped to standards vocabulary → ${atype}`);
            fixedType++;
          }
          // UNKNOWN and non-standard types are never auto-valid: they must
          // reach the human review queue.
          const validationStatus = atype === 'UNKNOWN' || !resolved.matchedVocabulary ? 'NEEDS_REVIEW' : 'VALID';
          const global = parsedDxf?.extents;
          const region = dxfResult.regions.find((r) => r.pidPage === det.pidPage)?.extents ?? global;
          const worldX = global ? global.minX + (det.bbox.x / 1000) * global.width : null;
          const worldY = global ? global.maxY - ((det.bbox.y + det.bbox.height) / 1000) * global.height : null;
          const worldW = global ? (det.bbox.width / 1000) * global.width : null;
          const worldH = global ? (det.bbox.height / 1000) * global.height : null;
          const sheetX = region && worldX !== null ? ((worldX - region.minX) / region.width) * 1000 : null;
          const sheetY = region && worldY !== null ? ((region.maxY - worldY - (worldH ?? 0)) / region.height) * 1000 : null;
          const sheetW = region && worldW !== null ? (worldW / region.width) * 1000 : null;
          const sheetH = region && worldH !== null ? (worldH / region.height) * 1000 : null;
          dxfInserts.push([
            uuidv4(),
            jobId,
            doc.id,
            pageIdByNumber.get(det.pidPage) ?? documentPageId,
            tag,
            atype,
            det.confidence,
            det.bbox.x,
            det.bbox.y,
            det.bbox.width,
            det.bbox.height,
            JSON.stringify(det.evidence),
            'DETECTED',
            'PENDING',
            det.source === 'VISION' ? 'DXF_VISION' : 'DXF',
            det.pidPage, // sheet region index + 1
            effectiveLegendId ?? null,
            det.size ?? null,
            validationStatus,
            'GLOBAL_NORMALIZED', worldX, worldY, worldW, worldH,
            sheetX, sheetY, sheetW, sheetH,
            det.confidence, tag ? 0.9 : 0, det.evidence.some((e) => /bbox from .*geometry/i.test(e)) ? 0.9 : 0.55,
            atype !== 'UNKNOWN' ? 0.85 : 0, 0, 0,
            'FINAL', 'DXF',
          ]);
        }

        if (dxfInserts.length > 0) {
          await ensureSizeColumn(db as unknown as { query: (text: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> });
          for (const row of dxfInserts) {
            await db.query(
              `INSERT INTO detections
                 (id, job_id, document_id, document_page_id,
                  asset_tag, asset_type, confidence,
                  bbox_x, bbox_y, bbox_w, bbox_h,
                  evidence, detection_status, review_status,
                   detection_source, pid_page, legend_id, size, validation_status,
                   bbox_frame, world_bbox_x, world_bbox_y, world_bbox_w, world_bbox_h,
                   sheet_bbox_x, sheet_bbox_y, sheet_bbox_w, sheet_bbox_h,
                   asset_confidence, tag_confidence, bbox_confidence, legend_confidence,
                   flow_confidence, relation_confidence)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                         $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)`,
              row
            );
          }
        }

        await db.query(
          `UPDATE detection_jobs
              SET status='COMPLETED', progress_pct=100, completed_at=NOW()
            WHERE id=$1`,
          [jobId]
        );

        log("dxf pipeline done", { detections: dxfInserts.length, droppedTag, fixedType });
        await resolveJobDuplicates(jobId, log);
        return { jobId, status: "COMPLETED", dxf: true, detections: dxfInserts.length };
      }
      // ── End DXF fast path ────────────────────────────────────────────────

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
      const aiVerifierOn = (env.AI_VERIFIER_ENABLED ?? env.GEMINI_VERIFIER_ENABLED) === "true";
      const aiFallbackOn = (env.AI_FALLBACK_ENABLED ?? env.GEMINI_FALLBACK_ENABLED) === "true";
      console.log(`[Detection] pipeline=${yoloActive ? "yolo-hybrid" : "ai-vision-only"} regions=${regionMode}`);
      console.log(`[Detection] ocr=${yoloActive ? (env.OCR_ENGINE ?? "tesseract") : "none"}`);
      console.log(`[Detection] cv=${yoloActive && env.CV_SERVICE_ENABLED === "true" ? "python-fastapi" : "none"}`);
      console.log(`[Detection] ai-verifier=${yoloActive && aiVerifierOn ? "enabled" : "disabled"}`);
      console.log(`[Detection] ai-fallback=${yoloActive && aiFallbackOn ? "enabled" : "disabled"}`);
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

      // Load reference crop images for top-N legend symbols.
      // Only symbols with quality_status='validated' AND a reference_image_url are sent.
      // Unvalidated crops are noise — they may be wrong crops or low-quality extractions
      // that would mislead Gemini rather than help it match symbols correctly.
      // Non-fatal: crop load failures are silently skipped — detection proceeds without them.
      const MAX_REFERENCE_CROPS = tuning.detection.maxReferenceCrops ?? 10;
      const referenceCrops = new Map<string, string>();
      if (!yoloActive && MAX_REFERENCE_CROPS > 0) {
        // Only validated symbols with a crop are eligible as reference images.
        const withCrop = cappedSymbols
          .filter((s) => s.quality_status === 'validated' && typeof s.reference_image_url === 'string' && s.reference_image_url)
          .slice(0, MAX_REFERENCE_CROPS);

        await Promise.all(withCrop.map(async (s) => {
          const url = s.reference_image_url as string;
          try {
            const cropBuf = (await getFile(url)) as unknown as Buffer;
            referenceCrops.set(s.id, cropBuf.toString('base64'));
          } catch {
            // file missing or storage error — skip this crop silently
          }
        }));

        if (referenceCrops.size > 0) {
          log(`loaded ${referenceCrops.size} validated reference crop(s) for legend symbols`);
        } else {
          log('no validated reference crops available — proceeding with text-only legend');
        }
      }

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
            engine: yoloActive ? "YOLO_GEO2" : "AI_VISION",
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

        // Non-P&ID page filter: skip cover (page 1) and revision history (last
        // page) in documents with more than 3 pages. Opt-in via tuning so small
        // or non-standard docs are unaffected.
        if (tuning.detection.skipNonPidPages && pageCount > 3) {
          if (page === 1 || page === pageCount) {
            log(`page ${page} skipped (likely non-P&ID: ${page === 1 ? "cover/title" : "revision history"})`);
            return 0;
          }
        }

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
            const hybridResult = await runHybridPipeline(
              {
                pngBuffer,
                pageImageBase64,
                pageWidth: pngWidth,
                pageHeight: pngHeight,
                page,
                legendId: effectiveLegendId ?? "",
                legendSymbols: cappedSymbols as Parameters<typeof runHybridPipeline>[0]["legendSymbols"],
                projectId: jrow.project_id ?? null,
                drawingType,
              },
              (msg, extra) => log(msg, extra),
            );
            deduped = hybridResult.detections;
            log(`page ${page} hybrid pipeline finished`, {
              page,
              yoloDetections: hybridResult.stats.yoloDetections,
              yoloWithTags: hybridResult.stats.yoloWithTags,
              aiVerifierCalls: hybridResult.stats.aiVerifierCalls,
              aiFallbackNew: hybridResult.stats.aiFallbackDetections,
              totalFinal: hybridResult.stats.totalFinal,
              durationMs: hybridResult.stats.durationMs,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`page ${page} hybrid pipeline error`, { page, error: msg.slice(0, 500) });
            return -1;
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
              referenceCrops: referenceCrops.size > 0 ? referenceCrops : undefined,
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

        // Automatic Fallback Tag Generator:
        // Allocates unique project-level incremental tags for symbols lacking an OCR tag.
          const { generatedCount: autoTaggedCount } = applyProjectAutoTagging(deduped, {
            existingProjectTags,
            legendSymbols: cappedSymbols,
            allowGeneratedTags: false,
          });
        if (autoTaggedCount > 0) {
          log(`page ${page} auto-tagged ${autoTaggedCount} detection(s) without OCR tags`, {
            page,
            autoTagged: autoTaggedCount,
          });
        }

        // Automatic Piping Line Size Inference for Valves
        try {
          const { extractPdfTextTokensFromBuffer, associateNearestPipingSize } = await import('@/lib/spatial-piping');
          const pageTokens = await extractPdfTextTokensFromBuffer(buf, page);
          if (pageTokens.length > 0) {
            let sizeInferredCount = 0;
            for (const d of deduped) {
              if (!d.size) {
                const match = associateNearestPipingSize(d.bbox, pageTokens);
                if (match) {
                  d.size = match.size;
                  d.evidence.push(`[Line-Size] Inferred ${match.size} from line label "${match.lineText}"`);
                  sizeInferredCount++;
                }
              }
            }
            if (sizeInferredCount > 0) {
              log(`page ${page} inferred pipe size for ${sizeInferredCount} detection(s)`, { page, sizeInferredCount });
            }
          }
        } catch (pipeErr) {
          log(`page ${page} piping size association skipped (non-fatal)`, {
            page,
            error: pipeErr instanceof Error ? pipeErr.message : String(pipeErr),
          });
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
      // Gemini path: default batch=1 to avoid bursting the shared 15 RPM gate.
      // Running 3 pages concurrently issues 21 Gemini calls at once; the gate
      // then throttles the entire batch, making total time longer not shorter.
      // Sequential pages with a steady 800ms inter-region delay stay well under
      // the rate limit without bursting.
      const defaultBatch = yoloActive ? 1 : (renderScale >= 5 ? 1 : 1);
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

      // Post-job entity resolution: geometry-first (shared with the DXF branch).
      await resolveJobDuplicates(jobId, log);

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
            engine: yoloActive ? "YOLO_GEO2" : "AI_VISION",
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
