/**
 * YOLO v203 Decoder & Preprocessing Unit Tests (Phase 2)
 *
 * Tests:
 *   - 1024×1024 letterbox geometry & inverse bbox transformations
 *   - Channel-major [1, 207, 21504] tensor indexing: channel * 21504 + candidate
 *   - Direct class scoring at offset 4 (no objectness channel)
 *   - Class-aware NMS for 203 classes
 *   - Unresolved semantic fields (assetType: null, equipmentClass: null, detectionSubtype: null)
 *   - Normalized 0-1000 bounding box conversion
 */

import {
  computeLetterboxMeta,
  invertLetterboxBox,
} from '@/lib/detection/yolo/yolo-preprocessing';
import {
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_INPUT_SIZE,
  YOLO_V203_OUTPUT_CHANNELS,
} from '@/lib/detection/yolo/yolo-class-map-v203';
import {
  applyClassAwareNmsV203,
  decodeAndFilterV203,
  decodeYoloV203Output,
  iou,
  toNormalizedV203Detections,
  valueAtV203,
  type YoloV203RawDetection,
} from '@/lib/detection/yolo/yolo-decoder-v203';
import {
  assertYoloV203ModelArtifact,
  DEFAULT_V203_MODEL_PATH,
} from '@/lib/detection/yolo/yolo-inference-v203';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('YOLO v203 Preprocessing (1024×1024)', () => {
  it('computes correct letterbox scale and padding for landscape image (2000x1000)', () => {
    const meta = computeLetterboxMeta(2000, 1000, 1024);
    expect(meta.sourceWidth).toBe(2000);
    expect(meta.sourceHeight).toBe(1000);
    expect(meta.inputWidth).toBe(1024);
    expect(meta.inputHeight).toBe(1024);

    // Scale = 1024 / 2000 = 0.512
    expect(meta.scale).toBeCloseTo(0.512, 4);
    // Scaled width = 1024, padX = 0
    expect(meta.padX).toBe(0);
    // Scaled height = 512, padY = (1024 - 512) / 2 = 256
    expect(meta.padY).toBe(256);
  });

  it('computes correct letterbox scale and padding for portrait image (1000x2000)', () => {
    const meta = computeLetterboxMeta(1000, 2000, 1024);
    // Scale = 1024 / 2000 = 0.512
    expect(meta.scale).toBeCloseTo(0.512, 4);
    // Scaled width = 512, padX = 256
    expect(meta.padX).toBe(256);
    // Scaled height = 1024, padY = 0
    expect(meta.padY).toBe(0);
  });

  it('computes zero padding for exact 1024x1024 square image', () => {
    const meta = computeLetterboxMeta(1024, 1024, 1024);
    expect(meta.scale).toBe(1.0);
    expect(meta.padX).toBe(0);
    expect(meta.padY).toBe(0);
  });

  it('inverts letterbox box back to source pixel coordinates with clamping', () => {
    const meta = computeLetterboxMeta(2000, 1000, 1024);
    // A box centered at (512, 512) with size (200, 100) in 1024x1024 space:
    // x1 = 412, y1 = 462, x2 = 612, y2 = 562
    const letterboxBox = { x1: 412, y1: 462, x2: 612, y2: 562 };
    const sourceBox = invertLetterboxBox(letterboxBox, meta);

    // x in source = 412 / 0.512 = ~804.68
    expect(sourceBox.x1).toBeCloseTo(804.6875, 1);
    expect(sourceBox.x2).toBeCloseTo(1195.3125, 1);
    // y in source = (462 - 256) / 0.512 = 206 / 0.512 = ~402.34
    expect(sourceBox.y1).toBeCloseTo(402.34375, 1);
    expect(sourceBox.y2).toBeCloseTo(597.65625, 1);
  });
});

