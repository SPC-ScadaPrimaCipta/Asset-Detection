/**
 * Knowledge-First Detection Pipeline
 *
 * 10-step priority chain. Gemini Vision is LAST resort, never primary.
 *
 *  1. Image Hash Cache          → exact hash match → instant return
 *  2. Company Legend            → user-selected legend symbol match
 *  3. Company Knowledge DB      → learned from user corrections (project hierarchy)
 *  4. Embedding Similarity      → vector cosine similarity >= 0.95 skip Vision
 *  5. Engineering Rule Engine   → configurable per-asset-type rules
 *  6. ISA 5.1 Standard          → builtin ISA symbols
 *  7. ISO 10628-2 Standard      → builtin ISO symbols
 *  8. API Standard              → placeholder
 *  9. Gemini Vision Validation  → validator only (ranks candidates, never invents)
 * 10. UNKNOWN                   → confidence below threshold
 */

import { pool } from '@/lib/db';
import { lookupCompanyKnowledge, type CompanyKnowledge } from '@/lib/knowledge-db';
import { lookupCache, type CacheEntry } from '@/lib/symbol-cache';
import { searchSimilar, type SimilarityMatch } from '@/lib/vector-repository';
import { evaluateRules } from '@/lib/rule-engine';
import {
  fuseConfidence, computeOcrScore, embeddingSimilarityToScore,
  ruleResultToScore, DEFAULT_WEIGHTS, getFusionWeights, type EvidenceScores,
} from '@/lib/confidence-fusion';
import { DetectionAudit } from '@/lib/detection-audit';
import { getNegativePenalty } from '@/lib/learning/negative-learning';
import { buildTuning, type ValidatorTuning } from '@/lib/tuning';

export type DetectionSource =
  | 'CACHE'
  | 'LEGEND'
  | 'COMPANY_KB'
  | 'EMBEDDING'
  | 'RULE_ENGINE'
  | 'ISA'
  | 'ISO'
  | 'API_STD'
  | 'VISION'
  | 'UNKNOWN';

export interface LegendSymbol {
  id: string;
  legend_id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  description: string | null;
  aliases: string[];
  standard_code: string | null;
  isa_function_code: string | null;
  iso_category: string | null;
  reference_image_url?: string | null;
}

export interface RuleValidationInput {
  tagPrefix: string | null;
  detectedAssetType: string | null;
  // Fix #2: full asset tag (e.g. "P-101") passed from ai-agent so ocrScore can
  // check exact tag presence in OCR text, not just prefix+dash ("P-").
  detectedAssetTag?: string | null;
  aiConfidence: number;
  legendId: string | null;
  legendSymbols: LegendSymbol[];
  projectId: string | null;
  ocrText?: string;
  imageHash?: string | null;       // SHA256 of symbol crop
  cropHash?: string | null;        // alias for imageHash — used by negative penalty lookup
  symbolEmbedding?: number[] | null; // 768-dim embedding of canonical features
  canonicalFeatures?: string | null; // serialized features string
  symbolFeatures?: Record<string, unknown> | null; // parsed features for rule engine
  drawingType?: string | null;     // e.g. 'P&ID', 'PFD', 'ISOMETRIC' — for company knowledge Level 1
  /** Resolved validator tuning; defaults to the env layer when omitted. */
  tuning?: ValidatorTuning;
}

