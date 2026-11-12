import { applyNMS } from '@/lib/spatial';

describe('applyNMS with closely-spaced and small assets', () => {
  it('does NOT suppress a small drain valve located near a main block valve', () => {
    // Main 2" valve: center (500, 495), size 30x30
    const mainValve = {
      assetType: 'Ball Valve',
      assetTag: '33-BV-3042',
      confidence: 0.95,
      bbox: { x: 485, y: 480, width: 30, height: 30 },
    };

    // Small 3/4" drain valve on vertical drop leg: center (500, 517), size 16x16
    // Center distance = 22 units, slight vertical touch/overlap with pipe line
    const drainValve = {
      assetType: 'Gate Valve',
      assetTag: null,
      confidence: 0.85,
      bbox: { x: 492, y: 509, width: 16, height: 16 },
    };

    const result = applyNMS([mainValve, drainValve], 0.4);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.assetTag)).toContain('33-BV-3042');
    expect(result.map(r => r.assetTag)).toContain(null);
  });

  it('does NOT suppress closely adjacent valves even if both have Valve type and are only 9 units apart', () => {
    // Valve 1 (upper block valve): center (500, 500), 20x20
    const valve1 = {
      assetType: 'Valve',
      assetTag: 'BV-101',
      confidence: 0.90,
      bbox: { x: 490, y: 490, width: 20, height: 20 },
    };

    // Valve 2 (adjacent drain valve): center (500, 509), 12x12
    // Bbox touches [494, 503, 12, 12], center dist = 9, containment < 0.80
    const valve2 = {
      assetType: 'Valve',
      assetTag: null,
      confidence: 0.80,
      bbox: { x: 494, y: 503, width: 12, height: 12 },
    };

    const result = applyNMS([valve1, valve2], 0.4);
    expect(result).toHaveLength(2);
  });

  it('still suppresses true duplicate detections of the same physical symbol', () => {
    // Detector A: center (500, 500), 24x24
    const detA = {
      assetType: 'Valve',
      assetTag: 'BV-101',
      confidence: 0.95,
      bbox: { x: 488, y: 488, width: 24, height: 24 },
    };

    // Detector B: nearly identical center (501, 501), 24x24, IoU > 0.8
    const detB = {
      assetType: 'Valve',
      assetTag: null,
      confidence: 0.70,
      bbox: { x: 489, y: 489, width: 24, height: 24 },
    };

    const result = applyNMS([detA, detB], 0.4);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.95);
    expect(result[0].assetTag).toBe('BV-101');
  });
});

