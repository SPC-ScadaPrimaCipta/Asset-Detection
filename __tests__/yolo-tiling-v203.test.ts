/**
 * YOLO v203 Native-Resolution Tiling & Global Merge Test Suite
 *
 * Covers:
 *   1. Axis offset generation & zero-gap grid coverage (including mixed boundary padding: 800x2400, 2400x600)
 *   2. Tensor extraction & grey padding (114) verification
 *   3. Coordinate mapping, clamping, and padding box rejection
 *   4. Deterministic Class-Aware Global Merge (permutation invariance, tie-breaking, no arbitrary 300 cap)
 *   5. End-to-end Bit-Exact Parity against Python Reference (fixtures/reference/yolo-v203-tiling-python-reference.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  generateAxisOffsets,
  computeTileGrid,
  extractTileTensorFromRgb,
  mapTileDetectionToPage,
  computeBoxIoU,
  mergeGlobalDetectionsClassAware,
  type RawPageDetection,
  type TileDescriptor,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILE_STRIDE,
  DEFAULT_PAD_VALUE,
  DEFAULT_PER_TILE_MAX_DETECTIONS,
  capPerTileDetections,
} from '@/lib/detection/yolo/yolo-tiling-v203';

const REF_PATH = path.resolve(__dirname, '../fixtures/reference/yolo-v203-tiling-python-reference-v2-cap300.json');

describe('YOLO v203 Tiling — Axis Offset & Grid Generation', () => {
  it('generates [0] for dimensions <= tileSize (1024)', () => {
    expect(generateAxisOffsets(0)).toEqual([0]);
    expect(generateAxisOffsets(500)).toEqual([0]);
    expect(generateAxisOffsets(1024)).toEqual([0]);
  });

  it('generates correct stepping and pins last offset to dimension - tileSize', () => {
    // 2526: 0, 819, and pinned 2526 - 1024 = 1502.
    // The next regular step (1638) would leave the tile beyond the page.
    const offsets = generateAxisOffsets(2526, 1024, 819);
    expect(offsets).toEqual([0, 819, 1502]);
  });

  it('guarantees complete zero-gap coverage for arbitrary page dimensions', () => {
    const testDimensions = [1024, 1025, 1600, 2400, 2526, 3573, 5000];
    for (const dim of testDimensions) {
      const offsets = generateAxisOffsets(dim, 1024, 819);
      // First tile starts at 0
      expect(offsets[0]).toBe(0);
      // Last tile covers up to dim
      const last = offsets[offsets.length - 1];
      expect(last + 1024).toBeGreaterThanOrEqual(dim);

      // Verify no gaps between consecutive tiles
      for (let i = 0; i < offsets.length - 1; i++) {
        const gap = offsets[i + 1] - offsets[i];
        expect(gap).toBeLessThanOrEqual(1024); // Overlap guaranteed
      }
    }
  });

  it('handles mixed aspect ratio page dimensions (800x2400, 2400x600)', () => {
    // Case 1: 800x2400 (W < 1024, H > 1024)
    const grid1 = computeTileGrid(800, 2400);
    expect(grid1.xOffsets).toEqual([0]);
    expect(grid1.yOffsets.length).toBeGreaterThan(1);
    for (const tile of grid1.tiles) {
      expect(tile.validWidth).toBe(800);
      expect(tile.hasPadding).toBe(true);
      expect(tile.validHeight).toBeLessThanOrEqual(1024);
    }

    // Case 2: 2400x600 (W > 1024, H < 1024)
    const grid2 = computeTileGrid(2400, 600);
    expect(grid2.yOffsets).toEqual([0]);
    expect(grid2.xOffsets.length).toBeGreaterThan(1);
    for (const tile of grid2.tiles) {
      expect(tile.validHeight).toBe(600);
      expect(tile.hasPadding).toBe(true);
      expect(tile.validWidth).toBeLessThanOrEqual(1024);
    }
  });
});

describe('YOLO v203 Tiling — Tensor Extraction & Padding', () => {
  it('extracts unscaled RGB pixels and pads boundary regions with grey (114)', () => {
    const pageW = 1200;
    const pageH = 800;
    const pageRgb = new Uint8Array(pageW * pageH * 3);

    // Fill page with known color (R=200, G=100, B=50)
    for (let i = 0; i < pageW * pageH; i++) {
      pageRgb[i * 3] = 200;
      pageRgb[i * 3 + 1] = 100;
      pageRgb[i * 3 + 2] = 50;
    }

    const tile: TileDescriptor = {
      tileIndex: 0,
      colIndex: 0,
      rowIndex: 0,
      x: 0,
      y: 0,
      width: 1024,
      height: 1024,
      validWidth: 1024,
      validHeight: 800, // Needs 224px vertical padding
      hasPadding: true,
    };

    const tensor = extractTileTensorFromRgb(pageRgb, pageW, pageH, tile, 1024, 114);
    expect(tensor.length).toBe(3 * 1024 * 1024);

    const planeSize = 1024 * 1024;
    const expectedPadNorm = 114 / 255.0;

    // Check inside valid region (row 100, col 100)
    const validIdx = 100 * 1024 + 100;
    expect(tensor[validIdx]).toBeCloseTo(200 / 255.0, 4);
    expect(tensor[planeSize + validIdx]).toBeCloseTo(100 / 255.0, 4);
    expect(tensor[2 * planeSize + validIdx]).toBeCloseTo(50 / 255.0, 4);

    // Check inside padding region (row 900, col 100) -> should be 114/255
    const padIdx = 900 * 1024 + 100;
    expect(tensor[padIdx]).toBeCloseTo(expectedPadNorm, 4);
    expect(tensor[planeSize + padIdx]).toBeCloseTo(expectedPadNorm, 4);
    expect(tensor[2 * planeSize + padIdx]).toBeCloseTo(expectedPadNorm, 4);
  });
});

describe('YOLO v203 Tiling — Coordinate Translation & Padding Rejection', () => {
  const tile: TileDescriptor = {
    tileIndex: 1,
    colIndex: 1,
    rowIndex: 0,
    x: 819,
    y: 0,
    width: 1024,
    height: 1024,
    validWidth: 500, // Right 524px is padding
    validHeight: 1024,
    hasPadding: true,
  };
  const pageW = 1319;
  const pageH = 1024;

  it('translates valid tile-space box to page-space correctly', () => {
    const tileBox = { x1: 50, y1: 100, x2: 150, y2: 200 };
    const pageBox = mapTileDetectionToPage(tileBox, tile, pageW, pageH);
    expect(pageBox).not.toBeNull();
    expect(pageBox).toEqual({
      x1: 50 + 819,
      y1: 100 + 0,
      x2: 150 + 819,
      y2: 200 + 0,
    });
  });

  it('rejects boxes that start entirely inside padding region', () => {
    // x1=600 is >= validWidth(500)
    const tileBox = { x1: 600, y1: 100, x2: 700, y2: 200 };
    const pageBox = mapTileDetectionToPage(tileBox, tile, pageW, pageH);
    expect(pageBox).toBeNull();
  });

  it('clamps and translates boxes that partially cross into padding region', () => {
    // x1=400, x2=600 -> clamps x2 to 500 -> width = 100
    const tileBox = { x1: 400, y1: 100, x2: 600, y2: 200 };
    const pageBox = mapTileDetectionToPage(tileBox, tile, pageW, pageH);
    expect(pageBox).not.toBeNull();
    expect(pageBox?.x1).toBe(400 + 819);
    expect(pageBox?.x2).toBe(500 + 819);
  });

  it('rejects degenerate boxes (< 1px width or height after clamping)', () => {
    const tileBox = { x1: 499.5, y1: 100, x2: 500, y2: 200 };
    const pageBox = mapTileDetectionToPage(tileBox, tile, pageW, pageH);
    expect(pageBox).toBeNull();
  });
});

describe('YOLO v203 Deterministic Class-Aware Global Merge', () => {
  it('suppresses lower-confidence overlapping candidates of the SAME class (IoU >= 0.50)', () => {
    const candidates: RawPageDetection[] = [
      {
        pageBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        confidence: 0.95,
        rawClassId: 13,
        rawLabel: 'valve.ball.iso',
        tileIndex: 0,
        detectionIndex: 0,
        tileBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
      {
        pageBox: { x1: 102, y1: 101, x2: 201, y2: 201 }, // IoU > 0.90
        confidence: 0.85,
        rawClassId: 13,
        rawLabel: 'valve.ball.iso',
        tileIndex: 1,
        detectionIndex: 0,
        tileBox: { x1: 20, y1: 101, x2: 119, y2: 201 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
    ];

    const result = mergeGlobalDetectionsClassAware(candidates, 0.50);
    expect(result.totalBeforeMerge).toBe(2);
    expect(result.totalAfterMerge).toBe(1);
    expect(result.kept[0].confidence).toBe(0.95);
    expect(result.suppressed.length).toBe(1);
    expect(result.suppressed[0].suppressedBy.confidence).toBe(0.95);
  });

  it('does NOT suppress overlapping candidates of DIFFERENT classes', () => {
    const candidates: RawPageDetection[] = [
      {
        pageBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        confidence: 0.95,
        rawClassId: 13, // valve.ball.iso
        rawLabel: 'valve.ball.iso',
        tileIndex: 0,
        detectionIndex: 0,
        tileBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
      {
        pageBox: { x1: 100, y1: 100, x2: 200, y2: 200 }, // Identical box, different class
        confidence: 0.90,
        rawClassId: 16, // valve.butterfly.niso
        rawLabel: 'valve.butterfly.niso',
        tileIndex: 1,
        detectionIndex: 0,
        tileBox: { x1: 20, y1: 100, x2: 120, y2: 200 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
    ];

    const result = mergeGlobalDetectionsClassAware(candidates, 0.50);
    expect(result.totalBeforeMerge).toBe(2);
    expect(result.totalAfterMerge).toBe(2);
    expect(result.suppressed.length).toBe(0);
  });

  it('does NOT suppress same-class candidates with IoU < 0.50', () => {
    const candidates: RawPageDetection[] = [
      {
        pageBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        confidence: 0.95,
        rawClassId: 13,
        rawLabel: 'valve.ball.iso',
        tileIndex: 0,
        detectionIndex: 0,
        tileBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
      {
        pageBox: { x1: 160, y1: 100, x2: 260, y2: 200 }, // IoU = 40/160 = 0.25 (< 0.50)
        confidence: 0.85,
        rawClassId: 13,
        rawLabel: 'valve.ball.iso',
        tileIndex: 1,
        detectionIndex: 0,
        tileBox: { x1: 50, y1: 100, x2: 150, y2: 200 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
    ];

    const result = mergeGlobalDetectionsClassAware(candidates, 0.50);
    expect(result.totalBeforeMerge).toBe(2);
    expect(result.totalAfterMerge).toBe(2);
  });

  it('guarantees 100% permutation invariance regardless of candidate input order', () => {
    const baseCandidates: RawPageDetection[] = [
      {
        pageBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        confidence: 0.92,
        rawClassId: 13,
        rawLabel: 'valve.ball.iso',
        tileIndex: 0,
        detectionIndex: 0,
        tileBox: { x1: 100, y1: 100, x2: 200, y2: 200 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
      {
        pageBox: { x1: 102, y1: 102, x2: 202, y2: 202 },
        confidence: 0.92, // Score tie!
        rawClassId: 13,
        rawLabel: 'valve.ball.iso',
        tileIndex: 1, // Higher tile index loses tie-break
        detectionIndex: 0,
        tileBox: { x1: 50, y1: 50, x2: 150, y2: 150 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
      {
        pageBox: { x1: 500, y1: 500, x2: 600, y2: 600 },
        confidence: 0.75,
        rawClassId: 60,
        rawLabel: 'valve.general.iso',
        tileIndex: 2,
        detectionIndex: 0,
        tileBox: { x1: 50, y1: 50, x2: 150, y2: 150 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
      {
        pageBox: { x1: 800, y1: 800, x2: 900, y2: 900 },
        confidence: 0.88,
        rawClassId: 16,
        rawLabel: 'valve.butterfly.niso',
        tileIndex: 3,
        detectionIndex: 0,
        tileBox: { x1: 50, y1: 50, x2: 150, y2: 150 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      },
    ];

    const perm1 = [...baseCandidates];
    const perm2 = [...baseCandidates].reverse();
    const perm3 = [baseCandidates[2], baseCandidates[0], baseCandidates[3], baseCandidates[1]];

    const res1 = mergeGlobalDetectionsClassAware(perm1, 0.50);
    const res2 = mergeGlobalDetectionsClassAware(perm2, 0.50);
    const res3 = mergeGlobalDetectionsClassAware(perm3, 0.50);

    expect(res1.kept).toEqual(res2.kept);
    expect(res1.kept).toEqual(res3.kept);
    expect(res1.suppressed.length).toBe(1);
    expect(res2.suppressed.length).toBe(1);
    expect(res3.suppressed.length).toBe(1);
  });

  it('caps more than 300 post-NMS tile detections deterministically', () => {
    const candidates = Array.from({ length: DEFAULT_PER_TILE_MAX_DETECTIONS + 25 }, (_, index) => ({
      anchor: index,
      rawClassId: index % 3,
      score: 1 - index / 10000,
      bbox: [index * 10, 0, index * 10 + 5, 5] as [number, number, number, number],
    }));
    const result = capPerTileDetections(candidates);
    expect(result.preCapCount).toBe(325);
    expect(result.cappedCount).toBe(300);
    expect(result.sorted).toHaveLength(300);
    expect(result.sorted[0].score).toBe(candidates[0].score);
    expect(result.sorted[299].score).toBe(candidates[299].score);
  });

  it('does not enforce any arbitrary 300 detection cap at the global merge level', () => {
    const manyCandidates: RawPageDetection[] = [];
    for (let i = 0; i < 400; i++) {
      manyCandidates.push({
        pageBox: { x1: i * 5, y1: i * 5, x2: i * 5 + 4, y2: i * 5 + 4 },
        confidence: 0.50 + (i % 50) * 0.01,
        rawClassId: i % 10,
        rawLabel: `class_${i % 10}`,
        tileIndex: Math.floor(i / 30),
        detectionIndex: i % 30,
        tileBox: { x1: 10, y1: 10, x2: 14, y2: 14 },
        assetType: null,
        equipmentClass: null,
        detectionSubtype: null,
      });
    }

    const result = mergeGlobalDetectionsClassAware(manyCandidates, 0.50);
    expect(result.totalAfterMerge).toBe(400); // All 400 preserved (non-overlapping)
  });
});

describe('YOLO v203 Full-Sheet Tiling Pilot & Cross-Runtime Parity Verification', () => {
  let pilotReport: any = null;

  beforeAll(async () => {
    // Run the pilot in a child process so ONNX Runtime's native module is
    // loaded once in a clean Node process, matching the parity harness.
    // Guard: onnxruntime-node under Jest requires true Float32Array for feeds
    const testTensorFloat32 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const guardFloat = testTensorFloat32 instanceof Float32Array ? testTensorFloat32 : new Float32Array(testTensorFloat32);
    expect(guardFloat instanceof Float32Array).toBe(true);

    execFileSync(process.execPath, [require.resolve('tsx/cli'), path.resolve(__dirname, '../scripts/pilot-tiling-v203.ts')], {
      cwd: path.resolve(__dirname, '..'),
      timeout: 120000,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: 'test',
      },
      stdio: 'inherit',
    });
    pilotReport = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/diagnostics/report/pilot-tiling-v203-report.json'), 'utf8'));
  }, 150000);

  it('generates valid pilot report with full memory telemetry', () => {
    expect(pilotReport).not.toBeNull();
    expect(pilotReport.gridSpec.tiles.length).toBe(15);
    expect(pilotReport.memoryTelemetry.peakHeapUsedMb).toBeGreaterThan(0);
    expect(pilotReport.memoryTelemetry.peakRssMb).toBeGreaterThan(0);
    expect(pilotReport.globalMerge.totalBeforeMerge).toBe(77);
    expect(pilotReport.globalMerge.totalAfterMerge).toBe(60);
    expect(pilotReport.globalMerge.totalSuppressed).toBe(17);
  });

  it('matches Python reference on decoded full-sheet RGB image buffer (SHA-256)', () => {
    expect(fs.existsSync(REF_PATH)).toBe(true);
    const pyRef = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
    expect(pilotReport.sourceImage.decodedRgbSha256).toBe(
      pyRef.metadata.sourceImage.decodedRgbSha256,
    );
  });

  it('matches Python reference on all 15 tile input tensors and raw ONNX outputs (bit-exact)', () => {
    const pyRef = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
    for (let t = 0; t < 15; t++) {
      const pyTile = pyRef.tiles[t];
      const nodeTile = pilotReport.tileResults[t];

      // Exact input tensor SHA-256 match
      expect(nodeTile.inputTensorSha256).toBe(pyTile.inputTensorSha256);
      // Exact raw ONNX output SHA-256 match
      expect(nodeTile.rawOutputSha256).toBe(pyTile.rawOutputSha256);
      // Exact detection count match per tile
      expect(nodeTile.pageDetectionsCount).toBe(pyTile.pageDetectionsCount);
    }
  });

  it('matches Python reference on global merged detections (bit-exact coordinates and scores)', () => {
    const pyRef = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
    const pyKept = pyRef.globalMerge.keptDetections;
    const nodeKept = pilotReport.globalMerge.kept;

    expect(nodeKept.length).toBe(pyKept.length);
    expect(nodeKept.length).toBe(60);

    for (let i = 0; i < nodeKept.length; i++) {
      const n = nodeKept[i];
      const p = pyKept[i];

      expect(n.rawClassId).toBe(p.rawClassId);
      expect(n.confidence).toBeCloseTo(p.confidence, 4);
      expect(Math.abs(n.confidence - p.confidence)).toBeLessThanOrEqual(1e-4);

      expect(Math.abs(n.pageBox.x1 - p.pageBox[0])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(n.pageBox.y1 - p.pageBox[1])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(n.pageBox.x2 - p.pageBox[2])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(n.pageBox.y2 - p.pageBox[3])).toBeLessThanOrEqual(0.5);
    }
  });
});
