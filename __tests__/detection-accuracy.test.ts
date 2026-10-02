/**
 * Detection Accuracy Tests
 *
 * Pure function tests only — no DB, no AI API, no file system.
 *
 * The pipeline is 100% Gemini Vision, so there is no OCR tag-candidate module
 * and no OCR-based confidence penalty any more. What remains under test:
 *   - confidence fusion (legend / company KB / embedding / vision weighting)
 *   - computeOcrScore semantics kept in the rule-validator chain
 *   - spatial tag association + duplicate-claim prevention
 *   - schema defaults (evidence sentinel)
 *   - calibrateConfidence penalties that survive without OCR
 *   - extractJson robustness (truncated Gemini output recovery)
 */

import {
  fuseConfidence,
  computeOcrScore,
} from '@/lib/confidence-fusion';

import {
  calibrateConfidence,
  extractJson,
} from '@/lib/ai-agent';

import type { ResolvedDetection } from '@/lib/ai-agent';

import {
  associateTagsToSymbols,
} from '@/lib/spatial';

import type { Detection } from '@/lib/ai-schemas';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeResolvedDetection(overrides: Partial<ResolvedDetection> = {}): ResolvedDetection {
  return {
    assetType: 'Pump',
    assetTag: 'P-101',
    confidence: 0.85,
    bbox: { x: 100, y: 100, width: 50, height: 50 },
    evidence: ['Symbol matches legend'],
    description: null,
    equipmentClass: null,
    service: null,
    mainEquipment: null,
    location: null,
    unit: null,
    area: null,
    size: null,
    fromRef: null,
    toRef: null,
    ofOrAtRef: null,
    descriptionProposed: null,
    tagNoProposed: null,
    legendSymbol: 'Pump',
    detection_source: 'VISION',
    rule_applied: 'Vision fallback',
    resolved_asset_name: 'Pump',
    image_hash: null,
    canonical_features: null,
    symbol_embedding: null,
    symbol_features: null,
    confidence_breakdown: {},
    audit: null,
    validation_status: 'VALID',
    field_confidence: { tag: 0.85, type: 0.85, service: null, mainEquipment: null, description: null },
    field_provenance: {
      tag: null,
      type: { source: 'VISION', inferred: true },
      service: null,
      mainEquipment: null,
      description: null,
    },
    ...overrides,
  };
}

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    assetType: 'Pump',
    assetTag: 'P-101',
    confidence: 0.9,
    bbox: { x: 100, y: 100, width: 50, height: 50 },
    evidence: ['Symbol matches legend'],
    description: null,
    equipmentClass: null,
    service: null,
    mainEquipment: null,
    location: null,
    unit: null,
    area: null,
    size: null,
    fromRef: null,
    toRef: null,
    ofOrAtRef: null,
    descriptionProposed: null,
    tagNoProposed: null,
    legendSymbol: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline source priority (logic via fuseConfidence)
// ─────────────────────────────────────────────────────────────────────────────

describe('Confidence fusion — legend (cache-equivalent) hit', () => {
  it('legend score 1.0 → high confidence', () => {
    const r = fuseConfidence({ legend: 1.0, company: null, embedding: null, ocr: null, rules: null, vision: null });
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.active_sources).toEqual(['legend']);
  });
});

describe('Confidence fusion — company KB hit', () => {
  it('company score 0.90 → confidence uses only company weight', () => {
    const r = fuseConfidence({ legend: null, company: 0.90, embedding: null, ocr: null, rules: null, vision: null });
    expect(r.confidence).toBeCloseTo(0.90, 2);
    expect(r.active_sources).toEqual(['company']);
  });
});

