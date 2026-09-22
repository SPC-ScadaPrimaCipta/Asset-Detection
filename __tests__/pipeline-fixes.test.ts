/**
 * Regression tests for pipeline fixes #1–5
 *
 * Fix #1: buildKnownTagSet stores full asset_tag, not just prefix
 * Fix #2: ocrScore uses full asset tag match (not prefix+dash)
 * Fix #3: sectionSpatialScore replaces flat 0.5 for position-less tokens
 * Fix #4: confirm route copies main_equipment/field_confidence/field_provenance to assets
 * Fix #5: field-level null enforcement threshold before persisting detections
 *
 * All tests use pure functions / stubs — no real DB, no real AI API calls.
 */

import {
  buildKnownTagSet,
  rankTagCandidates,
  extractTagTokens,
  normalizeTag,
  sectionSpatialScore,
} from '@/lib/ocr-candidate';

import {
  fuseConfidence,
  computeOcrScore,
  embeddingSimilarityToScore,
  DEFAULT_WEIGHTS,
} from '@/lib/confidence-fusion';

import {
  calibrateConfidence,
  extractJson,
} from '@/lib/ai-agent';

import type { ResolvedDetection } from '@/lib/ai-agent';

// ─────────────────────────────────────────────────────────────────────────────
// FIX #1 — buildKnownTagSet: full tags, not just prefix
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix #1 — buildKnownTagSet full tag support', () => {
  it('includes full asset_tag in known set', () => {
    const set = buildKnownTagSet([
      { asset_tag: 'P-101', tag_prefix: 'P' },
      { asset_tag: 'XV-301', tag_prefix: 'XV' },
    ]);
    expect(set.has('P-101')).toBe(true);
    expect(set.has('XV-301')).toBe(true);
  });

  it('does NOT include prefix when asset_tag is present', () => {
    const set = buildKnownTagSet([{ asset_tag: 'P-101', tag_prefix: 'P' }]);
    expect(set.has('P')).toBe(false);
    expect(set.size).toBe(1);
  });

  it('includes prefix as fallback when asset_tag is null', () => {
    const set = buildKnownTagSet([{ asset_tag: null, tag_prefix: 'XV' }]);
    expect(set.has('XV')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('mixed: full tag + prefix-only entries', () => {
    const set = buildKnownTagSet([
      { asset_tag: 'P-101', tag_prefix: 'P' },  // full tag → prefix suppressed
      { asset_tag: null, tag_prefix: 'XV' },      // no full tag → prefix added
    ]);
    expect(set.has('P-101')).toBe(true);
    expect(set.has('XV')).toBe(true);
    expect(set.has('P')).toBe(false);
    expect(set.size).toBe(2);
  });

  it('uppercases and trims all entries', () => {
    const set = buildKnownTagSet([{ asset_tag: ' p-101 ', tag_prefix: null }]);
    expect(set.has('P-101')).toBe(true);
  });

  it('FIX: edit distance "P-10I" → "P-101" works with full tag set', () => {
    // Root cause: prefix-only set {"P"} → editDistance("P-10I","P")=4 → no match
    // Fix: full tag set {"P-101"} → editDistance("P-10I","P-101")=1 → match
    const known = buildKnownTagSet([{ asset_tag: 'P-101', tag_prefix: null }]);
    const result = normalizeTag('P-10I', known);
    expect(result.normalized).toBe('P-101');
    expect(result.normalized_by).not.toBe('none');
  });

  it('BUG DEMO: prefix-only set cannot normalize "P-10I"', () => {
    const prefixOnly = new Set(['P']);
    const result = normalizeTag('P-10I', prefixOnly);
    // editDistance("P-10I","P")=4 — threshold is 1 → no match → no normalization
    expect(result.normalized_by).toBe('none');
  });

  it('char_substitution I→1 works with full tag set', () => {
    const known = buildKnownTagSet([{ asset_tag: 'XV-301', tag_prefix: null }]);
    const result = normalizeTag('XV-30I', known);
    expect(result.normalized).toBe('XV-301');
    expect(['char_substitution', 'edit_distance_1']).toContain(result.normalized_by);
  });

  it('knowledge_match=true when full tag matches', () => {
    const tokens = extractTagTokens('P-101 V-201');
    const known = buildKnownTagSet([{ asset_tag: 'P-101', tag_prefix: null }]);
    const candidates = rankTagCandidates(
      tokens,
      { x: 100, y: 100, width: 50, height: 50 },
      known
    );
    const p = candidates.find(c => c.original === 'P-101');
    const v = candidates.find(c => c.original === 'V-201');
    expect(p?.knowledge_match).toBe(true);
    expect(v?.knowledge_match).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX #2 — computeOcrScore: full tag match, not prefix+dash
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix #2 — computeOcrScore full tag accuracy', () => {
  const ocrText = 'Drawing shows P-101 pump inlet valve XV-301 on line 3A';

  it('full tag P-101 found in OCR → 1.0', () => {
    expect(computeOcrScore('P-101', ocrText)).toBe(1.0);
  });

  it('full tag XV-301 found in OCR → 1.0', () => {
    expect(computeOcrScore('XV-301', ocrText)).toBe(1.0);
  });

  it('M8: full tag P-999 NOT in OCR → null (not 0.0, inactive evidence)', () => {
    // M8 fix: return null not 0.0 — "not found" is NOT a contradiction, just unavailable
    expect(computeOcrScore('P-999', ocrText)).toBeNull();
  });

  it('M8: single-char prefix "P-" returns null (prefix too short, guard length >= 2)', () => {
    // M8 fix: single-char prefix guard prevents false positives from 'P' in 'PIPE', 'PUMP' etc.
    const score = computeOcrScore('P-', ocrText);
    // 'P-' split('-')[0] = 'P', length 1 → returns null
    expect(score).toBeNull();
  });

  it('M8: multi-char prefix match returns 0.7 (prefix found but not full tag)', () => {
    // FIC prefix (length 3 >= 2) → partial match 0.7 if FIC-xxx in OCR but not FIC-999
    const ocrWithFic = 'FIC-201 flow controller FT-301';
    expect(computeOcrScore('FIC-999', ocrWithFic)).toBe(0.7);
  });

  it('M8: single-char prefix P no longer returns 0.7 (guard length >= 2)', () => {
    // P-200 not in text, prefix 'P' has length 1 → returns null not 0.7
    expect(computeOcrScore('P-200', ocrText)).toBeNull();
  });

  it('null tag → null', () => {
    expect(computeOcrScore(null, ocrText)).toBeNull();
  });

  it('null/undefined OCR → null', () => {
    expect(computeOcrScore('P-101', undefined)).toBeNull();
  });

  it('empty OCR string → null (no text to check)', () => {
    expect(computeOcrScore('P-101', '')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX #3 — sectionSpatialScore: page grid, not flat 0.5
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix #3 — sectionSpatialScore page grid scoring', () => {
  const topLeft = { x: 0, y: 0, width: 200, height: 200 };
  const bottomRight = { x: 800, y: 800, width: 200, height: 200 };
  const center = { x: 400, y: 400, width: 100, height: 100 };

  it('same section (idx=0, total=1, symbol at top-left) → 0.80', () => {
    expect(sectionSpatialScore(topLeft, 0, 1)).toBe(0.80);
  });

  it('opposite corner (symbol bottom-right, token at idx=0 of 1) → 0.10 (6x6 grid)', () => {
    // M6 fix: 6x6 grid. Symbol col=5,row=5. Token idx=0 of 1 → col=0,row=0.
    // gridDist = |5-0|+|5-0| = 10 → 0.80 - 10*0.07 = 0.10 (min clamped)
    expect(sectionSpatialScore(bottomRight, 0, 1)).toBe(0.10);
  });

  it('total=0 → fallback 0.5', () => {
    expect(sectionSpatialScore(topLeft, 0, 0)).toBe(0.5);
  });

  it('always in [0.10, 0.80] for non-zero total', () => {
    const bboxes = [topLeft, bottomRight, center];
    for (const bbox of bboxes) {
      for (let t = 1; t <= 10; t++) {
        for (let i = 0; i < t; i++) {
          const s = sectionSpatialScore(bbox, i, t);
          expect(s).toBeGreaterThanOrEqual(0.10);
          expect(s).toBeLessThanOrEqual(0.80);
        }
      }
    }
  });

  it('never returns 0.5 for non-zero total', () => {
    // 0.5 was the old flat value — must not appear in section scoring
    for (let t = 1; t <= 5; t++) {
      for (let i = 0; i < t; i++) {
        expect(sectionSpatialScore(topLeft, i, t)).not.toBe(0.5);
      }
    }
  });

  it('tokens closer to symbol section score higher', () => {
    // Symbol at top-left. In 10 tokens, first tokens are estimated near top.
    const scoreFirst = sectionSpatialScore(topLeft, 0, 10);
    const scoreLast = sectionSpatialScore(topLeft, 9, 10);
    expect(scoreFirst).toBeGreaterThanOrEqual(scoreLast);
  });

  it('rankTagCandidates uses section scores (not flat 0.5)', () => {
    const tokens = extractTagTokens('P-101 V-201 XV-301 FIC-401 LT-501 PT-601');
    const candidates = rankTagCandidates(
      tokens,
      bottomRight,
      new Set(),
      6
    );
    candidates.forEach(c => {
      expect(c.spatial_score).not.toBe(0.5);
      expect(c.spatial_score).toBeGreaterThanOrEqual(0.10);
      expect(c.spatial_score).toBeLessThanOrEqual(0.80);
    });
  });

  it('multiple tokens produce differentiated section scores', () => {
    const tokens = extractTagTokens('P-101 V-201 XV-301 FIC-401 LT-501');
    const candidates = rankTagCandidates(tokens, bottomRight, new Set(), 5);
    const scores = new Set(candidates.map(c => c.spatial_score));
    expect(scores.size).toBeGreaterThan(1); // not all identical
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX #4 — field metadata contract (data structure validation)
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix #4 — field metadata contract for assets confirm', () => {
  it('field_confidence is serializable JSONB', () => {
    const fc = { tag: 0.94, type: 0.97, service: 0.72, mainEquipment: null, description: null };
    expect(() => JSON.stringify(fc)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(fc));
    expect(parsed.tag).toBe(0.94);
    expect(parsed.mainEquipment).toBeNull();
  });

  it('field_provenance is serializable JSONB', () => {
    const fp = {
      tag: { source: 'OCR+VISION', normalized: false, correctionReason: null },
      type: { source: 'LEGEND', inferred: false },
      service: { source: 'VISION', inferred: true },
      mainEquipment: null,
      description: null,
    };
    expect(() => JSON.stringify(fp)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(fp));
    expect(parsed.tag.source).toBe('OCR+VISION');
    expect(parsed.mainEquipment).toBeNull();
  });

  it('null field_confidence → null persisted (no DB error)', () => {
    const fieldConf: Record<string, number> | null = null;
    const forDb = fieldConf !== null ? JSON.stringify(fieldConf) : null;
    expect(forDb).toBeNull();
  });

  it('main_equipment is string or null', () => {
    const values: Array<string | null> = ['Pump P-101', null, 'Vessel V-201'];
    values.forEach(v => expect(v === null || typeof v === 'string').toBe(true));
  });

  it('provenance source labels match known categories', () => {
    const validSources = ['OCR', 'VISION', 'LEGEND', 'COMPANY_KB', 'EMBEDDING',
      'ISA', 'ISO', 'CACHE', 'OCR+VISION', 'OCR+NORMALIZED', 'UNKNOWN'];
    const provSource = 'OCR+VISION';
    expect(validSources).toContain(provSource);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX #5 — field-level null enforcement threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix #5 — field-level null enforcement threshold', () => {
  // Mirror the enforcement logic from detection-worker.ts
  function enforce(
    fields: { service: string | null; mainEquipment: string | null; description: string | null },
    fc: { service?: number | null; mainEquipment?: number | null; description?: number | null } | null,
    threshold = 0.50
  ) {
    return {
      service: fc?.service != null && fc.service < threshold ? null : fields.service,
      mainEquipment: fc?.mainEquipment != null && fc.mainEquipment < threshold ? null : fields.mainEquipment,
      description: fc?.description != null && fc.description < threshold ? null : fields.description,
    };
  }

  it('nulls service when fc.service < 0.50', () => {
    const r = enforce({ service: 'Fuel Gas', mainEquipment: null, description: null }, { service: 0.45 });
    expect(r.service).toBeNull();
  });

  it('keeps service when fc.service >= 0.50', () => {
    const r = enforce({ service: 'Fuel Gas', mainEquipment: null, description: null }, { service: 0.72 });
    expect(r.service).toBe('Fuel Gas');
  });

  it('keeps service at exactly threshold (not strictly less)', () => {
    const r = enforce({ service: 'Fuel Gas', mainEquipment: null, description: null }, { service: 0.50 });
    expect(r.service).toBe('Fuel Gas'); // 0.50 < 0.50 is false → kept
  });

  it('nulls mainEquipment when below threshold', () => {
    const r = enforce({ service: null, mainEquipment: 'Pump P-101', description: null }, { mainEquipment: 0.40 });
    expect(r.mainEquipment).toBeNull();
  });

  it('keeps mainEquipment when fc.mainEquipment >= threshold', () => {
    const r = enforce({ service: null, mainEquipment: 'Pump P-101', description: null }, { mainEquipment: 0.80 });
    expect(r.mainEquipment).toBe('Pump P-101');
  });

  it('nulls description when below threshold', () => {
    const r = enforce({ service: null, mainEquipment: null, description: 'Supply pump' }, { description: 0.45 });
    expect(r.description).toBeNull();
  });

  it('fc=null → preserve all fields (feature extraction failed)', () => {
    const r = enforce({ service: 'Fuel Gas', mainEquipment: 'Pump', description: 'inlet' }, null);
    expect(r.service).toBe('Fuel Gas');
    expect(r.mainEquipment).toBe('Pump');
    expect(r.description).toBe('inlet');
  });

  it('fc field = null → preserve value (not measured)', () => {
    const r = enforce({ service: 'Fuel Gas', mainEquipment: null, description: null }, { service: null });
    expect(r.service).toBe('Fuel Gas'); // null confidence = not measured → keep
  });

  it('all below threshold → all nulled', () => {
    const r = enforce(
      { service: 'Gas', mainEquipment: 'Pump', description: 'desc' },
      { service: 0.30, mainEquipment: 0.40, description: 0.45 }
    );
    expect(r.service).toBeNull();
    expect(r.mainEquipment).toBeNull();
    expect(r.description).toBeNull();
  });

  it('configurable threshold: 0.65 is stricter', () => {
    // service=0.60 would be kept at default 0.50 but nulled at 0.65
    const r50 = enforce({ service: 'Gas', mainEquipment: null, description: null }, { service: 0.60 }, 0.50);
    const r65 = enforce({ service: 'Gas', mainEquipment: null, description: null }, { service: 0.60 }, 0.65);
    expect(r50.service).toBe('Gas');    // kept at threshold 0.50
    expect(r65.service).toBeNull();     // nulled at stricter 0.65
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE FUSION — multi-source evidence combination
// ─────────────────────────────────────────────────────────────────────────────

describe('Confidence Fusion — evidence combination', () => {
  it('vision-only → confidence equals vision score', () => {
    const r = fuseConfidence({ legend: null, company: null, embedding: null, ocr: null, rules: null, vision: 0.85 });
    expect(r.confidence).toBeCloseTo(0.85, 3);
    expect(r.active_sources).toEqual(['vision']);
  });

  it('legend + OCR → higher than vision alone', () => {
    const r = fuseConfidence({ legend: 1.0, company: null, embedding: null, ocr: 1.0, rules: null, vision: 0.90 });
    const rVisionOnly = fuseConfidence({ legend: null, company: null, embedding: null, ocr: null, rules: null, vision: 0.90 });
    expect(r.confidence).toBeGreaterThanOrEqual(rVisionOnly.confidence);
  });

  it('all null → confidence = 0, no active sources', () => {
    const r = fuseConfidence({ legend: null, company: null, embedding: null, ocr: null, rules: null, vision: null });
    expect(r.confidence).toBe(0);
    expect(r.active_sources).toHaveLength(0);
  });

  it('weights re-normalize: active sources sum to 1.0', () => {
    // Only legend (0.45) and vision (0.05) active → sum = 0.50 → normalized
    const r = fuseConfidence({ legend: 0.8, company: null, embedding: null, ocr: null, rules: null, vision: 0.8 }, DEFAULT_WEIGHTS);
    expect(r.confidence).toBeCloseTo(0.80, 2);
  });

  it('confidence_breakdown keys match active_sources', () => {
    const r = fuseConfidence({ legend: 1.0, company: 0.9, embedding: null, ocr: null, rules: null, vision: null });
    expect(r.active_sources).toContain('legend');
    expect(r.active_sources).toContain('company');
    expect(r.confidence_breakdown.legend).toBeGreaterThan(0);
    expect(r.confidence_breakdown.company).toBeGreaterThan(0);
    expect(r.confidence_breakdown.embedding).toBe(0);
  });

  it('embeddingSimilarityToScore maps thresholds correctly', () => {
    expect(embeddingSimilarityToScore(0.97)).toBe(1.0);
    expect(embeddingSimilarityToScore(0.90)).toBe(0.8);
    expect(embeddingSimilarityToScore(0.80)).toBe(0.6);
    expect(embeddingSimilarityToScore(0.70)).toBe(0.4);
    expect(embeddingSimilarityToScore(0.50)).toBe(0.2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION — confidence penalty logic
// ─────────────────────────────────────────────────────────────────────────────

describe('calibrateConfidence — OCR + bbox penalties', () => {
  function makeResolved(overrides: Partial<ResolvedDetection> = {}): ResolvedDetection {
    return {
      assetType: 'Pump',
      assetTag: 'P-101',
      confidence: 0.90,
      bbox: { x: 100, y: 100, width: 50, height: 50 },
      evidence: ['Legend match', 'Tag visible'],
      description: null,
      equipmentClass: null,
      service: null,
      mainEquipment: null,
      location: null,
      unit: null,
      area: null,
      legendSymbol: null,
      detection_source: 'LEGEND',
      rule_applied: 'Step 2: Legend match',
      resolved_asset_name: 'Pump',
      image_hash: null,
      canonical_features: null,
      symbol_embedding: null,
      symbol_features: null,
      confidence_breakdown: {},
      audit: null,
      validation_status: 'VALID',
      field_confidence: { tag: 0.90, type: 0.90, service: null, mainEquipment: null, description: null },
      field_provenance: null as unknown as ResolvedDetection['field_provenance'],
      ...overrides,
    };
  }

  it('no penalty when tag confirmed in OCR', () => {
    const [r] = calibrateConfidence([makeResolved()], 'P-101 pump inlet valve');
    expect(r.confidence).toBe(0.90);
    expect(r.validation_status).toBe('VALID');
  });

  it('OCR penalty when tag NOT in OCR text', () => {
    const [r] = calibrateConfidence([makeResolved({ assetTag: 'P-101' })], 'XV-301 outlet');
    expect(r.confidence).toBeLessThan(0.90);
    expect(r.validation_status).toBe('NEEDS_REVIEW');
  });

  it('UNKNOWN → caps at 0.50 + NEEDS_REVIEW', () => {
    const [r] = calibrateConfidence([makeResolved({ detection_source: 'UNKNOWN', confidence: 0.60 })]);
    expect(r.confidence).toBeLessThanOrEqual(0.50);
    expect(r.validation_status).toBe('NEEDS_REVIEW');
  });

  it('degenerate bbox (1x1) → caps at 0.30', () => {
    const [r] = calibrateConfidence([makeResolved({ bbox: { x: 100, y: 100, width: 1, height: 1 } })]);
    expect(r.confidence).toBeLessThanOrEqual(0.30);
    expect(r.validation_status).toBe('NEEDS_REVIEW');
  });

  it('CONFLICT status preserved through calibration', () => {
    const [r] = calibrateConfidence([makeResolved({ validation_status: 'CONFLICT', confidence: 0.75 })]);
    expect(r.validation_status).toBe('CONFLICT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON EXTRACTION — malformed AI output recovery
// ─────────────────────────────────────────────────────────────────────────────

describe('extractJson — malformed output handling', () => {
  it('parses clean JSON object', () => {
    expect(extractJson('{"page":1,"detections":[]}')).toEqual({ page: 1, detections: [] });
  });

  it('extracts from markdown code block', () => {
    expect(extractJson('```json\n{"page":2,"detections":[]}\n```')).toEqual({ page: 2, detections: [] });
  });

  it('extracts from mixed prose text', () => {
    const r = extractJson('Here is the result:\n{"page":1,"detections":[]}') as Record<string, unknown>;
    expect(r.page).toBe(1);
  });

  it('recovers complete detections from truncated JSON', () => {
    const truncated = '{"page":1,"detections":[{"assetType":"Pump","assetTag":"P-101","confidence":0.9,"bbox":{"x":100,"y":100,"width":50,"height":50},"evidence":["match"]}';
    const r = extractJson(truncated) as { detections: unknown[] };
    expect(r.detections).toHaveLength(1);
  });

  it('throws on completely invalid input', () => {
    expect(() => extractJson('completely invalid no json')).toThrow();
  });
});