export interface RuleValidationResult {
  source: DetectionSource;
  resolvedAssetType: string;
  resolvedAssetName: string;
  tagPrefix: string | null;
  confidence: number;
  confidenceBreakdown: Record<string, number>;
  ruleApplied: string;
  audit: DetectionAudit;
  embeddingMatches?: SimilarityMatch[];
  cacheEntry?: CacheEntry;
  knowledgeEntry?: CompanyKnowledge;
  legendSymbol?: LegendSymbol;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolved validator tuning.
 *
 * Defaults to the env layer so this module stays usable synchronously (tests,
 * scripts). `validateDetection` prefers the caller-supplied tuning slice, which
 * may come from the Settings DB.
 */
function validatorTuning(overrides?: ValidatorTuning): ValidatorTuning {
  return overrides ?? buildTuning().validator;
}

export function extractTagPrefix(tag: string | null): string | null {
  if (!tag) return null;
  const m = tag.match(/^([A-Z]+)/i);
  return m ? m[1].toUpperCase() : null;
}

function matchesTagPattern(tag: string, pattern: string): boolean {
  const esc = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
    .replace(/#/g, '\\d')
    .replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i').test(tag);
}

/** Asset types that mean "unclassified scan output" — never authoritative. */
const UNCLASSIFIED_TYPES = new Set(['', 'other', 'unknown', 'n/a', '-', 'misc']);

/** Generic categories where tag prefix alone cannot differentiate specific equipment. */
const GENERIC_TYPES = new Set(['valve', 'equipment', 'instrument', 'other', 'unknown', 'n/a', '-', 'misc', 'fitting', 'device']);

export function isSpecificAssetType(t: string | null | undefined): boolean {
  if (!t) return false;
  const l = t.trim().toLowerCase();
  return l.length >= 3 && !GENERIC_TYPES.has(l);
}

/**
 * Format specific asset name from legend symbol to clean Title Case.
 * Cleans operational annotations like "(OPEN/CLOSED)", "1) OPEN POSITION...", etc.
 * E.g. "BALL VALVE" -> "Ball Valve"
 *      "GATE VALVE (OPEN/CLOSED)" -> "Gate Valve"
 *      "(GLOBE VALVE) 1) OPEN POSITION 2) CLOSED..." -> "Globe Valve"
 */
export function formatLegendAssetType(symbolName: string | null | undefined, fallbackType: string): string {
  const toTitle = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  if (!symbolName || !symbolName.trim()) {
    return toTitle(fallbackType);
  }

  let clean = symbolName.trim();

  // 1. Prefix parenthesis at start: "(GLOBE VALVE) 1) OPEN..." -> "GLOBE VALVE"
  const leadParenMatch = clean.match(/^\(([A-Z0-9\s\-]+)\)/i);
  if (leadParenMatch) {
    clean = leadParenMatch[1].trim();
  } else {
    // 2. Trailing numbered annotations e.g. "1) OPEN POSITION..."
    clean = clean.replace(/\s*\b\d+\)\s*[^]*$/gi, '').trim();

    // 3. Operational status in parenthesis e.g. "(OPEN/CLOSED)", "(CLOSED POSITION)"
    clean = clean.replace(/\s*\([^)]*(open|close|position|standby|normal|forced|operator|accessible|part\s*config)[^)]*\)/gi, '').trim();
  }

  clean = clean.replace(/[\s\-_:;,]+$/, '').trim();

  if (clean.length >= 3 && !/^(unknown|other|misc|n\/a|-)$/i.test(clean)) {
    return toTitle(clean);
  }

  return toTitle(fallbackType);
}

/** Drop unclassified symbols so they can't shadow real standards matches. */
function classified(symbols: LegendSymbol[]): LegendSymbol[] {
  return symbols.filter((s) => !UNCLASSIFIED_TYPES.has((s.asset_type ?? '').trim().toLowerCase()));
}

function levenshteinDist(a: string, b: string): number {
  const la = a.length, lb = b.length;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[lb];
}

