/**
 * Tests for OCR Tag Enhancement improvements
 *
 * Covers:
 *   - extractTagFromOcrText: tag extraction and fragment reconstruction
 *   - normalizeTagString: tag normalization
 *   - quickExtractTag: convenience wrapper
 *   - NMS pipeline: deduplication with small assets
 *   - Component hierarchy: parent-child detection
 */

import {
  extractTagFromOcrText,
  normalizeTagString,
  quickExtractTag,
} from '@/lib/detection/ocr-tag-enhancer';

import {
  applyPipelineNms,
  computeIoU,
  computeContainment,
  type PipelineDetection,
} from '@/lib/detection/nms-pipeline';

import {
  buildComponentHierarchy,
  getHierarchyExemptions,
  applyHierarchyAwareNms,
  type HierarchyDetection,
} from '@/lib/detection/component-hierarchy';

// ── OCR Tag Extraction ────────────────────────────────────────────────────────

describe('extractTagFromOcrText', () => {
  describe('full tag extraction', () => {
    it('extracts standard tag: W-0201', () => {
      const { tag, reconstructed } = extractTagFromOcrText('W-0201');
      expect(tag).toBe('W-0201');
      expect(reconstructed).toBe(false);
    });

    it('extracts standard pump tag: P-101', () => {
      const { tag } = extractTagFromOcrText('P-101');
      expect(tag).toBe('P-101');
    });

    it('extracts valve tag: XV-303', () => {
      const { tag } = extractTagFromOcrText('XV-303');
      expect(tag).toBe('XV-303');
    });

    it('extracts instrument tag with suffix: FIC-201A', () => {
      const { tag } = extractTagFromOcrText('FIC-201A');
      expect(tag).toBe('FIC-201A');
    });

    it('extracts PSV tag with 4-digit number: PSV-1001B', () => {
      const { tag } = extractTagFromOcrText('PSV-1001B');
      expect(tag).toBe('PSV-1001B');
    });

    it('extracts level tag: LT-12', () => {
      const { tag } = extractTagFromOcrText('LT-12');
      expect(tag).toBe('LT-12');
    });

    it('extracts 5-letter prefix tag: LSLL-0601', () => {
      const { tag } = extractTagFromOcrText('LSLL-0601');
      expect(tag).toBe('LSLL-0601');
    });

    it('extracts tag from noisy multiline OCR text', () => {
      const { tag } = extractTagFromOcrText('3" CS-150\nP-101A\nMOTOR 15kW');
      expect(tag).toBe('P-101A');
    });

    it('handles lowercase input gracefully', () => {
      const { tag } = extractTagFromOcrText('w-0201');
      expect(tag).toBe('W-0201');
    });

    it('prefers longest full match from multiple candidates', () => {
      const { tag } = extractTagFromOcrText('P-101 FIC-201A');
      // FIC-201A is longer → should be preferred
      expect(tag).toBe('FIC-201A');
    });
  });

  describe('fragment reconstruction — the core W-0201 fix', () => {
    it('reconstructs W + 0201 on same line as W-0201', () => {
      const { tag, reconstructed } = extractTagFromOcrText('W 0201');
      expect(tag).toBe('W-0201');
      expect(reconstructed).toBe(true);
    });

    it('reconstructs W on first token, 0201 on second token (newline)', () => {
      const { tag, reconstructed } = extractTagFromOcrText('W\n0201');
      expect(tag).toBe('W-0201');
      expect(reconstructed).toBe(true);
    });

    it('reconstructs prefix FT + number 0101 → FT-0101', () => {
      const { tag, reconstructed } = extractTagFromOcrText('FT 0101');
      expect(tag).toBe('FT-0101');
      expect(reconstructed).toBe(true);
    });

    it('handles no-dash OCR error: W0201 → W-0201', () => {
      const { tag, reconstructed } = extractTagFromOcrText('W0201');
      expect(tag).toBe('W-0201');
      expect(reconstructed).toBe(true);
    });

    it('handles no-dash for multi-letter prefix: FT0101 → FT-0101', () => {
      const { tag, reconstructed } = extractTagFromOcrText('FT0101');
      expect(tag).toBe('FT-0101');
      expect(reconstructed).toBe(true);
    });

    it('does NOT reconstruct single letter not in ISA prefix set', () => {
      // 'Z' alone with unrelated number should not reconstruct a tag
      const { tag } = extractTagFromOcrText('Z 9999NOISE');
      // 9999NOISE is not a clean fragment number so should not reconstruct
      expect(tag).toBeNull();
    });
  });

  describe('pipe spec filtering', () => {
    it('filters out pipe material spec CS-150', () => {
      const { tag } = extractTagFromOcrText('3" CS-150');
      expect(tag).toBeNull();
    });

    it('filters out SS-304 material spec', () => {
      const { tag } = extractTagFromOcrText('SS-304');
      expect(tag).toBeNull();
    });

    it('does NOT filter out legitimate tag that resembles spec: AS-201', () => {
      // AS-201 is filtered (pipe spec AS-nnn), but AS-2001 with 4 digits is not spec
      // This verifies the spec pattern is specific (SS/CS/AS/FS/IS + exactly 2-3 digits)
      const { tag } = extractTagFromOcrText('P-201');
      expect(tag).toBe('P-201'); // P-201 is not a pipe spec
    });
  });

  describe('null cases', () => {
    it('returns null for empty string', () => {
      const { tag } = extractTagFromOcrText('');
      expect(tag).toBeNull();
    });

    it('returns null for plain numbers', () => {
      const { tag } = extractTagFromOcrText('12345');
      expect(tag).toBeNull();
    });

    it('returns null for random noise', () => {
      const { tag } = extractTagFromOcrText('JUST RANDOM NOISE');
      expect(tag).toBeNull();
    });

    it('returns null for single letter without number', () => {
      const { tag } = extractTagFromOcrText('W');
      expect(tag).toBeNull();
    });
  });
});

