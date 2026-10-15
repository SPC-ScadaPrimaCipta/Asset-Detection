/**
 * Vision Lap-2 merge tests (Blok 3.2).
 *
 * Pure function tests — no YOLO/Gemini/DB needed:
 *   1. region-norm → global-norm conversion maps through padded view extents.
 *   2. Same tag + near centers merge (vector wins type when resolved).
 *   3. UNKNOWN vector type upgrades from vision type.
 *   4. Estimated vector box upgrades to vision box.
 *   5. Unmatched/untagged vision becomes REVIEW-leaning candidate.
 */
import {
  regionNormToGlobalNorm,
  mergeVisionDetections,
} from '@/lib/dxf-vision';
import type { DxfDetection } from '@/lib/dxf-detection';

const GLOBAL = { minX: 0, minY: 0, maxX: 100000, maxY: 10000, width: 100000, height: 10000 };
// Region 2 of INTAN-like layout + 1% render padding
const VIEW = { minX: 20000, minY: -100, maxX: 38400, maxY: 10100, width: 18400, height: 10200 };

function vectorDet(over: Partial<DxfDetection> = {}): DxfDetection {
  return {
    assetTag: 'V-0101',
    assetType: 'Vessel',
    description: null,
    confidence: 0.8,
    bbox: { x: 290, y: 500, width: 10, height: 20 },
    evidence: ['Tag from DXF TEXT layer "Level 6": V-0101', 'Bbox from symbol stroke cluster (12 strokes)'],
    blockName: null,
    layer: 'Level 6',
    source: 'TEXT',
    rawPosition: { x: 29000, y: 5000 },
    regionIndex: 1,
    pidPage: 2,
    ...over,
  };
}

describe('regionNormToGlobalNorm', () => {
  it('maps region 0-1000 corners to global space', () => {
    const tl = regionNormToGlobalNorm({ x: 0, y: 0, width: 10, height: 10 }, VIEW, GLOBAL);
    // world TL = (20000, 10100) → global x=200, y=(10000-10100)/10000*1000 → clamped 0
    expect(tl.x).toBe(200);
    expect(tl.y).toBe(0);
    const center = regionNormToGlobalNorm({ x: 495, y: 495, width: 10, height: 10 }, VIEW, GLOBAL);
    // world ≈ (29108, 5051) → global ≈ (291, 495)
    expect(center.x).toBeGreaterThanOrEqual(290);
    expect(center.x).toBeLessThanOrEqual(292);
    expect(center.y).toBeGreaterThanOrEqual(494);
    expect(center.y).toBeLessThanOrEqual(496);
  });
});

describe('mergeVisionDetections', () => {
  it('merges same tag near centers; vector type wins when resolved', () => {
    const vec = [vectorDet()];
    // Vision box at same world spot: world (29108,5051) → region norm ≈ (495,495)
    const stats = mergeVisionDetections(
      vec,
      [{
        assetTag: 'V-0101', assetType: 'Tank', confidence: 0.9,
        bboxNorm: { x: 490, y: 490, width: 12, height: 12 },
        evidence: ['YOLO GEO-2: vessel (score=0.90)'],
      }],
      VIEW, GLOBAL, 2, 1,
    );
    expect(stats.mergedIntoVector).toBe(1);
    expect(vec.length).toBe(1);
    expect(vec[0].assetType).toBe('Vessel'); // vector resolved wins, not Tank
    expect(vec[0].evidence.some((e) => e.includes('YOLO'))).toBe(true);
  });

  it('upgrades UNKNOWN vector type from vision', () => {
    const vec = [vectorDet({ assetType: 'UNKNOWN', needsGeminiClassification: true })];
    mergeVisionDetections(
      vec,
      [{
        assetTag: 'V-0101', assetType: 'Vessel', confidence: 0.85,
        bboxNorm: { x: 490, y: 490, width: 12, height: 12 },
        evidence: ['Rule: ISO → Vessel'],
      }],
      VIEW, GLOBAL, 2, 1,
    );
    expect(vec[0].assetType).toBe('Vessel');
  });

  it('upgrades estimated vector box to vision box', () => {
    const vec = [vectorDet({
      bbox: { x: 100, y: 100, width: 50, height: 50 },
      evidence: ['Tag from DXF TEXT layer "Level 6": V-0101', 'Bbox estimated from tag position — vision required'],
    })];
    // Vision box centered at same spot as vector box center (125,125 global)
    // → world (12500, 8750) → region norm x=(12500-20000)/18400*1000 <0 — out of view.
    // Instead place vector box inside the view: global (291,495) ↔ region (495,495).
    vec[0].bbox = { x: 285, y: 490, width: 12, height: 10 };
    mergeVisionDetections(
      vec,
      [{
        assetTag: 'V-0101', assetType: 'Vessel', confidence: 0.9,
        bboxNorm: { x: 490, y: 490, width: 12, height: 12 },
        evidence: ['YOLO GEO-2: vessel (score=0.90)'],
      }],
      VIEW, GLOBAL, 2, 1,
    );
    // Vision box ≈ global (289..291, ~493..495) — must replace the estimated one
    expect(vec[0].bbox.x).toBeGreaterThanOrEqual(280);
    expect(vec[0].bbox.x).toBeLessThanOrEqual(300);
  });

  it('creates REVIEW-leaning candidate for untagged vision', () => {
    const vec = [vectorDet()];
    const stats = mergeVisionDetections(
      vec,
      [{
        assetTag: null, assetType: 'Valve', confidence: 0.9,
        bboxNorm: { x: 100, y: 100, width: 20, height: 20 },
        evidence: ['YOLO GEO-2: valve (score=0.90)'],
      }],
      VIEW, GLOBAL, 2, 1,
    );
    expect(stats.visionOnlyNew).toBe(1);
    expect(vec.length).toBe(2);
    const added = vec[1];
    expect(added.assetTag).toBeNull();
    expect(added.confidence).toBeLessThanOrEqual(0.55);
    expect(added.pidPage).toBe(2);
    expect(added.source).toBe('VISION');
    expect(added.needsGeminiClassification).toBe(true);
  });

  it('does not merge same tag far apart (different instances)', () => {
    const vec = [vectorDet()];
    const stats = mergeVisionDetections(
      vec,
      [{
        assetTag: 'V-0101', assetType: 'Vessel', confidence: 0.9,
        bboxNorm: { x: 50, y: 50, width: 10, height: 10 }, // far corner
        evidence: ['YOLO GEO-2: vessel'],
      }],
      VIEW, GLOBAL, 2, 1,
    );
    expect(stats.mergedIntoVector).toBe(0);
    expect(stats.visionOnlyNew).toBe(1);
    expect(vec.length).toBe(2);
  });
});
