/**
 * LOCAL WORKER WIRING — deterministic page pipeline (Phase 10 defaults).
 *
 * Render → tiles → CV candidates (mask ON) → tileToPage → dedup →
 * OCR/tag association → Legend match (refine+repair ON) → confidence →
 * persist. No Gemini anywhere in this path.
 *
 * Contract: returns { status } where 'service-down' tells the caller to use
 * the legacy Gemini path (keeps UI working when the sidecar is offline).
 * Any per-page deterministic exception is caught by the caller, which falls
 * back per page — a page never fails just because CV hiccupped.
 */
import { createHash } from 'crypto';
import { detectionConfig } from '@/lib/detection/config';
import { renderPageTiles } from '@/lib/pdf-render';
import { getFile } from '@/lib/storage';
import { getPdfPageCountFromBuffer } from '@/lib/pdf-render';
import {
  cvCandidates,
  cvHealth,
} from '@/lib/detection/cv-client';
import { cvConfidence } from '@/lib/detection/scoring/confidence-client';
import {
  deduplicatePageCandidates,
  mapTileCandidatesToPage,
} from '@/lib/detection/pipeline/tile-candidate-pipeline';
import {
  pageToNormalized,
  type PageGeometry,
} from '@/lib/detection/geometry/coordinate-transform';
import { rankAssociationsForText } from '@/lib/detection/geometry/spatial-association';
import {
  cvLegendDefsFromCrops,
  cvLegendExtract,
  cvLegendMatch,
} from '@/lib/detection/legend/legend-client';
import type {
  LegendDefinition,
  LegendMatchResult,
} from '@/lib/detection/legend/legend-model';
import type {
  CvCandidate,
  PageCandidate,
} from '@/lib/detection/candidates/schema';
import {
  persistDetections,
  type PersistableDetection,
} from '@/lib/detection/persistence/detection-repository';

export interface DetPageOpts {
  buf: Buffer;
  page: number;
  jobId: string;
  docId: string;
  filename: string;
  effectiveLegendId: string | null;
  legendSymbols: { id: string; asset_type: string; symbol_name?: string | null; tag_pattern?: string | null }[];
  tagPatterns: { id: string; regex: string }[];
  legendDefs: LegendDefinition[];
  nullThreshold: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}
export type DetPageStatus = 'ok' | 'service-down';

export interface DetStageCounts {
  visualCandidates: number;
  ocrCandidates: number;
  maskedCandidates: number;
  splitFragments: number;
  reunitedCandidates: number;
  refinedCandidates: number;
  repairedMatches: number;
  legendMatches: number;
  finalDetections: number;
}