function findInLegend(
  symbols: LegendSymbol[],
  tagPrefix: string | null,
  assetType: string | null,
  fullTag?: string | null
): LegendSymbol | null {
  symbols = classified(symbols);
  if (!symbols.length) return null;

  const cleanType = (assetType ?? '').trim().toLowerCase();
  const hasSpecificType = isSpecificAssetType(cleanType);

  // 1. Priority 1: When visual detection identified a specific asset type
  // (e.g. "Ball Valve", "Gate Valve", "Centrifugal Pump"), match the symbol
  // representing that specific equipment FIRST. Do NOT let generic prefix "V"
  // blindly pick the first valve in the legend array.
  if (hasSpecificType) {
    // 1a. Exact match on symbol_name, asset_type, or aliases
    const exactMatches = symbols.filter(
      s => (s.symbol_name && s.symbol_name.trim().toLowerCase() === cleanType) ||
           (s.asset_type && s.asset_type.trim().toLowerCase() === cleanType) ||
           (s.aliases && s.aliases.some(a => a.toLowerCase() === cleanType))
    );
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) {
      if (tagPrefix) {
        const withTag = exactMatches.find(s => s.tag_pattern && s.tag_pattern.toUpperCase().startsWith(tagPrefix.toUpperCase()));
        if (withTag) return withTag;
      }
      return exactMatches[0];
    }

    // 1b. Substring or fuzzy match on symbol_name or asset_type
    const fuzzyMatches = symbols.filter(s => {
      const name = (s.symbol_name ?? '').toLowerCase();
      const atype = (s.asset_type ?? '').toLowerCase();
      return name.includes(cleanType) || cleanType.includes(name) ||
             (atype && (atype.includes(cleanType) || cleanType.includes(atype))) ||
             (s.aliases && s.aliases.some(a => a.toLowerCase().includes(cleanType) || cleanType.includes(a.toLowerCase())));
    });

    if (fuzzyMatches.length > 0) {
      fuzzyMatches.sort((a, b) => {
        const distA = Math.min(
          levenshteinDist((a.symbol_name ?? '').toLowerCase(), cleanType),
          levenshteinDist((a.asset_type ?? '').toLowerCase(), cleanType)
        );
        const distB = Math.min(
          levenshteinDist((b.symbol_name ?? '').toLowerCase(), cleanType),
          levenshteinDist((b.asset_type ?? '').toLowerCase(), cleanType)
        );
        return distA - distB;
      });

      if (tagPrefix) {
        const withTag = fuzzyMatches.find(s => s.tag_pattern && s.tag_pattern.toUpperCase().startsWith(tagPrefix.toUpperCase()));
        if (withTag && levenshteinDist((withTag.symbol_name ?? '').toLowerCase(), cleanType) <= 10) {
          return withTag;
        }
      }
      return fuzzyMatches[0];
    }
  }

  // 2. Full tag pattern match if provided
  if (fullTag) {
    const byPattern = symbols.find(s => s.tag_pattern && matchesTagPattern(fullTag, s.tag_pattern));
    if (byPattern) return byPattern;
  }

  // 3. Fallback: Tag prefix match (when assetType is generic, unknown, or null)
  if (tagPrefix) {
    const byPrefix = symbols.find(s => {
      if (!s.tag_pattern) return false;
      const prefixPart = s.tag_pattern.split('-')[0].replace(/#|\*/g, '');
      return prefixPart.toUpperCase() === tagPrefix.toUpperCase();
    });
    if (byPrefix) return byPrefix;

    const byAlias = symbols.find(s =>
      s.aliases?.some(a => a.toUpperCase() === tagPrefix.toUpperCase())
    );
    if (byAlias) return byAlias;
  }

  // 4. Fallback: Generic assetType match
  if (assetType) {
    const byType = symbols.find(
      s => s.asset_type.toLowerCase() === assetType.toLowerCase() ||
           (s.symbol_name ?? '').toLowerCase() === assetType.toLowerCase()
    );
    if (byType) return byType;
  }

  return null;
}

const builtinCache = new Map<string, LegendSymbol[]>();

async function loadBuiltinSymbols(standardCode: 'ISA_5_1' | 'ISO_10628_2'): Promise<LegendSymbol[]> {
  if (builtinCache.has(standardCode)) return builtinCache.get(standardCode)!;
  const result = await pool.query(
    `SELECT ls.* FROM legend_symbols ls
     JOIN legends l ON l.id = ls.legend_id
     WHERE l.standard_code = $1 AND l.is_builtin = TRUE AND ls.status = 'ACTIVE'`,
    [standardCode]
  );
  const symbols = result.rows as LegendSymbol[];
  builtinCache.set(standardCode, symbols);
  return symbols;
}

/**
 * Extract tag prefix from OCR text when tagPrefix is not available from AI detection.
 * Uses ISA 5.1 first-letter identifier mapping to convert asset type → likely prefix.
 *
 * M9 fix: previously took only first char (e.g. Pressure→P) which is wrong.
 * Now uses known multi-char ISA prefix mapping. Returns null if no confident mapping.
 *
 * CONSERVATIVE: returns null rather than guess. Caller falls back to Vision-only.
 */
