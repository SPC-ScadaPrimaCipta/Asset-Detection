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

  it('rejects zero width/height', () => {
    expect(BBoxSchema.safeParse({ x: 0, y: 0, width: 0, height: 60 }).success).toBe(false);
    expect(BBoxSchema.safeParse({ x: 0, y: 0, width: 50, height: 0 }).success).toBe(false);
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

  it('rejects empty evidence', () => {
    const r = DetectionSchema.safeParse({ ...validDetection, evidence: [] });
    expect(r.success).toBe(false);
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