/** Legend tag_pattern (P-### style) → regex source for the CV tag parser. */
export function legendTagPatterns(
  symbols: { tag_pattern?: string | null }[]
): { id: string; regex: string }[] {
  const out: { id: string; regex: string }[] = [];
  let i = 0;
  for (const s of symbols) {
    if (!s.tag_pattern) continue;
    const esc = String(s.tag_pattern)
      .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
      .replace(/#/g, '\\d')
      .replace(/\*/g, '.*');
    out.push({ id: `legend-${i++}`, regex: `^${esc}$` });
  }
  return out;
}

const legendDefsCache = new Map<string, LegendDefinition[]>();

export interface LegendSymbolRow {
  id: string;
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
  aliases?: string[] | null;
  reference_image_url?: string | null;
  status?: string | null;
  quality_status?: string | null;
  superseded_by?: string | null;
}

/**
 * Matcher eligibility gate (Stage 3 rule, enforced at runtime).
 * Excludes: human-rejected rows, quality-rejected rows, superseded versions.
 * Everything else passes through (including `review` and unassessed rows —
 * strict validated-only gating happens via user curation + finalize gate,
 * not by silently dropping the working set here).
 * Migration-tolerant: missing columns read as undefined → pass-through.
 */
export function filterEligibleSymbols<T extends LegendSymbolRow>(symbols: T[]): T[] {
  return symbols.filter(
    (s) =>
      s.status !== 'REJECTED' &&
      s.quality_status !== 'rejected' &&
      !s.superseded_by
  );
}

export async function loadLegendDefs(
  legendId: string,
  log: (msg: string, extra?: Record<string, unknown>) => void,
  symbols: LegendSymbolRow[] = []
): Promise<LegendDefinition[]> {
  // Preferred: human-reviewed DB reference crops (approved labels, no OCR).
// Eligibility gate: superseded versions and rejected rows never feed matching.
  const withCrops = filterEligibleSymbols(symbols).filter((s) => s.reference_image_url);
  if (withCrops.length > 0) {
    try {
      const inputs = [];
      for (const s of withCrops) {
        try {
          const buf = (await getFile(s.reference_image_url!)) as unknown as Buffer;
          inputs.push({
            symbolId: s.id,
            label: s.symbol_name || s.asset_type,
            aliases: s.aliases ?? [],
            cropPngBase64: buf.toString('base64'),
          });
        } catch {
          /* missing crop file — skip symbol */
        }
      }
      if (inputs.length > 0) {
        const res = await cvLegendDefsFromCrops(legendId, inputs).catch(() => null);
        if (res && res.definitions.length > 0) {
          log('legend definitions built from reference crops', {
            legendId, symbols: inputs.length, defs: res.definitions.length,
          });
          return res.definitions;
        }
      }
    } catch (e: unknown) {
      log('legend crops path failed — PDF fallback', {
        error: (e instanceof Error ? e.message : String(e)).slice(0, 160),
      });
    }
  }
  // Fallback: raw PDF extraction (dense sheets may yield 0 — logged, not fatal).
  let pdf: Buffer;
  try {
    pdf = (await getFile(`legend-${legendId}.pdf`)) as unknown as Buffer;
  } catch {
    log('legend PDF not in storage — matching unavailable', { legendId });
    return [];
  }
  const sha = createHash('sha256').update(pdf).digest('hex');
  const key = `${legendId}:${sha}`;
  const hit = legendDefsCache.get(key);
  if (hit) return hit;
  const pageCount = await getPdfPageCountFromBuffer(pdf).catch(() => 1);
  const n = Math.min(pageCount, detectionConfig.cv.legendExtractPages);
  const pages: { pageNumber: number; pngBase64: string }[] = [];
  for (let p = 1; p <= n; p++) {
    try {
      // Single-tile render (tileSize >> page) — one render, full-page PNG.
      const { png } = await renderPageTiles(pdf, p, {
        scale: detectionConfig.cv.renderScale,
        tileSize: 8192,
        overlap: 0,
      });
      pages.push({ pageNumber: p, pngBase64: png.toString('base64') });
    } catch (e) {
      log('legend page render failed', { page: p, error: String(e).slice(0, 120) });
    }
  }
  if (pages.length === 0) return [];
  const res = await cvLegendExtract(
    legendId,
    pages,
    { pdfSha256: sha, ocrProvider: detectionConfig.cv.ocrProvider }
  ).catch(() => null);
  const defs = res?.definitions ?? [];
  legendDefsCache.set(key, defs);
  log('legend definitions built', { legendId, pages: pages.length, defs: defs.length });
  return defs;
}

export async function clearLegendDefsCache(): Promise<void> {
  legendDefsCache.clear();
}

export async function processPageDeterministic(
  opts: DetPageOpts
): Promise<{ status: DetPageStatus; count: number; stageCounts?: DetStageCounts }> {
  const { buf, page, log } = opts;
  const t0 = Date.now();

  const health = await cvHealth(5000);
  if (!health) return { status: 'service-down', count: 0 };

  // 1. Render + tile (single render).
  const scale = detectionConfig.cv.renderScale;
  const { tiles, pageWidth, pageHeight, png } = await renderPageTiles(buf, page, {
    scale,
    tileSize: detectionConfig.tiling.tileSize,
    overlap: detectionConfig.tiling.overlap,
  });
  const pageB64 = png.toString('base64');
  const geo: PageGeometry = { pageWidth, pageHeight };
  log(`page ${page} deterministic: rendered ${pageWidth}x${pageHeight}, ${tiles.length} tiles`, { page });

  // 2. Per-tile candidates (mask ON per Phase 10 defaults).
  const tileResults = await Promise.all(
    tiles.map(async (t) => {
      const result = await cvCandidates({
        pngBase64: t.png.toString('base64'),
        pageNumber: page,
        tile: {
          pageNumber: page, tileX: t.tileX, tileY: t.tileY,
          tileWidth: t.width, tileHeight: t.height,
          pageWidth, pageHeight, sourceDpi: t.sourceDpi,
          overlap: t.overlap, tileIndex: t.index,
        },
        ocrProvider: detectionConfig.cv.ocrProvider,
        tagPatterns: opts.tagPatterns,
        mask: detectionConfig.cv.masking ? { ...detectionConfig.cv.mask } : false,
        lineSplit: detectionConfig.cv.masking && detectionConfig.cv.lineSplit,
        reunion: detectionConfig.cv.masking && detectionConfig.cv.lineSplit && detectionConfig.cv.reunion,
      });
      return {
        candidates: result?.candidates ?? [],
        stageCounts: result?.stageCounts,
      };
    })
  );
  const perTile: CvCandidate[][] = tileResults.map((r) => r.candidates);
  const stageCounts: DetStageCounts = {
    visualCandidates: tileResults.reduce((n, r) => n + (r.stageCounts?.visual ?? 0), 0),
    ocrCandidates: tileResults.reduce((n, r) => n + (r.stageCounts?.ocr ?? 0), 0),
    maskedCandidates: tileResults.reduce((n, r) => n + (r.stageCounts?.masked ?? 0), 0),
    splitFragments: tileResults.reduce((n, r) => n + (r.stageCounts?.splitFragments ?? 0), 0),
    reunitedCandidates: tileResults.reduce((n, r) => n + (r.stageCounts?.reunited ?? 0), 0),
    refinedCandidates: 0,
    repairedMatches: 0,
    legendMatches: 0,
    finalDetections: 0,
  };

  // 3. Tile → page → dedup (canonical pixels, never persisted tile-local).
  let pageCands: PageCandidate[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const { kept } = mapTileCandidatesToPage(perTile[i], {
      pageNumber: page, tileX: tiles[i].tileX, tileY: tiles[i].tileY,
      tileWidth: tiles[i].width, tileHeight: tiles[i].height,
      pageWidth, pageHeight, sourceDpi: tiles[i].sourceDpi,
      overlap: tiles[i].overlap, tileIndex: tiles[i].index,
    });
    pageCands.push(...kept);
  }
  pageCands = deduplicatePageCandidates(pageCands);
  const visuals = pageCands.filter((c) => c.candidateType === 'visual');
  const texts = pageCands.filter((c) => c.candidateType === 'text');
  log(`page ${page} deterministic: ${visuals.length} visual, ${texts.length} text`, { page });

  // 4. Tag ↔ symbol association (ranked, top-1 claims the symbol).
  // Only real tags claim symbols (isTag) — OCR fragments ("LL", "_", "7")
  // must never become asset tags. Non-tag texts stay unassociated.
  const symTag = new Map<string, PageCandidate>();
  const symAssocScore = new Map<string, number>();
  const rankedTexts = texts
    .filter((t) => t.tag?.isTag === true)
    .map((t) => ({
    id: t.candidateId,
    text: t.ocr?.text ?? t.tag?.normalized ?? '',
    bbox: t.bbox,
    pageNumber: page,
    isTag: t.tag?.isTag ?? false,
    tagLike: !!t.tag?.normalized?.includes('-'),
  }));
  for (const t of rankedTexts) {
    const ranked = rankAssociationsForText(
      t,
      visuals.map((v) => ({ id: v.candidateId, bbox: v.bbox, pageNumber: page })),
      geo
    );
    if (ranked.length === 0) continue;
    const best = ranked[0];
    const prev = symAssocScore.get(best.symbolId);
    if (prev === undefined || best.score > prev) {
      symAssocScore.set(best.symbolId, best.score);
      const tc = texts.find((x) => x.candidateId === t.id);
      if (tc) symTag.set(best.symbolId, tc);
    }
  }

  // 5. Legend match (refine+repair ON) — needs full-page PNG + page-space boxes.
  let matchById = new Map<string, LegendMatchResult>();
  if (opts.legendDefs.length > 0) {
    const res = await cvLegendMatch(
      opts.effectiveLegendId ?? '',
      pageB64,
      page,
      visuals.map((v) => ({ id: v.candidateId, bbox: v.bbox })),
      opts.legendDefs,
      undefined,
      {
        refine: detectionConfig.cv.bboxRefine,
        repair: detectionConfig.cv.matchRepair ? { ...detectionConfig.cv.repair } : null,
      }
    ).catch(() => null);
    if (res) {
      for (const r of res.results) {
        matchById.set(r.candidateId, r);
        if (r.refineNotes?.includes('bbox refined tight')) stageCounts.refinedCandidates++;
        if (r.matchFrom === 'reconstructed') stageCounts.repairedMatches++;
        if (r.matches.length > 0) stageCounts.legendMatches++;
      }
    }
  }

  // 6. Confidence per visual + persist mapping (legacy 0–1000 + pixel dual-write).
  // Wiring policy (documented): persist a visual only if it has a real tag
  // OR a legend match. Pure noise (no tag, no match) is counted and dropped —
  // review queues must not drown in UNKNOWN 0.4 rows.
  let droppedNoise = 0;
  const items: PersistableDetection[] = [];
  for (const v of visuals) {
    const m = matchById.get(v.candidateId);
    const top = m?.matches?.[0] ?? null;
    const tagCand = symTag.get(v.candidateId);
    const tagNorm = tagCand?.tag?.normalized ?? null;
    if (!tagNorm && !top) {
      droppedNoise++;
      continue;
    }
    const spatialTop = symAssocScore.get(v.candidateId);
    const ocrIn = tagCand
      ? { isTag: !!tagCand.tag?.isTag, confidence: tagCand.ocr?.confidence ?? 0.5 }
      : null;
    const legList = (m?.matches ?? []).slice(0, 3).map((x) => ({
      legendSymbolId: x.legendSymbolId, label: x.label, score: x.score,
    }));
    let confidence = top?.score ?? 0.4;
    let band: string = top ? 'REVIEW' : 'LOW';
    const conf = top
      ? await cvConfidence({
          candidateId: v.candidateId,
          signals: {
            geometryScore: top.features.geometryScore,
            contourScore: top.features.contourScore,
            templateScore: top.features.templateScore,
            edgeScore: top.features.edgeScore,
            scaleScore: top.features.scaleScore,
            rotationScore: null,
          },
          legendMatches: legList,
          spatialRanked: spatialTop !== undefined ? [{ symbolId: v.candidateId, score: spatialTop }] : [],
          ocr: ocrIn,
        }).catch(() => null)
      : null;
    if (conf) {
      confidence = conf.confidence;
      band = conf.decisionBand;
    }
    const norm = pageToNormalized(v.bbox, geo);
    const tagBox = tagCand?.bbox ?? null;
    items.push({
      assetTag: tagNorm,
      assetType: top?.label ?? 'UNKNOWN',
      description: null,
      equipmentClass: null,
      service: null,
      location: null,
      unit: null,
      area: null,
      mainEquipment: null,
      legendSymbol: top?.legendSymbolId ?? null,
      confidence,
      bbox: norm,
      evidence: [
        `DETERMINISTIC det-v2 band=${band}`,
        top ? `Legend match ${top.label} score=${top.score.toFixed(3)} (${m?.matchFrom ?? 'direct'})` : 'No legend match',
        tagNorm ? `Tag ${tagNorm} associated (spatial ${spatialTop?.toFixed(3) ?? 'n/a'})` : 'No tag associated',
      ],
      detection_source: 'DETERMINISTIC',
      canonical_features: null,
      image_hash: null,
      symbol_embedding: null,
      confidence_breakdown: null,
      validation_status: 'NEEDS_REVIEW',
      field_confidence: null,
      field_provenance: null,
      audit: null,
      symbolBboxPx: m?.queryBox ? { ...m.queryBox } : { ...v.bbox },
      tagBboxPx: tagBox ? { ...tagBox } : null,
      pageDims: { pageWidth, pageHeight },
      detEvidence: {
        pipelineVersion: detectionConfig.pipelineVersion,
        legendDefId: top?.legendSymbolId ?? null,
        matchFrom: m?.matchFrom ?? 'none',
        legendScore: top?.score ?? null,
        spatialScore: spatialTop ?? null,
        decisionBand: band,
        direct: m?.direct ?? null,
        reconstructed: m?.reconstructed ?? null,
        reconstruction: m?.reconstruction ?? {
          used: false,
          reason: 'no legend match',
        },
      },
    });
  }

  const res = await persistDetections(
    opts.db,
    items,
    {
      jobId: opts.jobId,
      docId: opts.docId,
      filename: opts.filename,
      effectiveLegendId: opts.effectiveLegendId,
      // Def symbolIds are DB legend_symbols ids (defs-from-crops path), so
      // the repository FK lookup resolves. PDF-extract defs use synthetic
      // ids → lookup misses → NULL (documented, non-fatal).
      legendSymbols: opts.legendSymbols.map((s) => ({
        id: s.id, asset_type: s.asset_type, symbol_name: s.symbol_name ?? null,
      })),
      nullThreshold: opts.nullThreshold,
    },
    page
  );
  log(`page ${page} deterministic done: ${res.persisted} persisted`, {
    page, ms: Date.now() - t0, visuals: visuals.length, droppedNoise,
    ...stageCounts, finalDetections: res.persisted,
  });
  stageCounts.finalDetections = res.persisted;
  return { status: 'ok', count: res.persisted, stageCounts };
}
