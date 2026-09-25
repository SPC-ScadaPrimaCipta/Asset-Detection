/**
 * Stage 1 tests: OLD definitions stay valid; NEW box roles stay separate;
 * Asset Type still comes from Legend Description; no tags are created here.
 */
import {
  coerceLegendDefinition,
  normalizeLegendLabel,
  summarizeLegendDefinitions,
  type LegendDefinition,
} from '@/lib/detection/legend/legend-model';
import {
  CANONICAL_HU_COUNT,
  CANONICAL_NORM_SIZE,
  fromDetectionQuery,
  fromLegendVariant,
  isCompatibleShape,
} from '@/lib/detection/geometry/canonical-vision';

const OLD_DEF = {
  legendId: '74cc1ce2-c322-406e-a4fc-6f5aa3526c56',
  symbolId: 'actuated-gate-valve-001',
  label: 'ACTUATED GATE VALVE',
  aliases: [],
  category: '',
  bbox: { x: 0, y: 0, width: 209, height: 60 },
  geometry: { aspectRatio: 3.48, relativeArea: 0.001, width: 209, height: 60 },
  visualFeatures: {
    huMoments: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    edgeDensity: 0.11,
    lineCount: 4,
    componentCount: 2,
    contourCount: 3,
    templateSize: [128, 128],
  },
  variants: [],
  sourcePage: 1,
  rotationInvariant: false,
  provenance: ['reference-crop:human-reviewed'],
  version: 'legend-v1',
} satisfies Partial<LegendDefinition>;

describe('backward compatibility (OLD without new fields)', () => {
  it('does not throw and keeps the label verbatim', () => {
    const def = coerceLegendDefinition(OLD_DEF);
    expect(def.label).toBe('ACTUATED GATE VALVE');
    expect(def.normalizedLabel).toBe('actuated gate valve');
    expect(def.symbolId).toBe('actuated-gate-valve-001');
  });

  it('preserves existing status default behavior', () => {
    expect(coerceLegendDefinition(OLD_DEF).status).toBe('validated');
    expect(coerceLegendDefinition({ ...OLD_DEF, label: '' }).status).toBe('rejected');
  });

  it('new optional fields default to absent, not fabricated', () => {
    const def = coerceLegendDefinition(OLD_DEF);
    expect(def.rowBBox ?? null).toBeNull();
    expect(def.referenceBBox ?? null).toBeNull();
    expect(def.versions).toBeUndefined();
    // classId falls back exactly as before (symbolId), no grouping invented.
    expect(def.classId).toBe('actuated-gate-valve-001');
  });

  it('summarize still counts the old set', () => {
    const s = summarizeLegendDefinitions([OLD_DEF, { ...OLD_DEF, symbolId: 'x2' }]);
    expect(s.uniqueClasses).toBe(1);
    expect(s.duplicateReferences).toBe(1);
  });
});

describe('separate box roles (row/reference/symbol/text)', () => {
  const NEW_DEF = {
    ...OLD_DEF,
    rowBBox: { x: 0, y: 0, width: 640, height: 60 },
    referenceBBox: { x: 0, y: 0, width: 420, height: 60 },
    source: { pageNumber: 1, bbox: { x: 0, y: 0, width: 420, height: 60 } },
    symbol: {
      bbox: { x: 8, y: 6, width: 190, height: 48 },
      center: { x: 103, y: 30 },
    },
    text: {
      value: 'ACTUATED GATE VALVE',
      normalizedValue: 'actuated gate valve',
      bbox: { x: 220, y: 10, width: 380, height: 40 },
      confidence: 0.97,
    },
  };

  it('never collapses distinct boxes into one', () => {
    const def = coerceLegendDefinition(NEW_DEF);
    expect(def.symbol?.bbox).toEqual({ x: 8, y: 6, width: 190, height: 48 });
    expect(def.text?.bbox).toEqual({ x: 220, y: 10, width: 380, height: 40 });
    expect(def.source?.bbox).toEqual({ x: 0, y: 0, width: 420, height: 60 });
    expect(def.rowBBox).toEqual({ x: 0, y: 0, width: 640, height: 60 });
    expect(def.referenceBBox).toEqual({ x: 0, y: 0, width: 420, height: 60 });
  });

  it('falls back per-role only when that role box is invalid', () => {
    const def = coerceLegendDefinition({
      ...OLD_DEF,
      symbol: { bbox: { x: 0, y: 0, width: 0, height: 0 } },
    });
    // Invalid symbol box → falls back to shared box; valid roles untouched.
    expect(def.symbol?.bbox).toEqual({ x: 0, y: 0, width: 209, height: 60 });
  });

  it('Asset Type still derives from Legend Description only', () => {
    const def = coerceLegendDefinition(NEW_DEF);
    expect(def.label).toBe('ACTUATED GATE VALVE');
    expect(normalizeLegendLabel(def.label)).toBe('actuated gate valve');
    expect(def).not.toHaveProperty('assetTag');
  });
});

describe('classId passthrough (no grouping in Stage 1)', () => {
  it('keeps an explicitly provided classId', () => {
    const def = coerceLegendDefinition({ ...OLD_DEF, classId: 'gate-valve' });
    expect(def.classId).toBe('gate-valve');
  });
});

describe('CanonicalVisionObject adapter (type-only, no new extraction)', () => {
  const variant = {
    bbox: { x: 0, y: 0, width: 209, height: 60 },
    huMoments: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    edgeDensity: 0.11,
    lineCount: 4,
    aspectRatio: 3.48,
  };

  it('converts a legend variant without inventing a label or tag', () => {
    const obj = fromLegendVariant(variant, {
      kind: 'legend',
      legendId: '74cc',
      symbolId: 's1',
    });
    expect(obj.normSize).toBe(CANONICAL_NORM_SIZE);
    expect(obj.huMoments).toHaveLength(CANONICAL_HU_COUNT);
    expect(obj).not.toHaveProperty('label');
    expect(obj).not.toHaveProperty('assetTag');
  });

  it('converts a detection query to the identical shape', () => {
    const a = fromLegendVariant(variant);
    const b = fromDetectionQuery({ ...variant });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(isCompatibleShape(a)).toBe(true);
    expect(isCompatibleShape(b)).toBe(true);
  });

  it('rejects incompatible shapes', () => {
    expect(isCompatibleShape(null)).toBe(false);
    expect(isCompatibleShape({ huMoments: [1, 2] })).toBe(false);
    expect(isCompatibleShape({ ...variant, huMoments: [] })).toBe(false);
  });
});