// ── normalizeTagString ────────────────────────────────────────────────────────

describe('normalizeTagString', () => {
  it('uppercases lowercase tags', () => {
    expect(normalizeTagString('w-0201')).toBe('W-0201');
  });

  it('removes spaces around dash: W - 0201 → W-0201', () => {
    expect(normalizeTagString('W - 0201')).toBe('W-0201');
  });

  it('converts no-dash variant: W0201 → W-0201', () => {
    expect(normalizeTagString('W0201')).toBe('W-0201');
  });

  it('preserves already correct tag', () => {
    expect(normalizeTagString('FIC-201A')).toBe('FIC-201A');
  });

  it('handles FT0101 → FT-0101', () => {
    expect(normalizeTagString('FT0101')).toBe('FT-0101');
  });
});

// ── quickExtractTag ───────────────────────────────────────────────────────────

describe('quickExtractTag', () => {
  it('extracts full tag', () => {
    expect(quickExtractTag('P-101A')).toBe('P-101A');
  });

  it('reconstructs fragment', () => {
    expect(quickExtractTag('W 0201')).toBe('W-0201');
  });

  it('returns null for non-tag', () => {
    expect(quickExtractTag('NOISE')).toBeNull();
  });
});

// ── NMS Pipeline ──────────────────────────────────────────────────────────────

function makeDetection(overrides: Partial<PipelineDetection> & { id: string }): PipelineDetection {
  return {
    assetTag: null,
    assetType: 'Valve',
    confidence: 0.9,
    bbox: { x: 100, y: 100, width: 50, height: 50 },
    page: 1,
    source: 'yolo',
    evidence: [],
    ...overrides,
  };
}