function extractPrefixFromOcr(ocrText: string | undefined, assetType: string | null): string | null {
  if (!ocrText || !assetType) return null;
  const tokens = ocrText.match(/\b([A-Z]{1,6}-\d+)/g);
  if (!tokens?.length) return null;

  const lower = assetType.toLowerCase();

  // ISA 5.1 standard first-letter identifier mapping (asset type → expected prefix starts)
  // Only map types where prefix is unambiguously multi-char in ISA standard.
  // Do NOT map types that share first letter with other equipment (e.g. Pump=P, Pressure=P).
  const ISA_PREFIX_HINTS: Array<{ keywords: string[]; prefixStarts: string[] }> = [
    { keywords: ['flow transmitter', 'flow indicator', 'flow controller'], prefixStarts: ['FT', 'FI', 'FIC', 'FC'] },
    { keywords: ['pressure transmitter', 'pressure indicator', 'pressure controller', 'pressure differential'], prefixStarts: ['PT', 'PI', 'PIC', 'PDT', 'PD'] },
    { keywords: ['temperature transmitter', 'temperature indicator', 'temperature controller'], prefixStarts: ['TT', 'TI', 'TIC', 'TC'] },
    { keywords: ['level transmitter', 'level indicator', 'level controller'], prefixStarts: ['LT', 'LI', 'LIC', 'LC'] },
    { keywords: ['pressure safety valve', 'pressure relief', 'safety relief'], prefixStarts: ['PSV', 'PRV', 'SRV'] },
    { keywords: ['shutdown valve', 'emergency shutdown'], prefixStarts: ['SDV', 'ESV', 'BDV'] },
    { keywords: ['control valve', 'flow control valve'], prefixStarts: ['FCV', 'FV', 'LCV', 'LV', 'PCV', 'PV', 'TCV', 'TV', 'XV'] },
    { keywords: ['solenoid valve', 'on/off valve'], prefixStarts: ['XV', 'SDV', 'MOV'] },
    { keywords: ['motor operated valve'], prefixStarts: ['MOV', 'XV'] },
    { keywords: ['analyzer', 'analysis'], prefixStarts: ['AT', 'AI', 'AIC', 'AC'] },
    { keywords: ['junction box'], prefixStarts: ['JB'] },
    { keywords: ['local control panel', 'control panel'], prefixStarts: ['LCP', 'CP'] },
  ];

  for (const hint of ISA_PREFIX_HINTS) {
    if (hint.keywords.some(kw => lower.includes(kw))) {
      // Find first OCR token that starts with any of the expected prefixes
      for (const ps of hint.prefixStarts) {
        const match = tokens.find(t => t.startsWith(ps + '-'));
        if (match) return match.split('-')[0];
      }
    }
  }

  // No confident mapping found — return null rather than guess wrong prefix
  return null;
}