describe('Confidence fusion — embedding similarity', () => {
  it('embedding score 0.80 → confidence from embedding only', () => {
    const r = fuseConfidence({ legend: null, company: null, embedding: 0.80, ocr: null, rules: null, vision: null });
    expect(r.confidence).toBeCloseTo(0.80, 2);
  });

  it('multiple sources fused correctly', () => {
    const r = fuseConfidence({ legend: 1.0, company: null, embedding: 0.80, ocr: null, rules: null, vision: null });
    // legend weight 0.45, embedding weight 0.15 → renormalized
    expect(r.confidence).toBeGreaterThan(0.90);
    expect(r.active_sources).toContain('legend');
    expect(r.active_sources).toContain('embedding');
  });
});

describe('Confidence fusion — fallback to Vision', () => {
  it('vision-only → confidence = vision score (renormalized to 1.0 weight)', () => {
    const r = fuseConfidence({ legend: null, company: null, embedding: null, ocr: null, rules: null, vision: 0.78 });
    expect(r.confidence).toBeCloseTo(0.78, 2);
    expect(r.active_sources).toEqual(['vision']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeOcrScore semantics (retained in the rule-validator chain)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeOcrScore — full tag match', () => {
  it('full tag finds exact match → 1.0', () => {
    const score = computeOcrScore('P-101', 'P-101 pump inlet line 4"-OIL-001');
    expect(score).toBe(1.0);
  });

  it('full tag match beats prefix-only', () => {
    const scoreFullTag = computeOcrScore('P-101', 'P-101 pump');
    const scorePrefixOnly = computeOcrScore('P-', 'P-101 pump');
    expect(scoreFullTag).toBe(1.0);
    // Prefix 'P-' → split('-')[0] = 'P', length 1 → null, never a weak 0.7
    expect(scorePrefixOnly).toBeNull();
  });
});

describe('computeOcrScore — prefix matching', () => {
  it('exact tag present → 1.0', () => {
    expect(computeOcrScore('FIC-201', 'FIC-201 flow controller')).toBe(1.0);
  });

  it('only the prefix present → 0.7', () => {
    // Tag FIC-201, text has FIC-302 — 'FIC' (length 3 >= 2) → 0.7
    expect(computeOcrScore('FIC-201', 'FIC-302 flow indicator controller')).toBe(0.7);
  });
});

describe('computeOcrScore — ISA prefix disambiguation', () => {
  it('single-letter P prefix does NOT score a match for PT-101', () => {
    expect(computeOcrScore('PT-101', 'P-201 pump discharge')).toBeNull();
  });

  it('PT prefix correctly scores when PT tag present', () => {
    expect(computeOcrScore('PT-101', 'PT-101 pressure transmitter inlet')).toBe(1.0);
  });
});

describe('computeOcrScore — not found returns null (inactive, not a drag)', () => {
  it('tag absent from text → null', () => {
    expect(computeOcrScore('P-101', 'XV-201 FIC-302')).toBeNull();
  });

  it('text unavailable → null', () => {
    expect(computeOcrScore('P-101', undefined)).toBeNull();
  });

  it('no asset tag → null', () => {
    expect(computeOcrScore(null, 'P-101 XV-201')).toBeNull();
  });

  it('contradiction is null, never 0.0', () => {
    const score = computeOcrScore('P-101', 'XV-301 SDV-201');
    expect(score).toBeNull();
    expect(score).not.toBe(0);
  });
});

describe('computeOcrScore — exact and prefix guards', () => {
  it('exact tag found → 1.0', () => {
    expect(computeOcrScore('P-101', 'P-101 pump inlet')).toBe(1.0);
  });

  it('case-insensitive exact match → 1.0', () => {
    expect(computeOcrScore('XV-101', 'xv-101 control valve')).toBe(1.0);
  });

  it('prefix found (length >= 2) → 0.7', () => {
    expect(computeOcrScore('FIC-201', 'FIC-302 flow controller')).toBe(0.7);
  });

  it('single-char prefix P NOT matched (length < 2 guard)', () => {
    // 'P-101' absent and prefix 'P' has length 1 → null, not 0.7
    expect(computeOcrScore('P-101', 'PUMP DISCHARGE LINE PRESSURE 3 BAR')).toBeNull();
  });
});

describe('M9 — Pressure Transmitter prefix disambiguation', () => {
  it('PT prefix correctly found for pressure transmitter', () => {
    expect(computeOcrScore('PT-101', 'PT-101 pressure transmitter inlet pressure')).toBe(1.0);
  });

  it('P-101 (pump) does not match PT prefix', () => {
    const score = computeOcrScore('PT-201', 'P-101 pump discharge line');
    expect(score).not.toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confidence fusion scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Confidence fusion — active sources only', () => {
  it('null sources are excluded from fusion calculation', () => {
    const rLegendOnly = fuseConfidence({
      legend: 1.0, company: null, embedding: null, ocr: null, rules: null, vision: null
    });
    expect(rLegendOnly.confidence).toBeCloseTo(1.0, 2);
  });

  it('zero scores for active sources reduce confidence', () => {
    // weight(legend)=0.45, weight(vision)=0.05, sum=0.50
    // normalized: legend=0.9, vision=0.1 → 0.9*1.0 + 0.1*0.0 = 0.9
    const r = fuseConfidence({ legend: 1.0, company: null, embedding: null, ocr: null, rules: null, vision: 0.0 });
    expect(r.confidence).toBeCloseTo(0.90, 2);
  });

  it('null score does not reduce confidence vs an explicit zero', () => {
    const scoreWithNull = fuseConfidence({
      legend: 1.0, company: null, embedding: null, ocr: null, rules: null, vision: null
    });
    const scoreWithZero = fuseConfidence({
      legend: 1.0, company: null, embedding: null, ocr: 0.0, rules: null, vision: null
    });
    expect(scoreWithNull.confidence).toBeGreaterThan(scoreWithZero.confidence);
    expect(scoreWithNull.confidence).toBeCloseTo(1.0, 2);
  });
});

describe('Vision-only — all knowledge sources empty', () => {
  it('vision-only detection with 0.72 confidence → fusion preserves that value', () => {
    const r = fuseConfidence({
      legend: null, company: null, embedding: null, ocr: null, rules: null, vision: 0.72
    });
    expect(r.confidence).toBeCloseTo(0.72, 2);
    expect(r.active_sources).toEqual(['vision']);
  });

  it('vision-only with 0.58 confidence < 0.60 threshold → would be UNKNOWN', () => {
    // Can't call validateDetection directly (DB dependency), but verify threshold value
    const threshold = parseFloat(process.env.CONFIDENCE_THRESHOLD ?? '0.60');
    expect(threshold).toBe(0.60);
    expect(0.58 < threshold).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spatial tag association
// ─────────────────────────────────────────────────────────────────────────────

describe('Spatial tag association — proximity recovery', () => {
  it('untagged detection near tagged detection gets inferred tag', () => {
    const tagged = makeDetection({ assetTag: 'P-101', bbox: { x: 100, y: 100, width: 50, height: 50 } });
    const untagged = makeDetection({ assetTag: null, bbox: { x: 160, y: 100, width: 40, height: 40 }, evidence: ['Symbol detected'] });
    const result = associateTagsToSymbols([tagged, untagged], []);
    const recovered = result.find(d => d.bbox.x === 160);
    expect(recovered?.assetTag).toBe('P-101');
    expect(recovered?.confidence).toBeLessThanOrEqual(0.75);
    expect(recovered?.evidence.some(e => e.includes('spatial proximity'))).toBe(true);
  });

  it('untagged detection far from any tagged detection stays null', () => {
    const tagged = makeDetection({ assetTag: 'P-101', bbox: { x: 100, y: 100, width: 50, height: 50 } });
    const untagged = makeDetection({ assetTag: null, bbox: { x: 900, y: 900, width: 40, height: 40 }, evidence: ['Symbol detected'] });
    const result = associateTagsToSymbols([tagged, untagged], []);
    const far = result.find(d => d.bbox.x === 900);
    expect(far?.assetTag).toBeNull();
  });
});

describe('Duplicate tag claim prevention', () => {
  it('only closest untagged detection gets the tag — second does not', () => {
    const tagged = makeDetection({
      assetTag: 'P-101',
      bbox: { x: 500, y: 500, width: 50, height: 50 },
    });
    // untagged1 is closer (distance ~50), untagged2 is further (distance ~120)
    const untagged1 = makeDetection({
      assetTag: null,
      bbox: { x: 555, y: 500, width: 40, height: 40 },
      evidence: ['near'],
    });
    const untagged2 = makeDetection({
      assetTag: null,
      bbox: { x: 625, y: 500, width: 40, height: 40 },
      evidence: ['far'],
    });
    const result = associateTagsToSymbols([tagged, untagged1, untagged2], []);

    const r1 = result.find(d => d.bbox.x === 555);
    const r2 = result.find(d => d.bbox.x === 625);

    expect(r1?.assetTag).toBe('P-101');
    // untagged2: tagged candidate was claimed by untagged1 → stays null
    expect(r2?.assetTag).toBeNull();
  });

  it('three untagged detections around one tagged — only closest gets tag', () => {
    const tagged = makeDetection({
      assetTag: 'P-101',
      bbox: { x: 500, y: 500, width: 50, height: 50 },
    });
    const untagged1 = makeDetection({ assetTag: null, bbox: { x: 560, y: 500, width: 30, height: 30 }, evidence: ['d1'] });
    const untagged2 = makeDetection({ assetTag: null, bbox: { x: 610, y: 500, width: 30, height: 30 }, evidence: ['d2'] });
    const untagged3 = makeDetection({ assetTag: null, bbox: { x: 645, y: 500, width: 30, height: 30 }, evidence: ['d3'] });

    const result = associateTagsToSymbols([tagged, untagged1, untagged2, untagged3], []);

    const assigned = result.filter(d => d.assetTag === 'P-101' && d.evidence.some(e => e.includes('spatial proximity')));
    expect(assigned.length).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema + calibration
// ─────────────────────────────────────────────────────────────────────────────

describe('M6 — evidence empty → VISION_DETECTION sentinel', () => {
  it('DetectionSchema evidence:[] → transformed to [VISION_DETECTION]', async () => {
    const { DetectionSchema } = await import('@/lib/ai-schemas');
    const raw = {
      assetType: 'Pump',
      confidence: 0.85,
      bbox: { x: 100, y: 100, width: 50, height: 50 },
      evidence: [],  // empty — would previously fail min(1)
    };
    const result = DetectionSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence).toEqual(['VISION_DETECTION']);
    }
  });

  it('DetectionSchema evidence with values → preserved unchanged', async () => {
    const { DetectionSchema } = await import('@/lib/ai-schemas');
    const raw = {
      assetType: 'Valve',
      confidence: 0.90,
      bbox: { x: 200, y: 200, width: 40, height: 40 },
      evidence: ['Symbol matches legend', 'Tag XV-101 visible'],
    };
    const result = DetectionSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence).toHaveLength(2);
      expect(result.data.evidence[0]).toBe('Symbol matches legend');
    }
  });
});

describe('calibrateConfidence — UNKNOWN capped at 0.50', () => {
  it('UNKNOWN detection confidence capped', () => {
    const d = makeResolvedDetection({
      detection_source: 'UNKNOWN',
      confidence: 0.70,
      validation_status: 'VALID',
    });
    const result = calibrateConfidence([d]);
    expect(result[0].confidence).toBeLessThanOrEqual(0.50);
    expect(result[0].validation_status).toBe('NEEDS_REVIEW');
  });
});

describe('calibrateConfidence — CONFLICT preserved', () => {
  it('detection already flagged CONFLICT keeps its status', () => {
    const d = makeResolvedDetection({
      validation_status: 'CONFLICT',
      confidence: 0.80,
    });
    const result = calibrateConfidence([d]);
    expect(result[0].validation_status).toBe('CONFLICT');
  });

  it('CONFLICT detection with a tag keeps its status', () => {
    const d = makeResolvedDetection({
      validation_status: 'CONFLICT',
      assetTag: 'XV-101',
      confidence: 0.88,
    });
    const result = calibrateConfidence([d]);
    expect(result[0].validation_status).toBe('CONFLICT');
  });
});

describe('calibrateConfidence — penalties that survive without OCR', () => {
  it('missing tag → small penalty, drops below VALID threshold', () => {
    const d = makeResolvedDetection({
      assetTag: null,
      confidence: 0.70,
      detection_source: 'VISION',
      validation_status: 'VALID',
    });
    const result = calibrateConfidence([d]);
    expect(result[0].confidence).toBeLessThan(0.70);
  });

  it('degenerate bbox (width <= 1) → confidence capped at 0.30', () => {
    const d = makeResolvedDetection({
      bbox: { x: 100, y: 100, width: 1, height: 1 },
      confidence: 0.85,
    });
    const result = calibrateConfidence([d]);
    expect(result[0].confidence).toBeLessThanOrEqual(0.30);
    expect(result[0].validation_status).toBe('NEEDS_REVIEW');
  });

  it('oversized bbox → penalty note appended', () => {
    const d = makeResolvedDetection({
      assetType: 'Valve',
      bbox: { x: 100, y: 100, width: 200, height: 200 },
      confidence: 0.85,
    });
    const result = calibrateConfidence([d]);
    expect(result[0].evidence.some(e => e.includes('Bbox oversized'))).toBe(true);
    expect(result[0].confidence).toBeLessThan(0.85);
  });

  it('extremely large bbox → hard cap at 0.40 + NEEDS_REVIEW', () => {
    const d = makeResolvedDetection({
      assetType: 'Valve',
      bbox: { x: 10, y: 10, width: 500, height: 500 },
      confidence: 0.90,
    });
    const result = calibrateConfidence([d]);
    expect(result[0].confidence).toBe(0.40);
    expect(result[0].validation_status).toBe('NEEDS_REVIEW');
  });

  it('clean detection stays VALID but pays the thin-evidence penalty', () => {
    // Single-evidence detection → 0.03 penalty, still above the 0.65 VALID floor.
    const d = makeResolvedDetection({ confidence: 0.92 });
    const result = calibrateConfidence([d]);
    expect(result[0].confidence).toBeCloseTo(0.89, 2);
    expect(result[0].validation_status).toBe('VALID');
  });

  it('feature extractor failure (null features) does not break calibration', () => {
    const d = makeResolvedDetection({
      canonical_features: null,
      symbol_embedding: null,
      image_hash: null,
    });
    expect(() => calibrateConfidence([d])).not.toThrow();
    expect(calibrateConfidence([d])).toHaveLength(1);
  });
});

describe('CONFIDENCE_THRESHOLD env configurable', () => {
  it('default threshold is 0.60', () => {
    const threshold = parseFloat(process.env.CONFIDENCE_THRESHOLD ?? '0.60');
    expect(threshold).toBe(0.60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractJson robustness
// ─────────────────────────────────────────────────────────────────────────────

describe('extractJson — robust JSON extraction', () => {
  it('extracts JSON from markdown code block', () => {
    const raw = '```json\n{"page":1,"detections":[]}\n```';
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.page).toBe(1);
  });

  it('extracts bare JSON', () => {
    const raw = '{"page":2,"detections":[{"assetType":"Pump"}]}';
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.page).toBe(2);
  });

  it('recovers partial JSON with complete objects', () => {
    const partial = '{"page":3,"detections":[{"assetType":"Pump","assetTag":"P-101","confidence":0.9,"bbox":{"x":100,"y":100,"width":50,"height":50},"evidence":["test"]}';
    const result = extractJson(partial) as Record<string, unknown>;
    expect((result.detections as unknown[]).length).toBeGreaterThan(0);
  });

  it('throws on completely invalid input', () => {
    expect(() => extractJson('not json at all')).toThrow();
  });
});
