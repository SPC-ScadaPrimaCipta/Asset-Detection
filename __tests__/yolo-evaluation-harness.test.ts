import { bboxIou, computeMetrics, matchPage } from '@/lib/detection/eval/matcher';
import type { GroundTruthPage } from '@/lib/detection/eval/types';
import type { YoloDetection } from '@/lib/detection/yolo/yolo-decoder';

describe('YOLO Evaluation Harness — Matcher & Metrics', () => {
  it('computes exact box IoU in source pixel space', () => {
    const a = { x: 100, y: 100, width: 100, height: 100 };
    const b = { x: 150, y: 100, width: 100, height: 100 };
    // Intersection: 50x100 = 5000, Union: 10000 + 10000 - 5000 = 15000 -> IoU = 1/3
    expect(bboxIou(a, b)).toBeCloseTo(1 / 3, 4);

    // No overlap
    const c = { x: 300, y: 300, width: 100, height: 100 };
    expect(bboxIou(a, c)).toBe(0);

    // Identical
    expect(bboxIou(a, a)).toBe(1.0);
  });

  it('computes precision, recall, and F1 correctly', () => {
    // 8 TP, 2 FP, 4 FN
    // Precision = 8 / 10 = 0.80
    // Recall = 8 / 12 = 0.6667
    // F1 = 2 * 0.8 * 0.6667 / (0.8 + 0.6667) ≈ 0.7273
    const m = computeMetrics(8, 2, 4);
    expect(m.precision).toBeCloseTo(0.8, 4);
    expect(m.recall).toBeCloseTo(8 / 12, 4);
    expect(m.f1).toBeCloseTo((2 * 0.8 * (8 / 12)) / (0.8 + 8 / 12), 4);
  });

  it('handles zero divisions gracefully (returns 0 for empty TP/FP/FN)', () => {
    const empty = computeMetrics(0, 0, 0);
    expect(empty.precision).toBe(0);
    expect(empty.recall).toBe(0);
    expect(empty.f1).toBe(0);
  });

  it('matches exact class with IoU >= threshold as TP', () => {
    const page: GroundTruthPage = {
      pageId: 'page-1',
      imagePath: 'dummy.png',
      width: 1000,
      height: 1000,
      annotations: [
        {
          id: 'gt-1',
          classId: 1, // Gate_Valve
          label: 'Gate_Valve',
          bbox: { x: 100, y: 100, width: 50, height: 50 },
        },
      ],
    };

    const detections: YoloDetection[] = [
      {
        bbox: { x: 100, y: 100, width: 50, height: 50 },
        pixelBox: { x1: 100, y1: 100, x2: 150, y2: 150 },
        confidence: 0.85,
        rawClassId: 1,
        rawLabel: 'Gate_Valve',
        canonicalClassId: 1,
        canonicalLabel: 'Gate_Valve',
        assetType: 'Valve',
        wasDuplicate: false,
      },
    ];

    const res = matchPage(page, detections, 0.5, 0.5);
    expect(res.matches.length).toBe(1);
    expect(res.falsePositives.length).toBe(0);
    expect(res.falseNegatives.length).toBe(0);
    expect(res.matches[0].gtId).toBe('gt-1');
    expect(res.matches[0].iou).toBe(1.0);
  });

  it('records class confusion when IoU >= 0.50 but class is different', () => {
    const page: GroundTruthPage = {
      pageId: 'page-1',
      imagePath: 'dummy.png',
      width: 1000,
      height: 1000,
      annotations: [
        {
          id: 'gt-valve',
          classId: 1, // Gate_Valve
          label: 'Gate_Valve',
          bbox: { x: 100, y: 100, width: 50, height: 50 },
        },
      ],
    };

    const detections: YoloDetection[] = [
      {
        bbox: { x: 100, y: 100, width: 50, height: 50 },
        pixelBox: { x1: 100, y1: 100, x2: 150, y2: 150 },
        confidence: 0.85,
        rawClassId: 22, // Rupture_disk (wrong class!)
        rawLabel: 'Rupture_disk',
        canonicalClassId: 22,
        canonicalLabel: 'Rupture_disk',
        assetType: 'Rupture Disk',
        wasDuplicate: false,
      },
    ];

    const res = matchPage(page, detections, 0.5, 0.5);
    expect(res.matches.length).toBe(0);
    expect(res.falsePositives.length).toBe(1);
    expect(res.falseNegatives.length).toBe(1);
    expect(res.confusions.length).toBe(1);
    expect(res.confusions[0].gtClassId).toBe(1);
    expect(res.confusions[0].predictedClassId).toBe(22);
  });

  it('suppresses duplicate detections on the same GT symbol (highest confidence wins)', () => {
    const page: GroundTruthPage = {
      pageId: 'page-1',
      imagePath: 'dummy.png',
      width: 1000,
      height: 1000,
      annotations: [
        {
          id: 'gt-1',
          classId: 1,
          label: 'Gate_Valve',
          bbox: { x: 100, y: 100, width: 50, height: 50 },
        },
      ],
    };

    const detections: YoloDetection[] = [
      {
        bbox: { x: 100, y: 100, width: 50, height: 50 },
        pixelBox: { x1: 100, y1: 100, x2: 150, y2: 150 },
        confidence: 0.90,
        rawClassId: 1,
        rawLabel: 'Gate_Valve',
        canonicalClassId: 1,
        canonicalLabel: 'Gate_Valve',
        assetType: 'Valve',
        wasDuplicate: false,
      },
      {
        bbox: { x: 105, y: 105, width: 45, height: 45 },
        pixelBox: { x1: 105, y1: 105, x2: 150, y2: 150 },
        confidence: 0.60,
        rawClassId: 1,
        rawLabel: 'Gate_Valve',
        canonicalClassId: 1,
        canonicalLabel: 'Gate_Valve',
        assetType: 'Valve',
        wasDuplicate: false,
      },
    ];

    const res = matchPage(page, detections, 0.5, 0.5);
    expect(res.matches.length).toBe(1);
    expect(res.matches[0].confidence).toBe(0.9);
    expect(res.falsePositives.length).toBe(1); // 0.60 detection is duplicate -> FP
    expect(res.falseNegatives.length).toBe(0);
  });
});