describe('YOLO v203 Decoder (Channel-Major & 203 Classes)', () => {
  const TOTAL_LENGTH = YOLO_V203_OUTPUT_CHANNELS * YOLO_V203_CANDIDATE_COUNT; // 207 * 21504 = 4,451,328

  it('reads tensor with channel-major indexing: channel * 21504 + candidate', () => {
    const tensor = new Float32Array(TOTAL_LENGTH);
    // Write test value at channel 4 (class 0), candidate 123
    tensor[4 * YOLO_V203_CANDIDATE_COUNT + 123] = 0.875;
    // Write test value at channel 206 (class 202), candidate 456
    tensor[206 * YOLO_V203_CANDIDATE_COUNT + 456] = 0.925;

    expect(valueAtV203(tensor, 4, 123)).toBeCloseTo(0.875, 4);
    expect(valueAtV203(tensor, 206, 456)).toBeCloseTo(0.925, 4);
  });

  it('throws when tensor length is invalid', () => {
    const invalidTensor = new Float32Array(1000);
    const meta = computeLetterboxMeta(1024, 1024, YOLO_V203_INPUT_SIZE);
    expect(() => decodeYoloV203Output(invalidTensor, meta, 0.5)).toThrow(/tensor length/);
  });

  it('decodes synthetic detections accurately without objectness multiplication', () => {
    const tensor = new Float32Array(TOTAL_LENGTH);
    const meta = computeLetterboxMeta(1024, 1024, YOLO_V203_INPUT_SIZE);

    // Candidate 50: cx=500, cy=400, w=60, h=80, class 0 (valve.3way_ball.iso) score=0.92
    tensor[0 * YOLO_V203_CANDIDATE_COUNT + 50] = 500;
    tensor[1 * YOLO_V203_CANDIDATE_COUNT + 50] = 400;
    tensor[2 * YOLO_V203_CANDIDATE_COUNT + 50] = 60;
    tensor[3 * YOLO_V203_CANDIDATE_COUNT + 50] = 80;
    tensor[(YOLO_V203_CLASS_CHANNEL_OFFSET + 0) * YOLO_V203_CANDIDATE_COUNT + 50] = 0.92;

    // Candidate 100: cx=800, cy=700, w=100, h=120, class 202 (fitting.eccentric_reducer.iso) score=0.88
    tensor[0 * YOLO_V203_CANDIDATE_COUNT + 100] = 800;
    tensor[1 * YOLO_V203_CANDIDATE_COUNT + 100] = 700;
    tensor[2 * YOLO_V203_CANDIDATE_COUNT + 100] = 100;
    tensor[3 * YOLO_V203_CANDIDATE_COUNT + 100] = 120;
    tensor[(YOLO_V203_CLASS_CHANNEL_OFFSET + 202) * YOLO_V203_CANDIDATE_COUNT + 100] = 0.88;

    const raw = decodeYoloV203Output(tensor, meta, 0.5);
    expect(raw.length).toBe(2);

    const det0 = raw.find((d) => d.rawClassId === 0);
    expect(det0).toBeDefined();
    expect(det0?.score).toBeCloseTo(0.92, 4);
    expect(det0?.rawLabel).toBe('valve.3way_ball.iso');
    expect(det0?.x1).toBeCloseTo(470, 2); // 500 - 30
    expect(det0?.y1).toBeCloseTo(360, 2); // 400 - 40
    expect(det0?.x2).toBeCloseTo(530, 2); // 500 + 30
    expect(det0?.y2).toBeCloseTo(440, 2); // 400 + 40

    const det202 = raw.find((d) => d.rawClassId === 202);
    expect(det202).toBeDefined();
    expect(det202?.score).toBeCloseTo(0.88, 4);
    expect(det202?.rawLabel).toBe('fitting.eccentric_reducer.iso');
  });

  it('filters out candidates below confidence threshold', () => {
    const tensor = new Float32Array(TOTAL_LENGTH);
    const meta = computeLetterboxMeta(1024, 1024, YOLO_V203_INPUT_SIZE);

    // Candidate 10: class 13 score = 0.20 (below threshold 0.25)
    tensor[0 * YOLO_V203_CANDIDATE_COUNT + 10] = 100;
    tensor[1 * YOLO_V203_CANDIDATE_COUNT + 10] = 100;
    tensor[2 * YOLO_V203_CANDIDATE_COUNT + 10] = 50;
    tensor[3 * YOLO_V203_CANDIDATE_COUNT + 10] = 50;
    tensor[(YOLO_V203_CLASS_CHANNEL_OFFSET + 13) * YOLO_V203_CANDIDATE_COUNT + 10] = 0.20;

    const raw = decodeYoloV203Output(tensor, meta, 0.25);
    expect(raw.length).toBe(0);
  });
});

