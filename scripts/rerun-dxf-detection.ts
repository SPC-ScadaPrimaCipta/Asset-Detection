/**
 * Rerun DXF detection for a document and persist results to DB.
 *
 * Mirrors the worker DXF fast path (persist loop) without BullMQ.
 * Useful to refresh detections after pipeline fixes — then run benchmark.
 *
 * Usage:
 *   npm run rerun:dxf -- <filename_or_doc_id>
 *   npm run rerun:dxf -- INTAN_GS_SHEET_5.dxf
 *   npm run rerun:dxf -- INTAN_GS_SHEET_5.dxf --job-id <uuid>
 *   npm run rerun:dxf -- INTAN_GS_SHEET_5.dxf --dry-run
 *
 * Flags:
 *   --job-id <uuid>   Reuse existing job (inherits legend). Default: create new row.
 *   --dry-run         Parse + detect, print stats, skip DB writes.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load .env.local / .env before any lib imports ─────────────────────────────
(function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
})();

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: npm run rerun:dxf -- <filename_or_doc_id> [--job-id <uuid>] [--dry-run]',
  );
  process.exit(0);
}

let docArg: string | null = null;
let jobIdArg: string | null = null;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--job-id' && args[i + 1]) { jobIdArg = args[++i]; }
  else if (args[i] === '--dry-run') { dryRun = true; }
  else if (!args[i].startsWith('--') && docArg === null) { docArg = args[i]; }
}
if (!docArg) {
  console.error('Missing required argument: <filename_or_doc_id>');
  process.exit(1);
}
const targetDoc = docArg;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { default: db } = await import('../lib/db');
  const { v4: uuidv4 } = await import('uuid');
  const { getFile } = await import('../lib/storage');
  const { ensureSizeColumn } = await import('../lib/detection/persistence/detection-repository');
  const dxfMod = await import('../lib/dxf-detection');
  const { runDxfDetection } = dxfMod;
  type LegendSymbolRef = import('../lib/dxf-detection').LegendSymbolRef;
  type LayerProfile = import('../lib/dxf-detection').LayerProfile;
  const { isValidAssetTag, buildTagRegexes, resolveAssetType } = await import('../lib/validation');
  const { formatLegendAssetType } = await import('../lib/rule-validator');
  const { qualityGate } = await import('../lib/mdo-pid-rules');
  const { loadProjectExistingTags, applyProjectAutoTagging } = await import('../lib/tag-generator');

  // ── Find document ─────────────────────────────────────────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let docResult = { rows: [] as unknown[] };
  if (UUID_RE.test(targetDoc)) {
    docResult = await db.query(
      `SELECT * FROM documents WHERE id = $1 LIMIT 1`,
      [targetDoc],
    );
  }
  if (docResult.rows.length === 0) {
    docResult = await db.query(
      `SELECT * FROM documents WHERE filename ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
      [`%${targetDoc}%`],
    );
  }
  if (docResult.rows.length === 0) {
    console.error(`Document not found: ${targetDoc}`);
    process.exit(1);
  }
  const doc = docResult.rows[0] as {
    id: string;
    filename: string;
    file_path: string;
    file_type: string;
    project_id: string | null;
    page_count: number | null;
  };
  if (doc.file_type !== 'dxf') {
    console.error(`"${doc.filename}" is not DXF (file_type=${doc.file_type}). Script is DXF-only.`);
    process.exit(1);
  }
  console.log(`Document : ${doc.filename}  id=${doc.id}`);

  // ── Resolve job + legend ──────────────────────────────────────────────────
  let jobId: string;
  let legendId: string | null = null;
  let legendIds: string[] = [];

  if (jobIdArg) {
    const jrow = (await db.query(`SELECT * FROM detection_jobs WHERE id=$1`, [jobIdArg])).rows[0] as Record<string, unknown> | undefined;
    if (!jrow) { console.error(`Job not found: ${jobIdArg}`); process.exit(1); }
    jobId = jrow.id as string;
    legendId = (jrow.legend_id ?? null) as string | null;
    const rawIds = jrow.legend_ids;
    if (Array.isArray(rawIds)) legendIds = (rawIds as unknown[]).filter(Boolean) as string[];
    else if (typeof rawIds === 'string') { try { legendIds = JSON.parse(rawIds); } catch { legendIds = []; } }
    if (legendId && legendIds.length === 0) legendIds = [legendId];
    console.log(`Reusing job : ${jobId}`);
  } else {
    // Inherit legend from latest job
    const lastJob = (await db.query(
      `SELECT * FROM detection_jobs WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [doc.id],
    )).rows[0] as Record<string, unknown> | undefined;
    if (lastJob) {
      legendId = (lastJob.legend_id ?? null) as string | null;
      const rawIds = lastJob.legend_ids;
      if (Array.isArray(rawIds)) legendIds = (rawIds as unknown[]).filter(Boolean) as string[];
      else if (typeof rawIds === 'string') { try { legendIds = JSON.parse(rawIds); } catch { legendIds = []; } }
      if (legendId && legendIds.length === 0) legendIds = [legendId];
      console.log(`Legend from last job (${lastJob.id as string}): legendId=${legendId}`);
    } else {
      console.warn('No prior job — running without legend.');
    }
    jobId = uuidv4();
    if (!dryRun) {
      await db.query(
        `INSERT INTO detection_jobs
           (id, document_id, project_id, legend_id, status, created_at)
         VALUES ($1,$2,$3,$4,'PROCESSING',NOW())`,
        [jobId, doc.id, doc.project_id, legendId],
      );
      console.log(`Created job : ${jobId}`);
    } else {
      console.log(`[dry-run] Would create job: ${jobId}`);
    }
  }
  const effectiveLegendId = legendIds[0] ?? legendId ?? null;

  // ── Legend symbols ────────────────────────────────────────────────────────
  type LegendSymbolRow = LegendSymbolRef & { legend_id: string; tag_pattern?: string | null; aliases?: unknown };
  let dxfLegendSymbols: LegendSymbolRow[] = [];
  if (legendIds.length > 0) {
    dxfLegendSymbols = (await db.query(
      `SELECT id, legend_id, asset_type, symbol_name, tag_pattern, aliases
       FROM legend_symbols
       WHERE legend_id = ANY($1::uuid[])
         AND status = 'ACTIVE'
         AND (quality_status IS NULL OR quality_status != 'rejected')`,
      [`{${legendIds.join(',')}}`],
    )).rows as LegendSymbolRow[];
  }
  console.log(`Legend symbols : ${dxfLegendSymbols.length}`);

  // ── Type vocabulary (mirrors worker Blok 6) ───────────────────────────────
  const vocabRows = (await db.query(
    `SELECT DISTINCT LOWER(ls.asset_type) AS t, LOWER(ls.symbol_name) AS s
     FROM legend_symbols ls
     LEFT JOIN legends l ON l.id = ls.legend_id
     WHERE ls.status='ACTIVE' AND (
       ($1::text <> '' AND ls.legend_id = ANY($1::uuid[]))
       OR COALESCE(l.is_builtin, FALSE) = TRUE
     )`,
    [legendIds.length > 0 ? `{${legendIds.join(',')}}` : ''],
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

  const tagRegexesFinal = buildTagRegexes(
    dxfLegendSymbols.map((s) => s.tag_pattern ?? null),
  );

  // ── Layer profiles ────────────────────────────────────────────────────────
  let layerProfiles: LayerProfile[] = [];
  if (doc.project_id) {
    try {
      layerProfiles = (await db.query(
        `SELECT layer_name, short_name, category, tag_priority FROM dxf_layer_profiles WHERE project_id=$1`,
        [doc.project_id],
      )).rows as LayerProfile[];
    } catch { /* table may not exist */ }
  }
  try {
    const laRows = (await db.query(
      `SELECT layer_name, short_name, final_category FROM dxf_layer_analysis WHERE document_id=$1 AND final_category IS NOT NULL`,
      [doc.id],
    )).rows as Array<{ layer_name: string; short_name: string; final_category: string }>;
    for (const r of laRows) {
      if (!layerProfiles.find((p) => p.layer_name === r.layer_name)) {
        layerProfiles.push({
          layer_name: r.layer_name,
          short_name: r.short_name,
          category: r.final_category as LayerProfile['category'],
          tag_priority: r.final_category === 'tag' ? 3 : 99,
        });
      }
    }
  } catch { /* ignore */ }
  console.log(`Layer profiles : ${layerProfiles.length}`);

  // ── Read file ─────────────────────────────────────────────────────────────
  console.log(`Reading        : ${doc.file_path}`);
  const buf = (await getFile(doc.file_path)) as unknown as Buffer;

  // ── Parse + detect ────────────────────────────────────────────────────────
  console.log('Parsing DXF...');
  const { parseDxf } = await import('../lib/dxf-parser');
  const parsedDxf = parseDxf(buf);

  console.log('Running detection...');
  const t0 = Date.now();
  const dxfResult = runDxfDetection(buf, dxfLegendSymbols, {
    layerProfiles,
    adaptiveSpatial: true,
    parsed: parsedDxf,
  });
  const elapsed = Date.now() - t0;
  const { detections: rawDetections, parseStats } = dxfResult;

  console.log(`Detected in ${elapsed}ms`);
  console.log(`  entities    : ${parseStats.totalEntities}`);
  console.log(`  inserts     : ${parseStats.insertCount}`);
  console.log(`  circles     : ${parseStats.circleCount}`);
  console.log(`  raw dets    : ${rawDetections.length}`);

  if (dryRun) {
    console.log('\n[dry-run] Sample (first 15):');
    for (const d of rawDetections.slice(0, 15)) {
      console.log(`  ${d.assetTag ?? '(untagged)'} — ${d.assetType}  conf=${d.confidence.toFixed(2)}  src=${d.source}`);
    }
    if (rawDetections.length > 15) console.log(`  ... and ${rawDetections.length - 15} more`);
    await db.end?.();
    process.exit(0);
  }

  // ── Project tag registry ──────────────────────────────────────────────────
  const existingProjectTags = await loadProjectExistingTags(db as Parameters<typeof loadProjectExistingTags>[0], doc.project_id ?? null);
  applyProjectAutoTagging(rawDetections, {
    existingProjectTags,
    legendSymbols: dxfLegendSymbols,
    allowGeneratedTags: true,
  });

  // ── Resolve document_page_id (DXF always page 1) ─────────────────────────
  const pgRow = (await db.query(
    `SELECT id FROM document_pages WHERE document_id=$1 AND page_number=1 LIMIT 1`,
    [doc.id],
  )).rows[0] as { id: string } | undefined;
  const documentPageId = pgRow?.id ?? null;

  // Map pidPage → document_page_id (same as worker)
  const pageIdByNumber = new Map<number, string>();
  if (documentPageId) pageIdByNumber.set(1, documentPageId);

  // ── Build insert rows (mirror worker DXF persist loop) ───────────────────
  await ensureSizeColumn(db as Parameters<typeof ensureSizeColumn>[0]);

  // Delete old detections for job (idempotent)
  const PAGE = 1;
  const delRes = await db.query(
    `DELETE FROM detections WHERE job_id=$1 AND pid_page=$2`,
    [jobId, PAGE],
  );
  const replaced = (delRes as unknown as { rowCount?: number }).rowCount ?? 0;
  if (replaced > 0) console.log(`Deleted ${replaced} old detection(s) for job ${jobId}`);

  const { inferAssetTypeFromEvidence, GENERIC_ASSET_TYPE } = await import('../lib/detection/type-inference');

  let droppedTag = 0, fixedType = 0, dropped = 0;
  let inserted = 0;

  for (const det of rawDetections) {
    let tag = det.assetTag ?? null;
    if (tag && !isValidAssetTag(tag, tagRegexesFinal)) {
      det.evidence.push(`Tag "${det.assetTag}" rejected by validator — not persisted`);
      tag = null;
      droppedTag++;
    }

    const resolved = resolveAssetType(det.assetType, typeVocab.size > 0 ? typeVocab : undefined);
    let atype = resolved.assetType;

    if (atype === 'UNKNOWN') {
      const inferred = inferAssetTypeFromEvidence({
        evidence: det.evidence,
        assetTag: tag,
        legendSymbols: dxfLegendSymbols as Parameters<typeof inferAssetTypeFromEvidence>[0]['legendSymbols'],
      });
      if (inferred) {
        atype = inferred.assetType;
        det.evidence.push(`Type inferred: ${inferred.reason}`);
      } else if (tag) {
        atype = GENERIC_ASSET_TYPE;
        det.evidence.push(`No evidence-based type; assigned fallback: ${GENERIC_ASSET_TYPE}`);
      }
    }

    // Drop untagged UNKNOWN
    if (atype === 'UNKNOWN' && !tag) { dropped++; continue; }

    if (qualityGate({
      source: 'DXF',
      assetTag: tag,
      assetType: atype,
      confidence: det.confidence,
      evidence: det.evidence,
    }) === 'DROP') { dropped++; continue; }

    if (!resolved.matchedVocabulary && atype !== 'UNKNOWN') {
      det.evidence.push(`Type "${det.assetType}" has no exact standards match — kept for review`);
      fixedType++;
    } else if (atype !== det.assetType) {
      det.evidence.push(`Type "${det.assetType}" mapped → ${atype}`);
      fixedType++;
    }

    const validationStatus =
      atype === 'UNKNOWN' || !resolved.matchedVocabulary ? 'NEEDS_REVIEW' : 'VALID';
    const candidateStatus =
      det.source === 'VISION' || det.needsAiClassification || det.needsGeminiClassification
        ? 'REVIEW_CANDIDATE'
        : 'FINAL';

    const global = parsedDxf.extents;
    const region = dxfResult.regions.find((r) => r.pidPage === det.pidPage)?.extents ?? global;
    const worldX = global ? global.minX + (det.bbox.x / 1000) * global.width : null;
    const worldY = global ? global.maxY - ((det.bbox.y + det.bbox.height) / 1000) * global.height : null;
    const worldW = global ? (det.bbox.width / 1000) * global.width : null;
    const worldH = global ? (det.bbox.height / 1000) * global.height : null;
    const sheetX = region && worldX !== null ? ((worldX - region.minX) / region.width) * 1000 : null;
    const sheetY = region && worldY !== null ? ((region.maxY - worldY - (worldH ?? 0)) / region.height) * 1000 : null;
    const sheetW = region && worldW !== null ? (worldW / region.width) * 1000 : null;
    const sheetH = region && worldH !== null ? (worldH / region.height) * 1000 : null;

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
          flow_confidence, relation_confidence, candidate_status, candidate_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)`,
      [
        uuidv4(), jobId, doc.id,
        pageIdByNumber.get(det.pidPage) ?? documentPageId,
        tag, atype, det.confidence,
        det.bbox.x, det.bbox.y, det.bbox.width, det.bbox.height,
        JSON.stringify(det.evidence),
        'DETECTED', 'PENDING',
        det.source === 'VISION' ? 'DXF_VISION' : 'DXF',
        det.pidPage,
        effectiveLegendId ?? null,
        det.size ?? null,
        validationStatus,
        'GLOBAL_NORMALIZED', worldX, worldY, worldW, worldH,
        sheetX, sheetY, sheetW, sheetH,
        det.confidence, tag ? 0.9 : 0,
        det.evidence.some((e) => /bbox from .*geometry/i.test(e)) ? 0.9 : 0.55,
        atype !== 'UNKNOWN' ? 0.85 : 0,
        0, 0,
        candidateStatus, 'DXF',
      ],
    );
    inserted++;
  }

  console.log(`\nPersisted : ${inserted}  dropped : ${dropped}  droppedTag : ${droppedTag}  fixedType : ${fixedType}`);

  // ── Mark job COMPLETED ───────────────────────────────────────────────────
  await db.query(
    `UPDATE detection_jobs
        SET status='COMPLETED', progress_pct=100, completed_at=NOW()
      WHERE id=$1`,
    [jobId],
  );
  console.log(`Job ${jobId} → COMPLETED`);
  console.log('\nRun benchmark:');
  console.log('  npm run benchmark');

  await db.end?.();
  process.exit(0);
}

main().catch((err) => {
  console.error('rerun-dxf-detection failed:', err);
  process.exit(1);
});