function buildFusion(opts: {
  legendScore?: number;
  companyScore?: number;
  embeddingScore?: number;
  ocrScore?: number;
  rulesScore?: number;
  visionScore?: number;
}): ReturnType<typeof fuseConfidence> {
  const scores: EvidenceScores = {
    legend: opts.legendScore ?? null,
    company: opts.companyScore ?? null,
    embedding: opts.embeddingScore ?? null,
    ocr: opts.ocrScore ?? null,
    rules: opts.rulesScore ?? null,
    vision: opts.visionScore ?? null,
  };
  return fuseConfidence(scores, getFusionWeights());
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function validateDetection(input: RuleValidationInput): Promise<RuleValidationResult> {
  const {
    tagPrefix, detectedAssetType, detectedAssetTag, aiConfidence,
    legendSymbols, projectId, ocrText,
    imageHash, cropHash, symbolEmbedding, canonicalFeatures, symbolFeatures,
    drawingType,
  } = input;
  const T = validatorTuning(input.tuning);
  // cropHash is alias for imageHash — prefer cropHash if both provided
  const effectiveHash = cropHash ?? imageHash ?? null;
  const audit = new DetectionAudit();
  const effectivePrefix = tagPrefix ?? extractPrefixFromOcr(ocrText, detectedAssetType);
  // Fix #2: use full asset tag for OCR score — "P-101" exact match instead of "P-" prefix match.
  // Previously `tagPrefix + "-"` matched every tag starting with the prefix, inflating ocrScore.
  // Now we prefer full tag (most specific), fall back to prefix if tag not available.
  const ocrScore = computeOcrScore(
    detectedAssetTag ?? (tagPrefix ? `${tagPrefix}-` : detectedAssetType),
    ocrText
  );

  // ── Step 1: Image Hash Cache ─────────────────────────────────────────────
  if (effectiveHash) {
    const t = Date.now();
    try {
      const cached = await lookupCache(effectiveHash);
      if (cached) {
        const fusion = buildFusion({
          legendScore: T.legendScoreVerified,  // cache = a verified detection, treat as legend-level
          ocrScore: ocrScore ?? undefined,
        });
        audit.hit('Cache', fusion.confidence, `Hash match: ${effectiveHash.slice(0, 12)}…`, Date.now() - t);
        return {
          source: 'CACHE',
          resolvedAssetType: cached.asset_type,
          resolvedAssetName: cached.asset_name,
          tagPrefix: effectivePrefix ?? cached.tag_prefix,
          confidence: fusion.confidence,
          confidenceBreakdown: fusion.confidence_breakdown,
          ruleApplied: 'Step 1: Image hash cache hit — skipping all pipeline steps',
          audit,
          cacheEntry: cached,
        };
      }
      audit.miss('Cache', 'No hash match', Date.now() - t);
    } catch (err) {
      audit.addStep({ step: 'Cache', result: 'error', confidence: null, detail: String(err), duration_ms: Date.now() - t });
    }
  } else {
    audit.skip('Cache');
  }

  // ── Step 2: Company Legend ───────────────────────────────────────────────
  const t2 = Date.now();
  const userSymbols = legendSymbols.filter(s => !s.standard_code);
  const legendMatch = findInLegend(userSymbols, effectivePrefix, detectedAssetType, detectedAssetTag ?? null);
  if (legendMatch) {
    const ruleResult = symbolFeatures
      ? await evaluateRules(legendMatch.asset_type, symbolFeatures)
      : null;
    const fusion = buildFusion({
      legendScore: T.legendScoreVerified,
      ocrScore: ocrScore ?? undefined,
      rulesScore: ruleResult?.rule_score,
      visionScore: aiConfidence,
    });
    audit.hit('Legend', fusion.confidence, `Matched: "${legendMatch.symbol_name ?? legendMatch.asset_type}"`, Date.now() - t2);
    const resolvedType = formatLegendAssetType(legendMatch.symbol_name, legendMatch.asset_type);
    return {
      source: 'LEGEND',
      resolvedAssetType: resolvedType,
      resolvedAssetName: legendMatch.symbol_name ?? legendMatch.asset_type,
      tagPrefix: effectivePrefix,
      confidence: fusion.confidence,
      confidenceBreakdown: fusion.confidence_breakdown,
      ruleApplied: `Step 2: Legend match "${legendMatch.symbol_name ?? legendMatch.asset_type}"`,
      audit,
      legendSymbol: legendMatch,
    };
  }
  audit.miss('Legend', `No match for prefix=${effectivePrefix} type=${detectedAssetType}`, Date.now() - t2);

  // ── Step 3: Company Knowledge (hierarchy: project → company → global) ───
  const t3 = Date.now();
  const kbMatches = await lookupCompanyKnowledge({
    tagPrefix: effectivePrefix,
    assetType: detectedAssetType,
    projectId,
    drawingType: drawingType ?? null,  // activates Level 1 hierarchy (project + drawing + tag)
  });
  if (kbMatches.length > 0) {
    const best = kbMatches[0];
    const bonus = Math.min(
      Math.floor(best.confirmed_count / T.companyConfirmBonusEvery) * T.companyConfirmBonusStep,
      T.companyConfirmBonusMax,
    );
    const companyScore = Math.min(T.companyBaseScore + bonus, T.companyMaxScore);
    const fusion = buildFusion({
      companyScore,
      ocrScore: ocrScore ?? undefined,
      visionScore: aiConfidence,
    });
    audit.hit('CompanyKB', fusion.confidence, `"${best.asset_name}" confirmed ${best.confirmed_count}×`, Date.now() - t3);
    const resolvedType = formatLegendAssetType(best.asset_name, best.asset_type);
    return {
      source: 'COMPANY_KB',
      resolvedAssetType: resolvedType,
      resolvedAssetName: best.asset_name,
      tagPrefix: effectivePrefix ?? best.tag_prefix,
      confidence: fusion.confidence,
      confidenceBreakdown: fusion.confidence_breakdown,
      ruleApplied: `Step 3: Company KB "${best.asset_name}" (confirmed ${best.confirmed_count}×)`,
      audit,
      knowledgeEntry: best,
    };
  }
  audit.miss('CompanyKB', 'No match', Date.now() - t3);

  // ── Step 4: Embedding Similarity ─────────────────────────────────────────
  let embeddingMatches: SimilarityMatch[] = [];
  if (symbolEmbedding && symbolEmbedding.length > 0) {
    const t4 = Date.now();
    try {
      embeddingMatches = await searchSimilar({ embedding: symbolEmbedding, projectId, limit: 5 });
      const best = embeddingMatches[0];
      if (best && best.similarity >= T.embeddingMinSimilarity) {
        const embScore = embeddingSimilarityToScore(best.similarity);
        const ruleResult = symbolFeatures
          ? await evaluateRules(best.asset_type, symbolFeatures)
          : null;
        const fusion = buildFusion({
          embeddingScore: embScore,
          ocrScore: ocrScore ?? undefined,
          rulesScore: ruleResult?.rule_score,
          visionScore: best.similarity >= T.embeddingSkipThreshold ? undefined : aiConfidence,
        });
        const skipsVision = best.similarity >= T.embeddingSkipThreshold;
        audit.hit('Embedding', fusion.confidence, `similarity=${best.similarity.toFixed(3)} "${best.asset_type}"${skipsVision ? ' — Vision SKIPPED' : ''}`, Date.now() - t4);

        if (skipsVision) {
          return {
            source: 'EMBEDDING',
            resolvedAssetType: best.asset_type,
            resolvedAssetName: best.asset_name,
            tagPrefix: effectivePrefix ?? best.tag_prefix,
            confidence: fusion.confidence,
            confidenceBreakdown: fusion.confidence_breakdown,
            ruleApplied: `Step 4: Embedding similarity ${(best.similarity * 100).toFixed(1)}% ≥ ${(T.embeddingSkipThreshold * 100).toFixed(0)}% — Gemini Vision skipped`,
            audit,
            embeddingMatches,
          };
        }
        // similarity < threshold: continue pipeline but carry embedding score
      } else {
        audit.miss('Embedding', `Best similarity=${best?.similarity?.toFixed(3) ?? 'N/A'} below threshold`, Date.now() - t4);
      }
    } catch (err) {
      audit.addStep({ step: 'Embedding', result: 'error', confidence: null, detail: String(err), duration_ms: Date.now() - t4 });
    }
  } else {
    audit.skip('Embedding');
  }

  // ── Step 5: Rule Engine (standalone validation for ISA/ISO candidates) ───
  // Runs here as a pre-filter before ISA/ISO standard lookup
  let ruleScore: number | null = null;
  if (symbolFeatures && detectedAssetType) {
    const t5 = Date.now();
    const ruleResult = await evaluateRules(detectedAssetType, symbolFeatures);
    ruleScore = ruleResult.rule_score;
    audit.addStep({
      step: 'RuleEngine',
      result: ruleScore >= T.ruleScoreHit ? 'hit' : 'miss',
      confidence: ruleScore,
      detail: ruleResult.reasons.slice(0, 3).join(' | '),
      duration_ms: Date.now() - t5,
    });
  } else {
    audit.skip('RuleEngine');
  }

  // ── Step 6: ISA 5.1 ──────────────────────────────────────────────────────
  const t6 = Date.now();
  const isaSymbols = await loadBuiltinSymbols('ISA_5_1');
  const isaMatch = findInLegend(isaSymbols, effectivePrefix, detectedAssetType, detectedAssetTag ?? null);
  if (isaMatch) {
    const embScore = embeddingMatches[0]
      ? embeddingSimilarityToScore(embeddingMatches[0].similarity)
      : null;
    const fusion = buildFusion({
      legendScore: T.legendScoreIsa,  // ISA = standard, not user legend
      embeddingScore: embScore ?? undefined,
      ocrScore: ocrScore ?? undefined,
      rulesScore: ruleScore ?? undefined,
      visionScore: aiConfidence,
    });
    audit.hit('ISA', fusion.confidence, `"${isaMatch.symbol_name ?? isaMatch.asset_type}"`, Date.now() - t6);
    const resolvedType = formatLegendAssetType(isaMatch.symbol_name, isaMatch.asset_type);
    return {
      source: 'ISA',
      resolvedAssetType: resolvedType,
      resolvedAssetName: isaMatch.symbol_name ?? isaMatch.asset_type,
      tagPrefix: effectivePrefix,
      confidence: fusion.confidence,
      confidenceBreakdown: fusion.confidence_breakdown,
      ruleApplied: `Step 6: ISA 5.1 "${isaMatch.symbol_name ?? isaMatch.asset_type}"`,
      audit,
      legendSymbol: isaMatch,
    };
  }
  audit.miss('ISA', `No match`, Date.now() - t6);

  // ── Step 7: ISO 10628-2 ──────────────────────────────────────────────────
  const t7 = Date.now();
  const isoSymbols = await loadBuiltinSymbols('ISO_10628_2');
  const isoMatch = findInLegend(isoSymbols, effectivePrefix, detectedAssetType, detectedAssetTag ?? null);
  if (isoMatch) {
    const embScore = embeddingMatches[0]
      ? embeddingSimilarityToScore(embeddingMatches[0].similarity)
      : null;
    const fusion = buildFusion({
      legendScore: T.legendScoreIso,
      embeddingScore: embScore ?? undefined,
      ocrScore: ocrScore ?? undefined,
      rulesScore: ruleScore ?? undefined,
      visionScore: aiConfidence,
    });
    audit.hit('ISO', fusion.confidence, `"${isoMatch.symbol_name ?? isoMatch.asset_type}"`, Date.now() - t7);
    const resolvedType = formatLegendAssetType(isoMatch.symbol_name, isoMatch.asset_type);
    return {
      source: 'ISO',
      resolvedAssetType: resolvedType,
      resolvedAssetName: isoMatch.symbol_name ?? isoMatch.asset_type,
      tagPrefix: effectivePrefix,
      confidence: fusion.confidence,
      confidenceBreakdown: fusion.confidence_breakdown,
      ruleApplied: `Step 7: ISO 10628-2 "${isoMatch.symbol_name ?? isoMatch.asset_type}"`,
      audit,
      legendSymbol: isoMatch,
    };
  }
  audit.miss('ISO', `No match`, Date.now() - t7);

  // ── Step 8: API Standard — placeholder ──────────────────────────────────
  audit.skip('API_STD');

  // ── Step 9: Gemini Vision (validator only) ───────────────────────────────
  if (detectedAssetType && aiConfidence >= T.confidenceThreshold) {
    const embScore = embeddingMatches[0]
      ? embeddingSimilarityToScore(embeddingMatches[0].similarity)
      : null;

    // F2: Apply negative learning penalty — reduces confidence for previously-rejected predictions.
    // Queries cumulative rejection count for this asset type + project + crop hash.
    // Penalty: 1-2 rejections → -0.05, 3-5 → -0.10, 6-10 → -0.20, >10 → -0.30.
    let negPenalty = 0;
    try {
      negPenalty = await getNegativePenalty({
        predictedAssetType: detectedAssetType,
        projectId: projectId ?? null,
        cropHash: effectiveHash,
      });
    } catch {
      // Negative penalty lookup is non-fatal
    }
    const adjustedVisionScore = Math.max(0, aiConfidence + negPenalty);

    if (negPenalty < 0) {
      audit.addStep({
        step: 'NegativePenalty',
        result: 'hit',
        confidence: adjustedVisionScore,
        detail: `Penalty ${(negPenalty * 100).toFixed(0)}% applied to "${detectedAssetType}" (prior rejections)`,
      });
    }

    // F3: Tag conflict detection — flag when Vision-predicted type contradicts OCR tag prefix.
    // Example: Vision says "Pump" but OCR tag "XV-101" prefix "XV" known as Valve in legend/ISA/ISO.
    // We do NOT override the result — we add conflict evidence and reduce confidence so it
    // surfaces as NEEDS_REVIEW in the human review queue.
    const conflictEvidence: string[] = [];
    if (effectivePrefix && detectedAssetType) {
      // Check if tag prefix maps to a different asset type via legend, ISA, or ISO
      const allSymbols = [
        ...legendSymbols,
        ...(await loadBuiltinSymbols('ISA_5_1')),
        ...(await loadBuiltinSymbols('ISO_10628_2')),
      ];
      const prefixMatch = findInLegend(allSymbols, effectivePrefix, null);
      if (
        prefixMatch &&
        prefixMatch.asset_type.toLowerCase() !== detectedAssetType.toLowerCase() &&
        !(prefixMatch.symbol_name ?? '').toLowerCase().includes(detectedAssetType.toLowerCase()) &&
        !detectedAssetType.toLowerCase().includes((prefixMatch.symbol_name ?? prefixMatch.asset_type).toLowerCase())
      ) {
        conflictEvidence.push(
          `CONFLICT: Vision predicted "${detectedAssetType}" but tag prefix "${effectivePrefix}" ` +
          `maps to "${prefixMatch.asset_type}" in ${prefixMatch.standard_code ?? 'Legend'} — verify`
        );
        audit.addStep({
          step: 'TagConflict',
          result: 'hit',
          confidence: null,
          detail: conflictEvidence[0],
        });
      }
    }

    const fusion = buildFusion({
      embeddingScore: embScore ?? undefined,
      ocrScore: ocrScore ?? undefined,
      rulesScore: ruleScore ?? undefined,
      visionScore: adjustedVisionScore,
    });

    const hasConflict = conflictEvidence.length > 0;
    audit.hit(
      'Vision',
      fusion.confidence,
      `AI confidence=${aiConfidence.toFixed(2)}${negPenalty < 0 ? ` penalty=${(negPenalty * 100).toFixed(0)}%` : ''}${hasConflict ? ' [TAG CONFLICT]' : ''} — no standard match found`
    );
    return {
      source: 'VISION',
      resolvedAssetType: detectedAssetType,
      resolvedAssetName: detectedAssetType,
      tagPrefix: effectivePrefix,
      confidence: hasConflict ? Math.min(fusion.confidence, T.capConflictConfidence) : fusion.confidence,
      confidenceBreakdown: fusion.confidence_breakdown,
      ruleApplied: hasConflict
        ? `Step 9: Vision — tag conflict detected: ${conflictEvidence[0]}`
        : 'Step 9: Vision fallback — all knowledge sources exhausted',
      audit,
      embeddingMatches: embeddingMatches.length > 0 ? embeddingMatches : undefined,
    };
  }

  // ── Step 10: UNKNOWN ─────────────────────────────────────────────────────
  const fusion = buildFusion({ visionScore: aiConfidence });
  audit.addStep({
    step: 'Unknown',
    result: 'hit',
    confidence: aiConfidence,
    detail: `All steps exhausted, confidence ${(aiConfidence * 100).toFixed(0)}% below threshold`,
  });
  return {
    source: 'UNKNOWN',
    resolvedAssetType: 'UNKNOWN',
    resolvedAssetName: 'UNKNOWN',
    tagPrefix: effectivePrefix,
    confidence: Math.min(aiConfidence, T.capUnknownConfidence),
    confidenceBreakdown: fusion.confidence_breakdown,
    ruleApplied: 'Step 10: All knowledge sources exhausted — marked UNKNOWN for human review',
    audit,
  };
}

/**
 * Batch validate detections with shared context (loads builtins once).
 */
export async function validateDetections(
  detections: Array<{
    assetTag: string | null;
    assetType: string | null;
    confidence: number;
    imageHash?: string | null;
    symbolEmbedding?: number[] | null;
    canonicalFeatures?: string | null;
    symbolFeatures?: Record<string, unknown> | null;
  }>,
  context: {
    legendId: string | null;
    legendSymbols: LegendSymbol[];
    projectId: string | null;
    ocrText?: string;
  }
): Promise<RuleValidationResult[]> {
  const results: RuleValidationResult[] = [];
  for (const d of detections) {
    results.push(
      await validateDetection({
        tagPrefix: extractTagPrefix(d.assetTag),
        detectedAssetType: d.assetType,
        aiConfidence: d.confidence,
        legendId: context.legendId,
        legendSymbols: context.legendSymbols,
        projectId: context.projectId,
        ocrText: context.ocrText,
        imageHash: d.imageHash,
        symbolEmbedding: d.symbolEmbedding,
        canonicalFeatures: d.canonicalFeatures,
        symbolFeatures: d.symbolFeatures,
      })
    );
  }
  return results;
}
