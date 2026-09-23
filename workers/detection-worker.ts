import { Worker, Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { getFile } from "@/lib/storage";
import { runDetectionAgent } from "@/lib/ai-agent";
import { associateTagsToSymbols, applyNMS } from "@/lib/spatial";
import { renderPageToPng, extractPdfTextByPage } from "@/lib/pdf-render";
import { getAiConfig } from "@/lib/ai-config";
import { env } from "@/lib/env";
import {
  extractTagTokens,
  rankTagCandidates,
  normalizeTagCandidates,
  selectBestCandidate,
  buildKnownTagSet,
} from "@/lib/ocr-candidate";
import { lookupCompanyKnowledge } from "@/lib/knowledge-db";

/**
 * Infer drawing type from document filename.
 * Returns 'P&ID', 'PFD', 'ISOMETRIC', or null.
 * Used to activate Level 1 company knowledge hierarchy (project + drawing_type + tag).
 */
function inferDrawingType(filename: string): string | null {
  const upper = filename.toUpperCase();
  if (/\bPFD\b/.test(upper)) return 'PFD';
  if (/ISOMETR/i.test(upper)) return 'ISOMETRIC';
  if (/\bPID\b|\bP&ID\b|P_ID|P-ID/.test(upper)) return 'P&ID';
  // Default: most engineering documents are P&ID unless stated otherwise
  if (/\.PDF$/i.test(filename)) return 'P&ID';
  return null;
}

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

      // Infer drawing type from filename for company knowledge Level 1 hierarchy
      const drawingType = inferDrawingType(doc.filename);

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

      // Speed: run OCR text extraction and Gemini file upload concurrently — independent ops.
      let ocrPages: string[] = [];
      let geminiFileUriFallback: string | undefined;

      const [ocrResult] = await Promise.allSettled([
        // Op 1: Extract OCR text per page
        extractPdfTextByPage(buf).then(pages => { ocrPages = pages; }),

        // Op 2: Pre-upload PDF to Gemini Files API as fallback (Gemini provider only)
        (aiCfg.provider !== "deepseek" && aiCfg.geminiKey)
          ? import("@/lib/gemini").then(({ uploadPdfToGemini }) =>
              uploadPdfToGemini(buf, doc.filename).then(uploaded => {
                geminiFileUri = uploaded.fileUri;
                geminiFileUriFallback = geminiFileUri;
                log("gemini file uploaded (fallback ready)", { fileUri: geminiFileUri });
              }).catch((uploadErr: unknown) => {
                const umsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
                log("gemini file upload failed (will use inline base64 as last fallback)", { error: umsg.slice(0, 200) });
              })
            )
          : Promise.resolve(),
      ]);
      void ocrResult; // allSettled — errors already logged inside each op

      await db.query("UPDATE agent_runs SET input_metadata=$1 WHERE id=$2", [
        JSON.stringify({
          pageCount,
          legendCount: legendSymbols.length,
          renderMode: "mupdf-png",
          geminiFileUriFallback: geminiFileUriFallback ?? null,
        }),
        agentRunId,
      ]);

      // Fix #5: Pre-compute knownTagSet once per job (not per page).
      // Previously the DB query for confirmed tags + company KB ran inside processOnePage,
      // meaning it executed once per page. Hoist here so it runs once per job.
      let jobKnownTagSet = new Set<string>();
      try {
        const kbEntries = await lookupCompanyKnowledge({ projectId: jrow.project_id ?? null });
        const confirmedRows = jrow.project_id
          ? (await db.query(
              `SELECT DISTINCT asset_tag
               FROM detections
               WHERE asset_tag IS NOT NULL
                 AND detection_status = 'CONFIRMED'
                 AND job_id IN (
                   SELECT dj.id FROM detection_jobs dj
                   JOIN documents doc ON doc.id = dj.document_id
                   WHERE doc.project_id = $1
                 )
               LIMIT 500`,
              [jrow.project_id]
            )).rows
          : [];
        const allEntries = [
          ...confirmedRows.map((r: { asset_tag: string }) => ({ asset_tag: r.asset_tag, tag_prefix: null })),
          ...kbEntries.map((e) => ({ asset_tag: null, tag_prefix: e.tag_prefix })),
        ];
        jobKnownTagSet = buildKnownTagSet(allEntries);
      } catch {
        // non-fatal — proceed with empty set
      }

      // PAGE_BATCH_SIZE: number of pages to process concurrently.
      // Phase 2: default 2 saat PDF_RENDER_SCALE >= 5.0 (mitigasi OOM 25MP/page).
      // Configurable via PAGE_BATCH_SIZE env var (explicit env selalu menang).
      const _scale = parseFloat(process.env.PDF_RENDER_SCALE ?? '5.0');
      const _defaultBatch = _scale >= 5.0 ? 2 : 3;
      const PAGE_BATCH_SIZE = parseInt(process.env.PAGE_BATCH_SIZE ?? String(_defaultBatch), 10);

      // processOnePage: encapsulates all per-page work (render → detect → OCR → persist).
      // Returns number of detections persisted, or 0 on skip.
      // NOTE: DB inserts are safe to run concurrently — each page writes independent rows.
      async function processOnePage(page: number): Promise<number> {
        const pageStart = Date.now();
        let detections: Awaited<ReturnType<typeof runDetectionAgent>>["detections"] = [];

        // Render page to PNG — primary input for Gemini Vision
        let pageImageBase64: string | undefined;
        let pngDimensions: { width: number; height: number } | undefined;
        try {
          // M1: PDF_RENDER_SCALE configurable. Phase 2 default 5.0 (≈360 DPI).
          // P&ID tag 6pt jadi jelas bagi Gemini; cost +40% disetujui user.
          // Jika PNG >18MB, ai-agent otomatis fallback ke fileUri (lihat runWithGemini).
          // WARNING: higher scale = larger PNG = more memory + larger Gemini payload.
          // Gemini inline image limit ~20MB base64. At 5.0 an A3 P&ID ≈ 15-20MB.
          const PDF_RENDER_SCALE = parseFloat(process.env.PDF_RENDER_SCALE ?? '5.0');
          const { png, width, height } = await renderPageToPng(buf, page, PDF_RENDER_SCALE);
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
            projectId: jrow.project_id ?? null,
            drawingType,
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
          return -1;  // -1 = AI error (distinct from 0 = AI returned empty detections)
        }

        const validated = associateTagsToSymbols(detections, tagPatterns);

        // ── F1/F2/F3: OCR candidate resolution ──────────────────────────────
        const pageOcrText = ocrPages[page - 1] ?? '';
        const resolvedWithOcr = await (async () => {
          try {
            if (!pageOcrText.trim()) return validated;

            const ocrTokens = extractTagTokens(pageOcrText);
            if (ocrTokens.length === 0) return validated;

            // Use job-level knownTagSet (pre-computed once before page loop)
            const knownTagSet = jobKnownTagSet;

            return validated.map((d) => {
              const dTyped = d as typeof d & {
                validation_status?: string;
                detection_source?: string;
                field_provenance?: Record<string, unknown> | null;
              };

              const rawCandidates = rankTagCandidates(ocrTokens, d.bbox, knownTagSet);
              const candidates = normalizeTagCandidates(rawCandidates, knownTagSet, d.assetTag);
              const best = selectBestCandidate(d.assetTag, candidates);

              if (!best) return d;

              if (d.assetTag && best.normalized === d.assetTag.toUpperCase()) {
                const ocrNote = best.normalized_by !== 'none'
                  ? `OCR confirmed tag "${best.normalized}" (original OCR: "${best.original}", correction: ${best.normalized_by})`
                  : `OCR confirmed tag "${best.normalized}"`;
                const updatedProvenance = dTyped.field_provenance
                  ? {
                      ...(dTyped.field_provenance as Record<string, unknown>),
                      tag: {
                        source: best.normalized_by !== 'none' ? 'OCR+NORMALIZED' : 'OCR+VISION',
                        normalized: best.normalized_by !== 'none',
                        correctionReason: best.normalized_by !== 'none'
                          ? `OCR ${best.normalized_by}: "${best.original}" → "${best.normalized}"`
                          : null,
                      },
                    }
                  : dTyped.field_provenance;
                return {
                  ...d,
                  evidence: [...d.evidence, ocrNote],
                  confidence: Math.min(1.0, d.confidence + 0.03),
                  ...(updatedProvenance ? { field_provenance: updatedProvenance } : {}),
                };
              }

              if (d.assetTag && best.normalized !== d.assetTag.toUpperCase()) {
                const conflictNote = `OCR candidate "${best.normalized}" (conf: ${best.ocr_confidence.toFixed(2)}) differs from Vision tag "${d.assetTag}" — verify`;
                return {
                  ...d,
                  evidence: [...d.evidence, conflictNote],
                  validation_status: (dTyped.validation_status === 'CONFLICT'
                    ? 'CONFLICT'
                    : 'NEEDS_REVIEW') as 'VALID' | 'NEEDS_REVIEW' | 'CONFLICT',
                };
              }

              if (!d.assetTag && best.ocr_confidence >= 0.75) {
                const fillNote = best.normalized_by !== 'none'
                  ? `Tag "${best.normalized}" filled from OCR (original: "${best.original}", correction: ${best.normalized_by}) — verify`
                  : `Tag "${best.normalized}" filled from OCR — verify`;
                const filledProvenance = dTyped.field_provenance
                  ? {
                      ...(dTyped.field_provenance as Record<string, unknown>),
                      tag: {
                        source: best.normalized_by !== 'none' ? 'OCR+NORMALIZED' : 'OCR',
                        normalized: best.normalized_by !== 'none',
                        correctionReason: best.normalized_by !== 'none'
                          ? `OCR ${best.normalized_by}: "${best.original}" → "${best.normalized}"`
                          : null,
                      },
                    }
                  : dTyped.field_provenance;
                return {
                  ...d,
                  assetTag: best.normalized,
                  evidence: [...d.evidence, fillNote],
                  confidence: Math.min(0.79, d.confidence),
                  validation_status: 'NEEDS_REVIEW' as const,
                  ...(filledProvenance ? { field_provenance: filledProvenance } : {}),
                };
              }

              return d;
            });
          } catch (ocrErr: unknown) {
            console.warn('[ocr-candidates] resolution failed (non-fatal):',
              ocrErr instanceof Error ? ocrErr.message : ocrErr);
            return validated;
          }
        })();

        // Phase 4: NMS pre-persist — merge box tumpang tindih + tag sama.
        // Mencegah inflasi duplikat & bbox "melenceng jauh". Threshold via
        // NMS_IOU_THRESHOLD (default 0.5). Hanya merge jika tag sama persis.
        const NMS_IOU = parseFloat(process.env.NMS_IOU_THRESHOLD ?? '0.5');
        const nmsInput = resolvedWithOcr.map((d) => ({
          ...d,
          bbox: { x: d.bbox.x, y: d.bbox.y, width: d.bbox.width, height: d.bbox.height },
        }));
        const deduped = applyNMS(nmsInput, Number.isFinite(NMS_IOU) ? NMS_IOU : 0.5);
        if (deduped.length !== resolvedWithOcr.length) {
          log(`page ${page} NMS merged ${resolvedWithOcr.length - deduped.length} overlapping duplicate(s)`, {
            page,
            before: resolvedWithOcr.length,
            after: deduped.length,
          });
        }

        // Persist detections for this page
        for (const d of deduped) {
          const legendSym = d.legendSymbol
            ? legendSymbols.find(
                (s: Record<string, unknown>) =>
                  s.asset_type === d.legendSymbol || s.symbol_name === d.legendSymbol
              )
            : null;
          const detectionSource = (d as Record<string, unknown>).detection_source ?? 'VISION';
          const canonicalFeatures = (d as Record<string, unknown>).canonical_features ?? null;
          const imageHash = (d as Record<string, unknown>).image_hash ?? null;
          const symbolEmbedding = (d as Record<string, unknown>).symbol_embedding ?? null;
          const confidenceBreakdown = (d as Record<string, unknown>).confidence_breakdown ?? null;
          const validationStatus = (d as Record<string, unknown>).validation_status ?? 'VALID';
          const mainEquipment = (d as Record<string, unknown>).mainEquipment ?? null;
          const fieldConfidence = (d as Record<string, unknown>).field_confidence ?? null;
          const fieldProvenance = (d as Record<string, unknown>).field_provenance ?? null;

          const NULL_THRESHOLD = parseFloat(process.env.NULL_FIELD_CONFIDENCE_THRESHOLD ?? '0.50');
          type FieldConf = { tag?: number | null; type?: number | null; service?: number | null; mainEquipment?: number | null; description?: number | null };
          const fc = fieldConfidence as FieldConf | null;

          const persistedService = fc?.service != null && fc.service < NULL_THRESHOLD
            ? null
            : ((d as Record<string, unknown>).service as string | null ?? null);
          const persistedMainEquipment = fc?.mainEquipment != null && fc.mainEquipment < NULL_THRESHOLD
            ? null
            : (mainEquipment as string | null);
          const persistedDescription = fc?.description != null && fc.description < NULL_THRESHOLD
            ? null
            : (d.description ?? null);

          const nulledFields: string[] = [];
          if (persistedService === null && (d as Record<string, unknown>).service) nulledFields.push('service');
          if (persistedMainEquipment === null && mainEquipment) nulledFields.push('mainEquipment');
          if (persistedDescription === null && d.description) nulledFields.push('description');
          const nullEnforcedEvidence = nulledFields.length > 0
            ? [...d.evidence, `Fields nulled (confidence < ${NULL_THRESHOLD}): ${nulledFields.join(', ')} — insufficient evidence`]
            : d.evidence;

          const embeddingStr = symbolEmbedding && Array.isArray(symbolEmbedding)
            ? `[${(symbolEmbedding as number[]).join(',')}]`
            : null;

          const detectionId = uuidv4();
          await db.query(
            `INSERT INTO detections
               (id, job_id, document_id, asset_tag, asset_type, equipment_class, description,
                service, location, unit, area, pid_number, pid_page,
                legend_id, legend_symbol_id, confidence,
                bbox_x, bbox_y, bbox_w, bbox_h, evidence, detection_status, review_status,
                detection_source, canonical_features, crop_hash, embedding, confidence_breakdown,
                validation_status, main_equipment, field_confidence, field_provenance)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'DETECTED','PENDING',$22,$23,$24,$25::vector,$26,$27,$28,$29,$30)`,
            [
              detectionId,
              jobId,
              doc.id,
              // Normalize tag: remove spaces around hyphens (e.g. "JB - 03" → "JB-03"),
              // trim leading/trailing whitespace, collapse internal spaces.
              d.assetTag ? d.assetTag.trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ') : null,
              d.assetType,
              (d as Record<string, unknown>).equipmentClass ?? null,
              persistedDescription,
              persistedService,
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
              JSON.stringify(nullEnforcedEvidence),
              detectionSource,
              canonicalFeatures,
              imageHash,
              embeddingStr,
              confidenceBreakdown ? JSON.stringify(confidenceBreakdown) : null,
              validationStatus,
              persistedMainEquipment,
              fieldConfidence ? JSON.stringify(fieldConfidence) : null,
              fieldProvenance ? JSON.stringify(fieldProvenance) : null,
            ]
          );

          // F5: Persist audit trail — non-fatal
          const auditObj = (d as Record<string, unknown>).audit;
          if (auditObj && typeof (auditObj as Record<string, unknown>).persist === 'function') {
            const audit = auditObj as { setDetectionId: (id: string) => void; persist: (opts: { finalSource: string; confidenceBreakdown: Record<string, number> | null }) => Promise<void> };
            audit.setDetectionId(detectionId);
            audit.persist({
              finalSource: String(detectionSource),
              confidenceBreakdown: confidenceBreakdown as Record<string, number> | null,
            }).catch((auditErr: unknown) => {
              console.warn(`[audit] persist failed (non-fatal) detection=${detectionId}:`,
                auditErr instanceof Error ? auditErr.message : auditErr);
            });
          }
        }

        return deduped.length;
      }

      // Process pages in batches of PAGE_BATCH_SIZE.
      // Cancelled check runs between batches (not mid-batch).
      let totalPagesProcessed = 0;
      let totalAiErrors = 0;  // track pages that failed due to AI error (not 0-detection pages)
      for (let batchStart = 1; batchStart <= pageCount; batchStart += PAGE_BATCH_SIZE) {
        // Check for cancellation between batches
        const cur = (await db.query("SELECT status FROM detection_jobs WHERE id=$1", [jobId])).rows[0];
        if (cur?.status === "CANCELLED") {
          log("cancelled by user");
          break;
        }

        const batchEnd = Math.min(batchStart + PAGE_BATCH_SIZE - 1, pageCount);
        const batchPages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

        log(`processing page batch [${batchStart}-${batchEnd}]`);
        const batchResults = await Promise.all(batchPages.map(p => processOnePage(p)));
        // processOnePage returns -1 on AI error, 0 on empty detection, N on success
        totalAiErrors += batchResults.filter(r => r < 0).length;
        totalPagesProcessed += batchPages.length;

        await db.query("UPDATE detection_jobs SET progress_pct=$1 WHERE id=$2", [
          Math.round(5 + (totalPagesProcessed / pageCount) * 90),
          jobId,
        ]);
      }

      // If every page failed with AI error → mark job FAILED so user knows to retry
      if (totalAiErrors === pageCount) {
        throw new Error(`All ${pageCount} page(s) failed AI detection — Gemini API unavailable or all models exhausted. Check API key and model availability.`);
      }

      // F7: Post-job entity resolution
      // Group detections by normalized asset_tag within this job+project.
      // For each group with multiple detections:
      //   - Mark highest-confidence detection as CANONICAL (evidence note appended)
      //   - Mark rest as DUPLICATE (evidence note appended, validation_status → NEEDS_REVIEW)
      //   - Does NOT auto-reject — human reviewer decides
      // This replaces the old advisory-only duplicate warning with explicit resolution metadata.
      try {
        const dupRows = await db.query(
          `SELECT
             UPPER(TRIM(asset_tag)) AS normalized_tag,
             COUNT(*) AS cnt,
             array_agg(id ORDER BY confidence DESC NULLS LAST) AS ids,
             array_agg(confidence ORDER BY confidence DESC NULLS LAST) AS confidences
           FROM detections
           WHERE job_id = $1
             AND asset_tag IS NOT NULL
             AND asset_tag != ''
             AND detection_status != 'REJECTED'
           GROUP BY UPPER(TRIM(asset_tag))
           HAVING COUNT(*) > 1`,
          [jobId]
        );

        if (dupRows.rows.length > 0) {
          log(`entity resolution: ${dupRows.rows.length} tag(s) with multiple detections`);

          for (const row of dupRows.rows) {
            const normalizedTag = row.normalized_tag as string;
            const detectionIds = row.ids as string[];
            const canonicalId = detectionIds[0]; // highest confidence is first
            const duplicateIds = detectionIds.slice(1);

            // Mark canonical detection
            const canonicalNote = `CANONICAL: this detection selected as representative for tag "${normalizedTag}" (highest confidence among ${detectionIds.length} detections)`;
            await db.query(
              `UPDATE detections
               SET evidence = evidence || $1::jsonb
               WHERE id = $2
                 AND NOT (evidence::text LIKE '%CANONICAL:%')`,
              [JSON.stringify([canonicalNote]), canonicalId]
            );

            // Mark duplicates — set validation_status to NEEDS_REVIEW and append evidence
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
                [JSON.stringify([dupNote]), `{${duplicateIds.join(',')}}`]
              );
            }
          }

          const totalResolved = dupRows.rows.reduce(
            (s: number, r: { cnt: string }) => s + parseInt(r.cnt), 0
          );
          log(`entity resolution complete: ${totalResolved} detections resolved across ${dupRows.rows.length} canonical groups`);
        }
      } catch (resolveErr: unknown) {
        // Non-fatal — entity resolution is advisory only
        console.warn('[entity-resolution] post-job check failed (non-fatal):',
          resolveErr instanceof Error ? resolveErr.message : resolveErr);
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
  { connection, concurrency: 2 }
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

// Fix #4: Pre-warm ISA/ISO builtin cache at worker startup.
// loadBuiltinSymbols() in rule-validator.ts has a module-level in-memory Map,
// but it only fills on first use. First job's first detection pays the DB query
// cost. Pre-warming here fills the cache once so every job starts with cache hot.
async function prewarmBuiltinCache() {
  try {
    const { validateDetection } = await import('@/lib/rule-validator');
    // Trigger a no-op validation that walks to ISA/ISO steps and loads both tables.
    // Use a dummy hash that won't match any cache entry.
    await validateDetection({
      tagPrefix: '__PREWARM__',
      detectedAssetType: '__PREWARM__',
      aiConfidence: 0,
      legendId: null,
      legendSymbols: [],
      projectId: null,
    });
    console.log('[detection] ISA/ISO builtin cache pre-warmed');
  } catch {
    // Non-fatal — cache will fill on first real job
  }
}
setTimeout(prewarmBuiltinCache, 5000);
