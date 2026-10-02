/**
 * P2 — sanitizePageJson: Gemini output sanitization before Zod validation.
 * One malformed detection must not fail the entire page.
 */
import { sanitizePageJson } from '@/lib/ai-agent';

describe('sanitizePageJson', () => {
  it('keeps valid detections unchanged', () => {
    const r = sanitizePageJson({
      page: 1,
      detections: [{
        assetType: 'Pump',
        assetTag: 'P-101',
        confidence: 0.9,
        bbox: { x: 100, y: 100, width: 50, height: 50 },
        evidence: ['ok'],
      }],
    }, 1);
    expect(r.page).toBe(1);
    expect(r.detections).toHaveLength(1);
    expect((r.detections[0] as Record<string, unknown>).confidence).toBe(0.9);
  });

  it('drops detections with missing bbox numbers, keeps the rest', () => {
    const r = sanitizePageJson({
      page: 2,
      detections: [
        { assetType: 'Pump', confidence: 0.9, bbox: { x: 1, y: 2, width: undefined, height: 4 }, evidence: [] },
        { assetType: 'Valve', confidence: 0.8, bbox: { x: 10, y: 10, width: 20, height: 20 }, evidence: [] },
      ],
    }, 2);
    expect(r.detections).toHaveLength(1);
    expect((r.detections[0] as Record<string, unknown>).assetType).toBe('Valve');
  });

  it('defaults missing confidence to 0.5', () => {
    const r = sanitizePageJson({
      detections: [{
        assetType: 'Tank', bbox: { x: 0, y: 0, width: 30, height: 30 }, evidence: [],
      }],
    }, 3);
    expect(r.page).toBe(3);
    expect((r.detections[0] as Record<string, unknown>).confidence).toBe(0.5);
  });

  it('drops missing assetType and non-object items', () => {
    const r = sanitizePageJson({
      page: 1,
      detections: [
        null,
        { confidence: 0.9, bbox: { x: 1, y: 1, width: 5, height: 5 } },
        { assetType: '  ', confidence: 0.9, bbox: { x: 1, y: 1, width: 5, height: 5 } },
      ],
    }, 1);
    expect(r.detections).toHaveLength(0);
  });

  it('normalizes non-array evidence to []', () => {
    const r = sanitizePageJson({
      page: 1,
      detections: [{
        assetType: 'Fan', confidence: 0.7,
        bbox: { x: 1, y: 1, width: 5, height: 5 }, evidence: 'oops',
      }],
    }, 1);
    expect((r.detections[0] as Record<string, unknown>).evidence).toEqual([]);
  });
});