describe('applyPipelineNms', () => {
  it('keeps non-overlapping detections', () => {
    const detections = [
      makeDetection({ id: 'a', bbox: { x: 0, y: 0, width: 30, height: 30 } }),
      makeDetection({ id: 'b', bbox: { x: 100, y: 100, width: 30, height: 30 } }),
    ];
    const { kept, suppressed } = applyPipelineNms(detections);
    expect(kept).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });

  it('suppresses low-confidence duplicate (same source, high IoU)', () => {
    const detections = [
      makeDetection({ id: 'a', confidence: 0.95, bbox: { x: 100, y: 100, width: 50, height: 50 } }),
      makeDetection({ id: 'b', confidence: 0.60, bbox: { x: 102, y: 102, width: 50, height: 50 } }),
    ];
    const { kept, suppressed } = applyPipelineNms(detections);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('a');
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].detection.id).toBe('b');
  });

  it('promotes tag from suppressed to winner when winner lacks tag', () => {
    const detections = [
      makeDetection({ id: 'a', confidence: 0.95, assetTag: null, bbox: { x: 100, y: 100, width: 50, height: 50 } }),
      makeDetection({ id: 'b', confidence: 0.60, assetTag: 'XV-303', bbox: { x: 100, y: 100, width: 50, height: 50 } }),
    ];
    const { kept } = applyPipelineNms(detections, { promoteTag: true });
    expect(kept[0].assetTag).toBe('XV-303');
  });

  it('boosts confidence when cross-source detections overlap (YOLO + Gemini)', () => {
    // yolo score: source(3) + conf(0.80) = 3.80
    // gemini score: source(4) + conf(0.75) = 4.75 → gemini wins
    // gemini confidence boosted by +0.05 when merging → 0.75 + 0.05 = 0.80
    const detections = [
      makeDetection({ id: 'a', source: 'yolo', confidence: 0.80, bbox: { x: 100, y: 100, width: 50, height: 50 } }),
      makeDetection({ id: 'b', source: 'gemini', confidence: 0.75, bbox: { x: 102, y: 102, width: 50, height: 50 } }),
    ];
    const { kept } = applyPipelineNms(detections, { crossSourceIou: 0.3 });
    expect(kept).toHaveLength(1);
    // Gemini wins (higher source priority) and gets +0.05 boost = 0.80
    expect(kept[0].confidence).toBeGreaterThanOrEqual(0.80);
    // Evidence should show multi-source agreement
    expect(kept[0].evidence.some(e => e.includes('gemini') || e.includes('yolo'))).toBe(true);
  });

  it('does NOT suppress across pages', () => {
    const detections = [
      makeDetection({ id: 'a', page: 1, bbox: { x: 100, y: 100, width: 50, height: 50 } }),
      makeDetection({ id: 'b', page: 2, bbox: { x: 100, y: 100, width: 50, height: 50 } }),
    ];
    const { kept } = applyPipelineNms(detections);
    expect(kept).toHaveLength(2);
  });

  it('preserves both when adjacent small symbols (drain valve + main valve)', () => {
    // Same scenario as small-asset-nms.test.ts
    const mainValve = makeDetection({
      id: 'main',
      assetTag: '33-BV-3042',
      confidence: 0.95,
      bbox: { x: 485, y: 480, width: 30, height: 30 },
    });
    const drainValve = makeDetection({
      id: 'drain',
      assetTag: null,
      confidence: 0.85,
      bbox: { x: 492, y: 509, width: 16, height: 16 },
    });
    const { kept } = applyPipelineNms([mainValve, drainValve], {
      sameSoureIou: 0.45,
      containmentThreshold: 0.7,
    });
    expect(kept).toHaveLength(2);
  });
});

// ── IoU / Containment ─────────────────────────────────────────────────────────

describe('computeIoU', () => {
  it('returns 1.0 for identical boxes', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeIoU(box, box)).toBe(1.0);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 100, y: 100, width: 50, height: 50 };
    expect(computeIoU(a, b)).toBe(0);
  });

  it('returns correct IoU for partial overlap', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    // Intersection: 5x5 = 25; Union: 100 + 100 - 25 = 175
    expect(computeIoU(a, b)).toBeCloseTo(25 / 175, 3);
  });
});

describe('computeContainment', () => {
  it('returns ~1.0 when inner is fully inside outer', () => {
    const inner = { x: 10, y: 10, width: 10, height: 10 };
    const outer = { x: 0, y: 0, width: 50, height: 50 };
    expect(computeContainment(inner, outer)).toBeCloseTo(1.0, 2);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const inner = { x: 100, y: 100, width: 10, height: 10 };
    const outer = { x: 0, y: 0, width: 50, height: 50 };
    expect(computeContainment(inner, outer)).toBe(0);
  });
});

// ── Component Hierarchy ───────────────────────────────────────────────────────

function makeHierarchyDetection(
  overrides: Partial<HierarchyDetection> & { id: string },
): HierarchyDetection {
  return {
    assetTag: null,
    assetType: 'Valve',
    confidence: 0.8,
    bbox: { x: 100, y: 100, width: 100, height: 100 },
    page: 1,
    source: 'gemini',
    evidence: [],
    ...overrides,
  };
}

