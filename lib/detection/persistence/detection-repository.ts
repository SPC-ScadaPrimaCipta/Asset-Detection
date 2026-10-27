/**
 * Detection V2 — detection persistence repository.
 *
 * Extracted 1:1 from workers/detection-worker.ts persist loop (no semantic
 * changes): tag normalization, Legend symbol resolution, field-confidence
 * gating (NULL_FIELD_CONFIDENCE_THRESHOLD), dual evidence append, pgvector
 * embedding string, audit-trail persist (non-fatal).
 *
 * Legacy 0–1000 `bbox_x/y/w/h` columns are STILL written (backward compat).
 * Fase 2 migration adds canonical `symbol_bbox_*` columns — repository
 * dual-writes both (see persistDetections).
 */
import { v4 as uuidv4 } from 'uuid';
import { detectionConfig } from '@/lib/detection/config';
import { formatLegendAssetType, isSpecificAssetType } from '@/lib/rule-validator';
import { classifyHybridCandidate } from '@/lib/mdo-pid-rules';

/** Minimal query surface — keeps the repository testable without a live DB. */
export interface DbLike {
  query(
    text: string,
    params: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface PageBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Subset of ResolvedPageDetection fields the repository consumes. */
export interface PersistableDetection {
  assetTag: string | null;
  assetType: string;
  description?: string | null;
  equipmentClass?: string | null;
  service?: string | null;
  location?: string | null;
  unit?: string | null;
  area?: string | null;
  mainEquipment?: string | null;
  legendSymbol?: string | null;
  legendSymbolId?: string | null;
  confidence: number;
  bbox: PageBBox;
  evidence: string[];
  size?: string | null;
  detection_source?: unknown;
  canonical_features?: unknown;
  image_hash?: unknown;
  symbol_embedding?: unknown;
  confidence_breakdown?: unknown;
  validation_status?: unknown;
  field_confidence?: unknown;
  field_provenance?: unknown;
  audit?: unknown;
  /**
   * Local-wiring pixel boxes (canonical page pixels). When present, the V2
   * dual-write stores THESE (not the legacy 0–1000 bbox) into symbol_bbox_*
   * plus tag_bbox_* and page dims. Absent → legacy mirror (Phase 2 behavior).
   */
  symbolBboxPx?: PageBBox | null;
  tagBboxPx?: PageBBox | null;
  pageDims?: { pageWidth: number; pageHeight: number } | null;
  /** Deterministic evidence passthrough (legend def id, matchFrom, scores). */
  detEvidence?: Record<string, unknown> | null;
  candidate_status?: 'FINAL' | 'REVIEW_CANDIDATE' | 'NOISE';
}

export interface LegendSymbolRef {
  id: string;
  asset_type: string;
  symbol_name?: string | null;
  /**
   * Source legend of this symbol. Set when symbols were merged from several
   * legends; detections then record the legend that actually matched, not the
   * job primary. Absent → falls back to `PersistContext.effectiveLegendId`.
   */
  legend_id?: string | null;
  sourceLegendId?: string | null;
}

export interface PersistContext {
  jobId: string;
  docId: string;
  filename: string;
  effectiveLegendId: string | null;
  legendSymbols: LegendSymbolRef[];
  /** Mirrors NULL_FIELD_CONFIDENCE_THRESHOLD (default 0.50). */
  nullThreshold: number;
}

/**
 * Normalize tag: remove spaces around hyphens ("JB - 03" → "JB-03"),
 * trim, collapse internal whitespace. (worker:426)
 */
export function normalizeAssetTag(tag: string | null): string | null {
  if (!tag) return null;
  return tag.trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
}

export function resolveLegendSymbolId(
  legendSymbol: string | null | undefined,
  legendSymbols: LegendSymbolRef[]
): string | null {
  return resolveLegendSymbol(legendSymbol, legendSymbols)?.id ?? null;
}

/**
 * Same match as resolveLegendSymbolId, but returns the whole symbol ref so the
 * caller can read its source legend. Kept separate (not a signature change) so
 * existing callers and tests are untouched.
 */
export function resolveLegendSymbol(
  legendSymbol: string | null | undefined,
  legendSymbols: LegendSymbolRef[]
): LegendSymbolRef | null {
  if (!legendSymbol) return null;
  const target = legendSymbol.trim().toLowerCase();
  if (!target) return null;

  // Direct id match first (defs-from-crops preserves DB ids).
  const byId = legendSymbols.find((s) => s.id === legendSymbol);
  if (byId) return byId;

  // Exact case-insensitive match on symbol_name or asset_type
  const exact = legendSymbols.find(
    (s) => (s.symbol_name && s.symbol_name.trim().toLowerCase() === target) ||
           (s.asset_type && s.asset_type.trim().toLowerCase() === target)
  );
  if (exact) return exact;

  // Substring match: e.g. "ball valve" matches "BALL VALVE (OPEN/CLOSED)"
  const bySub = legendSymbols.find(
    (s) => (s.symbol_name && (s.symbol_name.trim().toLowerCase().includes(target) || target.includes(s.symbol_name.trim().toLowerCase()))) ||
           (s.asset_type && (s.asset_type.trim().toLowerCase().includes(target) || target.includes(s.asset_type.trim().toLowerCase())))
  );
  if (bySub) return bySub;

  return null;
}

interface FieldConf {
  tag?: number | null;
  type?: number | null;
  service?: number | null;
  mainEquipment?: number | null;
  description?: number | null;
}

/**
 * Null low-evidence optional fields + append evidence note. (worker:384-404)
 * Returns persisted values + names of nulled fields for evidence.
 */
export function applyFieldConfidenceGate(
  d: PersistableDetection,
  nullThreshold: number
): {
  service: string | null;
  mainEquipment: string | null;
  description: string | null;
  evidence: string[];
} {
  const fc = d.field_confidence as FieldConf | null;
  const service =
    fc?.service != null && fc.service < nullThreshold ? null : (d.service ?? null);
  const mainEquipment =
    fc?.mainEquipment != null && fc.mainEquipment < nullThreshold
      ? null
      : (d.mainEquipment ?? null);
  const description =
    fc?.description != null && fc.description < nullThreshold
      ? null
      : (d.description ?? null);

  const nulledFields: string[] = [];
  if (service === null && d.service) nulledFields.push('service');
  if (mainEquipment === null && d.mainEquipment) nulledFields.push('mainEquipment');
  if (description === null && d.description) nulledFields.push('description');
  const evidence =
    nulledFields.length > 0
      ? [
          ...d.evidence,
          `Fields nulled (confidence < ${nullThreshold}): ${nulledFields.join(', ')} — insufficient evidence`,
        ]
      : d.evidence;
  return { service, mainEquipment, description, evidence };
}

export function formatEmbeddingForPg(symbolEmbedding: unknown): string | null {
  return symbolEmbedding && Array.isArray(symbolEmbedding)
    ? `[${(symbolEmbedding as number[]).join(',')}]`
    : null;
}

/**
 * Drop every detection this job previously wrote for one page.
 *
 * Detection has no natural unique key (no stable per-symbol id from the model),
 * so re-running a page would otherwise append a second copy of every row. The
 * worker calls this immediately before persisting a page, which makes page
 * persistence idempotent: a re-run replaces that page's rows instead of
 * duplicating them.
 *
 * Scoped to job_id + pid_page so a re-run of one page never touches the other
 * pages of the same job, nor any other job.
 */
export async function deleteDetectionsForPage(
  db: DbLike,
  jobId: string,
  page: number
): Promise<number> {
  const res = await db.query(
    'DELETE FROM detections WHERE job_id = $1 AND pid_page = $2',
    [jobId, page]
  );
  const rowCount = (res as { rowCount?: number }).rowCount;
  return typeof rowCount === 'number' ? rowCount : 0;
}

const INSERT_SQL = `INSERT INTO detections
    (id, job_id, document_id, asset_tag, asset_type, equipment_class, description,
     service, location, unit, area, pid_number, pid_page,
     legend_id, legend_symbol_id, confidence,
     bbox_x, bbox_y, bbox_w, bbox_h, evidence, detection_status, review_status,
     detection_source, canonical_features, crop_hash, embedding, confidence_breakdown,
      validation_status, main_equipment, field_confidence, field_provenance, size,
      candidate_status, candidate_source, component_name)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'DETECTED','PENDING',$22,$23,$24,$25::vector,$26,$27,$28,$29,$30,$31,$32,$33,$34)`;


/** Column list for the V2 dual-write (canonical symbol bbox). */
const DUAL_WRITE_SQL = `UPDATE detections
   SET symbol_bbox_x=$2, symbol_bbox_y=$3, symbol_bbox_w=$4, symbol_bbox_h=$5,
       tag_bbox_x=$6, tag_bbox_y=$7, tag_bbox_w=$8, tag_bbox_h=$9,
       page_width=$10, page_height=$11, pipeline_version=$12,
       detection_method=$13, deterministic_score=$14
 WHERE id=$1`;

export interface PersistResult {
  persisted: number;
  ids: string[];
}

let sizeColumnEnsured = false;
export async function ensureSizeColumn(db: DbLike): Promise<void> {
  if (sizeColumnEnsured) return;
  try {
    await db.query('ALTER TABLE detections ADD COLUMN IF NOT EXISTS size VARCHAR(255)', []);
    await db.query('ALTER TABLE assets ADD COLUMN IF NOT EXISTS size VARCHAR(255)', []);
    sizeColumnEnsured = true;
  } catch {
    // Non-fatal (e.g. read-only replica or already running)
  }
}

export async function persistDetections(
  db: DbLike,
  items: PersistableDetection[],
  ctx: PersistContext,
  page: number
): Promise<PersistResult> {
  await ensureSizeColumn(db);
  const ids: string[] = [];
  for (const d of items) {
    const matchedSymbol = d.legendSymbolId
      ? (ctx.legendSymbols.find((s) => s.id === d.legendSymbolId) ?? resolveLegendSymbol(d.legendSymbol, ctx.legendSymbols))
      : resolveLegendSymbol(d.legendSymbol, ctx.legendSymbols);
    const legendSymbolId = matchedSymbol?.id ?? d.legendSymbolId ?? null;

    let finalAssetType = d.assetType;
    if (matchedSymbol && matchedSymbol.symbol_name) {
      if (!isSpecificAssetType(d.assetType) || d.assetType.toLowerCase() === (matchedSymbol.asset_type ?? '').toLowerCase()) {
        finalAssetType = formatLegendAssetType(matchedSymbol.symbol_name, matchedSymbol.asset_type ?? d.assetType);
      }
    }

    const detectionSource = d.detection_source ?? 'VISION';
    const canonicalFeatures = d.canonical_features ?? null;
    const imageHash = d.image_hash ?? null;
    const confidenceBreakdown = d.confidence_breakdown ?? null;
    const validationStatus = d.validation_status ?? 'VALID';
    const candidateStatus = d.candidate_status ?? classifyHybridCandidate({
      source: String(detectionSource).includes('VISION') ? 'VISION' : 'YOLO_GEO2',
      assetTag: d.assetTag,
      assetType: finalAssetType,
      confidence: d.confidence,
      evidence: d.evidence,
    });
    const fieldConfidence = d.field_confidence ?? null;
    const fieldProvenance = d.field_provenance ?? null;

    const gated = applyFieldConfidenceGate(d, ctx.nullThreshold);
    const embeddingStr = formatEmbeddingForPg(d.symbol_embedding);
    // Deterministic evidence rides in confidence_breakdown (auditable in UI).
    // Merge only when the existing breakdown is a plain object (preserves
    // legacy string/JSON behavior otherwise).
    let breakdownJson: string | null =
      confidenceBreakdown ? JSON.stringify(confidenceBreakdown) : null;
    if (
      d.detEvidence &&
      confidenceBreakdown !== null &&
      typeof confidenceBreakdown === 'object' &&
      !Array.isArray(confidenceBreakdown)
    ) {
      breakdownJson = JSON.stringify({ ...(confidenceBreakdown as Record<string, unknown>), ...d.detEvidence });
    } else if (d.detEvidence && breakdownJson === null) {
      breakdownJson = JSON.stringify(d.detEvidence);
    }

    const detectionId = uuidv4();
    await db.query(INSERT_SQL, [
      detectionId,
      ctx.jobId,
      ctx.docId,
      normalizeAssetTag(d.assetTag),
      finalAssetType,
      d.equipmentClass ?? null,
      gated.description,
      gated.service,
      d.location ?? null,
      d.unit ?? null,
      d.area ?? null,
      ctx.filename,
      page,
      // Source legend of the matched symbol (multi-legend jobs); falls back to
      // the job primary when nothing matched or no source was recorded.
      matchedSymbol?.sourceLegendId ?? matchedSymbol?.legend_id ?? ctx.effectiveLegendId ?? null,
      legendSymbolId,
      d.confidence,
      Number.isFinite(d.bbox.x) ? Math.round(d.bbox.x) : 0,
      Number.isFinite(d.bbox.y) ? Math.round(d.bbox.y) : 0,
      Number.isFinite(d.bbox.width) ? Math.round(d.bbox.width) : 0,
      Number.isFinite(d.bbox.height) ? Math.round(d.bbox.height) : 0,
      JSON.stringify(gated.evidence),
      detectionSource,
      canonicalFeatures,
      imageHash,
      embeddingStr,
      breakdownJson,
      validationStatus,
      gated.mainEquipment,
      fieldConfidence ? JSON.stringify(fieldConfidence) : null,
      fieldProvenance ? JSON.stringify(fieldProvenance) : null,
      d.size ?? null,
      candidateStatus,
      detectionSource,
      (d as any).component_name ?? null,
    ]);

    // V2 dual-write: pixel boxes when supplied (local wiring), else legacy
    // mirror (Phase 2 behavior). Best-effort — ignored pre-migration.
    // detection_source for deterministic path is set by caller ('DETERMINISTIC').
    const px = d.symbolBboxPx ?? null;
    const tb = d.tagBboxPx ?? null;
    const pd = d.pageDims ?? null;
    try {
      await db.query(DUAL_WRITE_SQL, [
        detectionId,
        px ? Math.round(px.x) : Math.round(d.bbox.x),
        px ? Math.round(px.y) : Math.round(d.bbox.y),
        px ? Math.round(px.width) : Math.round(d.bbox.width),
        px ? Math.round(px.height) : Math.round(d.bbox.height),
        tb ? Math.round(tb.x) : null,
        tb ? Math.round(tb.y) : null,
        tb ? Math.round(tb.width) : null,
        tb ? Math.round(tb.height) : null,
        pd ? pd.pageWidth : null,
        pd ? pd.pageHeight : null,
        (d.detEvidence as Record<string, unknown> | undefined)?.pipelineVersion
          ?? detectionConfig.pipelineVersion,
        String(detectionSource) === 'DETERMINISTIC' ? 'DETERMINISTIC' : null,
        String(detectionSource) === 'DETERMINISTIC' ? d.confidence : null,
      ]);
    } catch {
      /* pre-migration DB: legacy columns already written above */
    }

    // F5: audit trail — non-fatal (worker:456-468)
    const auditObj = d.audit as {
      setDetectionId?: (id: string) => void;
      persist?: (opts: {
        finalSource: string;
        confidenceBreakdown: Record<string, number> | null;
      }) => Promise<void>;
    } | null;
    if (auditObj && typeof auditObj.persist === 'function') {
      auditObj.setDetectionId?.(detectionId);
      auditObj
        .persist({
          finalSource: String(detectionSource),
          confidenceBreakdown: confidenceBreakdown as Record<string, number> | null,
        })
        .catch((auditErr: unknown) => {
          console.warn(
            `[audit] persist failed (non-fatal) detection=${detectionId}:`,
            auditErr instanceof Error ? auditErr.message : auditErr
          );
        });
    }
    ids.push(detectionId);
  }
  return { persisted: ids.length, ids };
}
