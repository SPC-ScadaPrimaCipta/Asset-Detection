import { PageDetectionSchema, DetectionSchema, BBoxSchema } from '@/lib/ai-schemas';

describe('BBoxSchema', () => {
  it('accepts valid bbox', () => {
    const r = BBoxSchema.safeParse({ x: 100, y: 200, width: 50, height: 60 });
    expect(r.success).toBe(true);
  });

  it('rejects negative coordinates', () => {
    expect(BBoxSchema.safeParse({ x: -1, y: 0, width: 50, height: 60 }).success).toBe(false);
    expect(BBoxSchema.safeParse({ x: 0, y: -1, width: 50, height: 60 }).success).toBe(false);
  });

  it('M6: BBox width/height=0 coerced to min 1 (not rejected)', () => {
    // BBoxSchema uses transform(v => Math.max(1, Math.round(v))) — zero becomes 1, not error.
    // calibrateConfidence catches degenerate bbox (width<=1) separately and caps confidence.
    const r1 = BBoxSchema.safeParse({ x: 0, y: 0, width: 0, height: 60 });
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.width).toBe(1);
    const r2 = BBoxSchema.safeParse({ x: 0, y: 0, width: 50, height: 0 });
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data.height).toBe(1);
  });
});

describe('DetectionSchema', () => {
  const validDetection = {
    assetType: 'Pump',
    assetTag: 'P-101',
    confidence: 0.95,
    bbox: { x: 100, y: 200, width: 50, height: 60 },
    evidence: ['Symbol matches Legend Pump entry'],
  };

  it('accepts valid detection', () => {
    const r = DetectionSchema.safeParse(validDetection);
    expect(r.success).toBe(true);
  });

  it('defaults null optional fields', () => {
    const r = DetectionSchema.safeParse(validDetection);
    expect(r.success && r.data.description).toBeNull();
    expect(r.success && r.data.assetTag).toBe('P-101');
  });

  it('rejects confidence > 1', () => {
    const r = DetectionSchema.safeParse({ ...validDetection, confidence: 1.1 });
    expect(r.success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    const r = DetectionSchema.safeParse({ ...validDetection, confidence: -0.1 });
    expect(r.success).toBe(false);
  });

  it('M6: empty evidence accepted and transformed to VISION_DETECTION sentinel', () => {
    // M6 fix: evidence:[] no longer kills the detection (was min(1)).
    // Empty array → transformed to ['VISION_DETECTION'] so detection enters pipeline.
    const r = DetectionSchema.safeParse({ ...validDetection, evidence: [] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.evidence).toEqual(['VISION_DETECTION']);
    }
  });

  it('rejects empty assetType', () => {
    const r = DetectionSchema.safeParse({ ...validDetection, assetType: '' });
    expect(r.success).toBe(false);
  });
});

describe('PageDetectionSchema', () => {
  it('accepts valid page detection', () => {
    const r = PageDetectionSchema.safeParse({
      page: 1,
      detections: [
        {
          assetType: 'Vessel',
          assetTag: 'V-201',
          confidence: 0.88,
          bbox: { x: 300, y: 400, width: 80, height: 100 },
          evidence: ['Vessel symbol from legend'],
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.detections).toHaveLength(1);
  });

  it('accepts empty detections array', () => {
    const r = PageDetectionSchema.safeParse({ page: 1, detections: [] });
    expect(r.success).toBe(true);
  });

  it('rejects page < 1', () => {
    const r = PageDetectionSchema.safeParse({ page: 0, detections: [] });
    expect(r.success).toBe(false);
  });

  it('rejects invalid detection inside array', () => {
    const r = PageDetectionSchema.safeParse({
      page: 1,
      detections: [{ assetType: '', confidence: 0.9, bbox: { x: 0, y: 0, width: 10, height: 10 }, evidence: ['x'] }],
    });
    expect(r.success).toBe(false);
  });

  it('strips malformed AI output fields via schema', () => {
    // Extra unknown fields should be stripped by Zod (strip mode default)
    const r = PageDetectionSchema.safeParse({
      page: 2,
      detections: [],
      extraGarbage: 'ignored',
    });
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).extraGarbage).toBeUndefined();
  });
});