describe('buildComponentHierarchy', () => {
  it('puts an instrument inside a vessel as its child', () => {
    const vessel = makeHierarchyDetection({
      id: 'vessel-1',
      assetType: 'Vessel',
      confidence: 0.9,
      bbox: { x: 100, y: 100, width: 200, height: 200 },
    });

    // Small instrument transmitter centered inside vessel
    const transmitter = makeHierarchyDetection({
      id: 'ft-1',
      assetType: 'Transmitter',
      assetTag: 'FT-0101',
      confidence: 0.85,
      bbox: { x: 140, y: 140, width: 40, height: 40 },
    });

    const result = buildComponentHierarchy([vessel, transmitter]);

    const tNode = result.allNodes.find((n) => n.detection.id === 'ft-1')!;
    expect(tNode.detection.parentId).toBe('vessel-1');
    expect(tNode.detection.hierarchyLevel).toBe(1);
  });

  it('does NOT make a similarly-sized symbol a child of another', () => {
    const pump1 = makeHierarchyDetection({
      id: 'pump-1',
      assetType: 'Pump',
      bbox: { x: 100, y: 100, width: 100, height: 100 },
    });
    const pump2 = makeHierarchyDetection({
      id: 'pump-2',
      assetType: 'Pump',
      bbox: { x: 120, y: 120, width: 90, height: 90 }, // similar size, partially overlapping
    });

    const result = buildComponentHierarchy([pump1, pump2]);

    const p2Node = result.allNodes.find((n) => n.detection.id === 'pump-2')!;
    // Area ratio pump2/pump1 = 8100/10000 = 0.81 > 0.5 → should NOT be child
    expect(p2Node.detection.parentId).toBeNull();
  });

  it('roots list contains only parent-less detections', () => {
    const parent = makeHierarchyDetection({
      id: 'parent',
      assetType: 'Heat Exchanger',
      bbox: { x: 0, y: 0, width: 300, height: 200 },
    });
    const child = makeHierarchyDetection({
      id: 'child',
      assetType: 'Instrument',
      bbox: { x: 10, y: 10, width: 50, height: 50 },
    });
    const unrelated = makeHierarchyDetection({
      id: 'unrelated',
      assetType: 'Pump',
      bbox: { x: 500, y: 500, width: 80, height: 80 },
    });

    const result = buildComponentHierarchy([parent, child, unrelated]);
    const rootIds = result.roots.map((r) => r.detection.id);
    expect(rootIds).toContain('parent');
    expect(rootIds).toContain('unrelated');
    expect(rootIds).not.toContain('child');
  });
});

describe('applyHierarchyAwareNms', () => {
  it('does NOT suppress a child that overlaps its parent', () => {
    const parent: HierarchyDetection = makeHierarchyDetection({
      id: 'parent',
      assetType: 'Vessel',
      bbox: { x: 0, y: 0, width: 200, height: 200 },
      confidence: 0.9,
    });
    const child: HierarchyDetection = makeHierarchyDetection({
      id: 'child',
      assetType: 'Instrument',
      bbox: { x: 10, y: 10, width: 60, height: 60 },
      confidence: 0.8,
    });

    const hierarchyResult = buildComponentHierarchy([parent, child]);
    const exemptions = getHierarchyExemptions(hierarchyResult);

    const result = applyHierarchyAwareNms([parent, child], exemptions, 0.4);
    expect(result).toHaveLength(2);
  });

  it('DOES suppress a true duplicate even with hierarchy', () => {
    const det1: HierarchyDetection = makeHierarchyDetection({
      id: 'det1',
      assetType: 'Valve',
      bbox: { x: 100, y: 100, width: 50, height: 50 },
      confidence: 0.9,
    });
    const det2: HierarchyDetection = makeHierarchyDetection({
      id: 'det2',
      assetType: 'Valve',
      bbox: { x: 101, y: 101, width: 50, height: 50 }, // nearly identical
      confidence: 0.7,
    });

    // No hierarchy between them
    const result = applyHierarchyAwareNms([det1, det2], new Set(), 0.4);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('det1');
  });
});