describe('YOLO v203 Class-Aware NMS & Normalization', () => {
  it('suppresses overlapping boxes of the SAME class but keeps DIFFERENT classes', () => {
    const detections: YoloV203RawDetection[] = [
      // Box 1: Class 0, score 0.95 at (100, 100, 200, 200)
      { x1: 100, y1: 100, x2: 200, y2: 200, score: 0.95, rawClassId: 0, rawLabel: 'valve.3way_ball.iso' },
      // Box 2: Class 0, score 0.85 at (105, 105, 205, 205) -> high overlap with Box 1, should be suppressed
      { x1: 105, y1: 105, x2: 205, y2: 205, score: 0.85, rawClassId: 0, rawLabel: 'valve.3way_ball.iso' },
      // Box 3: Class 13 (valve.ball.iso), score 0.90 at (102, 102, 202, 202) -> high overlap, but DIFFERENT class -> KEPT
      { x1: 102, y1: 102, x2: 202, y2: 202, score: 0.90, rawClassId: 13, rawLabel: 'valve.ball.iso' },
    ];

    const nmsed = applyClassAwareNmsV203(detections, 0.45, 100);
    expect(nmsed.length).toBe(2);

    const class0 = nmsed.filter((d) => d.rawClassId === 0);
    expect(class0.length).toBe(1);
    expect(class0[0].score).toBe(0.95);

    const class13 = nmsed.filter((d) => d.rawClassId === 13);
    expect(class13.length).toBe(1);
    expect(class13[0].score).toBe(0.90);
  });

  it('normalizes coordinates to 0-1000 scale and ensures semantic fields are unresolved null', () => {
    const meta = computeLetterboxMeta(2000, 1000, 1024);
    const raw: YoloV203RawDetection[] = [
      {
        x1: 500,
        y1: 250,
        x2: 1500,
        y2: 750,
        score: 0.96,
        rawClassId: 0,
        rawLabel: 'valve.3way_ball.iso',
      },
    ];

    const normalized = toNormalizedV203Detections(raw, meta);
    expect(normalized.length).toBe(1);

    const det = normalized[0];
    // x = 500 / 2000 * 1000 = 250
    // y = 250 / 1000 * 1000 = 250
    // width = 1000 / 2000 * 1000 = 500
    // height = 500 / 1000 * 1000 = 500
    expect(det.bbox.x).toBe(250);
    expect(det.bbox.y).toBe(250);
    expect(det.bbox.width).toBe(500);
    expect(det.bbox.height).toBe(500);
    expect(det.confidence).toBe(0.96);
    expect(det.rawClassId).toBe(0);
    expect(det.rawLabel).toBe('valve.3way_ball.iso');

    // Semantic fields MUST be unresolved null
    expect(det.assetType).toBeNull();
    expect(det.equipmentClass).toBeNull();
    expect(det.detectionSubtype).toBeNull();
  });

  it('executes full decodeAndFilterV203 end-to-end', () => {
    const TOTAL_LENGTH = YOLO_V203_OUTPUT_CHANNELS * YOLO_V203_CANDIDATE_COUNT;
    const tensor = new Float32Array(TOTAL_LENGTH);
    const meta = computeLetterboxMeta(1024, 1024, YOLO_V203_INPUT_SIZE);

    // Box at cx=512, cy=512, w=200, h=200, class 60 (valve.general.iso) score=0.91
    tensor[0 * YOLO_V203_CANDIDATE_COUNT + 1] = 512;
    tensor[1 * YOLO_V203_CANDIDATE_COUNT + 1] = 512;
    tensor[2 * YOLO_V203_CANDIDATE_COUNT + 1] = 200;
    tensor[3 * YOLO_V203_CANDIDATE_COUNT + 1] = 200;
    tensor[(YOLO_V203_CLASS_CHANNEL_OFFSET + 60) * YOLO_V203_CANDIDATE_COUNT + 1] = 0.91;

    const results = decodeAndFilterV203(tensor, meta, {
      confidenceThreshold: 0.5,
      nmsIouThreshold: 0.45,
      maxDetections: 50,
    });

    expect(results.length).toBe(1);
    expect(results[0].rawClassId).toBe(60);
    expect(results[0].rawLabel).toBe('valve.general.iso');
    expect(results[0].confidence).toBeCloseTo(0.91, 4);
    expect(results[0].assetType).toBeNull();
  });
});

describe('YOLO v203 Model Artifact Guard', () => {
  it('passes for the actual hydrated model file', async () => {
    if (fs.existsSync(DEFAULT_V203_MODEL_PATH)) {
      await expect(assertYoloV203ModelArtifact(DEFAULT_V203_MODEL_PATH)).resolves.toBeUndefined();
    }
  });

  it('throws when model file does not exist', async () => {
    const fakePath = path.join(os.tmpdir(), 'non_existent_yolo_model.onnx');
    await expect(assertYoloV203ModelArtifact(fakePath)).rejects.toThrow(/not found/);
  });

  it('throws when model file is an unhydrated Git LFS pointer', async () => {
    const tmpLfs = path.join(os.tmpdir(), `lfs_test_${Date.now()}.onnx`);
    fs.writeFileSync(tmpLfs, 'version https://git-lfs.github.com/spec/v1\noid sha256:12345\nsize 123\n');
    try {
      await expect(assertYoloV203ModelArtifact(tmpLfs)).rejects.toThrow(/Git LFS pointer/);
    } finally {
      if (fs.existsSync(tmpLfs)) fs.unlinkSync(tmpLfs);
    }
  });

  it('throws when model file is too small (< 1MB)', async () => {
    const tmpSmall = path.join(os.tmpdir(), `small_test_${Date.now()}.onnx`);
    fs.writeFileSync(tmpSmall, Buffer.alloc(500));
    try {
      await expect(assertYoloV203ModelArtifact(tmpSmall)).rejects.toThrow(/unexpectedly small/);
    } finally {
      if (fs.existsSync(tmpSmall)) fs.unlinkSync(tmpSmall);
    }
  });
});

