import {
  computeLetterboxMeta,
  invertLetterboxBox,
} from '@/lib/detection/yolo/yolo-preprocessing';
import {
  applyClassAwareNms,
  decodeYoloOutput,
  iou,
  valueAt,
  YOLO_OUTPUT_CHANNELS,
  type YoloRawDetection,
} from '@/lib/detection/yolo/yolo-decoder';
import { YOLO_CANDIDATE_COUNT } from '@/lib/detection/yolo/yolo-class-map';

describe('YOLO Letterbox preprocessing & inverse transform', () => {
  it('computes correct scale and padding for landscape image (2482x1755)', () => {
    const meta = computeLetterboxMeta(2482, 1755, 640);
    // scale = 640 / 2482 ≈ 0.257856
    expect(meta.scale).toBeCloseTo(640 / 2482, 4);
    // padX = 0 (width fits exactly)
    expect(meta.padX).toBe(0);
    // padY = (640 - round(1755 * scale)) / 2 ≈ (640 - 453) / 2 = 93.5 -> 93 or 94
    expect(meta.padY).toBeGreaterThanOrEqual(93);
    expect(meta.padY).toBeLessThanOrEqual(94);
  });

  it('computes correct scale and padding for portrait image (1000x2000)', () => {
    const meta = computeLetterboxMeta(1000, 2000, 640);
    // scale = 640 / 2000 = 0.32
    expect(meta.scale).toBe(0.32);
    // padY = 0 (height fits exactly)
    expect(meta.padY).toBe(0);
    // padX = (640 - 320) / 2 = 160
    expect(meta.padX).toBe(160);
  });

  it('computes zero padding for square image (1000x1000)', () => {
    const meta = computeLetterboxMeta(1000, 1000, 640);
    expect(meta.scale).toBe(0.64);
    expect(meta.padX).toBe(0);
    expect(meta.padY).toBe(0);
  });

  it('inverts letterbox box back to exact source pixel coordinates', () => {
    const meta = computeLetterboxMeta(2000, 1000, 640);
    // scale = 640/2000 = 0.32, padX = 0, padY = (640 - 320)/2 = 160
    // Source box at (500, 250, 1000, 500) -> width 500, height 250
    // Letterbox coords: x = 500*0.32 = 160, y = 250*0.32 + 160 = 240
    //                   w = 500*0.32 = 160, h = 250*0.32 = 80
    const letterboxBox = { x1: 160, y1: 240, x2: 320, y2: 320 };
    const inv = invertLetterboxBox(letterboxBox, meta);

    expect(inv.x1).toBeCloseTo(500, 0);
    expect(inv.y1).toBeCloseTo(250, 0);
    expect(inv.x2).toBeCloseTo(1000, 0);
    expect(inv.y2).toBeCloseTo(500, 0);
  });

  it('clamps inverted coordinates to source bounds', () => {
    const meta = computeLetterboxMeta(1000, 1000, 640);
    const outOfBounds = { x1: -50, y1: -50, x2: 700, y2: 700 };
    const inv = invertLetterboxBox(outOfBounds, meta);

    expect(inv.x1).toBe(0);
    expect(inv.y1).toBe(0);
    expect(inv.x2).toBe(1000);
    expect(inv.y2).toBe(1000);
  });
});

describe('YOLO Decoder — Channel-major layout & NMS', () => {
  it('reads tensor with channel-major indexing: channel * 8400 + candidate', () => {
    const tensor = new Float32Array(YOLO_OUTPUT_CHANNELS * YOLO_CANDIDATE_COUNT);

    // Set a synthetic value at channel 22 (Rupture_disk), candidate 42
    // channel 22 score channel is 5 + 22 = 27
    const targetChannel = 5 + 22;
    const targetCandidate = 42;
    tensor[targetChannel * YOLO_CANDIDATE_COUNT + targetCandidate] = 0.88;

    expect(valueAt(tensor, targetChannel, targetCandidate)).toBeCloseTo(0.88, 4);
    // Verify WRONG indexing scheme does not read this value
    const wrongIndex = targetCandidate * YOLO_OUTPUT_CHANNELS + targetChannel;
    expect(tensor[wrongIndex]).toBe(0);
  });

  it('decodes a synthetic detection correctly from channel-major tensor', () => {
    const tensor = new Float32Array(YOLO_OUTPUT_CHANNELS * YOLO_CANDIDATE_COUNT);
    const meta = computeLetterboxMeta(1000, 1000, 640);

    // Plant a Gate_Valve (class 1, channel 5+1=6) at candidate 100
    // Center (320, 320), size (64, 64) in 640x640 space
    const cand = 100;
    tensor[0 * YOLO_CANDIDATE_COUNT + cand] = 320; // cx
    tensor[1 * YOLO_CANDIDATE_COUNT + cand] = 320; // cy
    tensor[2 * YOLO_CANDIDATE_COUNT + cand] = 64;  // w
    tensor[3 * YOLO_CANDIDATE_COUNT + cand] = 64;  // h
    tensor[4 * YOLO_CANDIDATE_COUNT + cand] = 0.0; // unused objectness channel
    tensor[6 * YOLO_CANDIDATE_COUNT + cand] = 0.85; // class 1 score

    const raw = decodeYoloOutput(tensor, meta, 0.5);
    expect(raw.length).toBe(1);
    expect(raw[0].canonicalClassId).toBe(1);
    expect(raw[0].canonicalLabel).toBe('Gate_Valve');
    expect(raw[0].score).toBeCloseTo(0.85, 2);
    expect(raw[0].wasDuplicate).toBe(false);
    // In 1000x1000 source space (scale = 640/1000 = 0.64):
    // cx = 320/0.64 = 500, w = 64/0.64 = 100 -> x1 = 450, x2 = 550
    expect(raw[0].x1).toBeCloseTo(450, 0);
    expect(raw[0].y1).toBeCloseTo(450, 0);
    expect(raw[0].x2).toBeCloseTo(550, 0);
    expect(raw[0].y2).toBeCloseTo(550, 0);
  });

  it('maps duplicate class 5 to canonical class 3 (Globe_valve_NO)', () => {
    const tensor = new Float32Array(YOLO_OUTPUT_CHANNELS * YOLO_CANDIDATE_COUNT);
    const meta = computeLetterboxMeta(1000, 1000, 640);

    const cand = 200;
    tensor[0 * YOLO_CANDIDATE_COUNT + cand] = 200;
    tensor[1 * YOLO_CANDIDATE_COUNT + cand] = 200;
    tensor[2 * YOLO_CANDIDATE_COUNT + cand] = 50;
    tensor[3 * YOLO_CANDIDATE_COUNT + cand] = 50;
    tensor[(5 + 5) * YOLO_CANDIDATE_COUNT + cand] = 0.77; // class 5

    const raw = decodeYoloOutput(tensor, meta, 0.5);
    expect(raw.length).toBe(1);
    expect(raw[0].rawClassId).toBe(5);
    expect(raw[0].canonicalClassId).toBe(3); // canonical is 3
    expect(raw[0].canonicalLabel).toBe('Globe_valve_NO');
    expect(raw[0].wasDuplicate).toBe(true);
  });

  it('rejects class 0 (Not_used) even with high confidence', () => {
    const tensor = new Float32Array(YOLO_OUTPUT_CHANNELS * YOLO_CANDIDATE_COUNT);
    const meta = computeLetterboxMeta(1000, 1000, 640);

    const cand = 300;
    tensor[0 * YOLO_CANDIDATE_COUNT + cand] = 200;
    tensor[1 * YOLO_CANDIDATE_COUNT + cand] = 200;
    tensor[2 * YOLO_CANDIDATE_COUNT + cand] = 50;
    tensor[3 * YOLO_CANDIDATE_COUNT + cand] = 50;
    tensor[5 * YOLO_CANDIDATE_COUNT + cand] = 0.99; // class 0 (channel 5)

    const raw = decodeYoloOutput(tensor, meta, 0.5);
    expect(raw.length).toBe(0); // rejected
  });

  it('calculates exact IoU between two bounding boxes', () => {
    const a = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const b = { x1: 50, y1: 0, x2: 150, y2: 100 };
    // Intersection: 50x100 = 5000; Union: 10000 + 10000 - 5000 = 15000; IoU = 5000/15000 = 1/3
    expect(iou(a, b)).toBeCloseTo(1 / 3, 4);

    // No overlap
    const c = { x1: 200, y1: 200, x2: 300, y2: 300 };
    expect(iou(a, c)).toBe(0);

    // Identical
    expect(iou(a, a)).toBe(1.0);
  });

  it('class-aware NMS suppresses overlapping boxes of SAME class but keeps DIFFERENT classes', () => {
    const detections: YoloRawDetection[] = [
      // Two overlapping Gate_Valves (class 1)
      {
        x1: 100, y1: 100, x2: 200, y2: 200, score: 0.9,
        rawClassId: 1, rawLabel: 'Gate_Valve', canonicalClassId: 1, canonicalLabel: 'Gate_Valve', wasDuplicate: false,
      },
      {
        x1: 110, y1: 110, x2: 210, y2: 210, score: 0.7,
        rawClassId: 1, rawLabel: 'Gate_Valve', canonicalClassId: 1, canonicalLabel: 'Gate_Valve', wasDuplicate: false,
      },
      // Overlapping Flange (class 21) at nearly same location
      {
        x1: 105, y1: 105, x2: 205, y2: 205, score: 0.85,
        rawClassId: 21, rawLabel: 'Flange_or_Nozzle', canonicalClassId: 21, canonicalLabel: 'Flange_or_Nozzle', wasDuplicate: false,
      },
    ];

    const nmsed = applyClassAwareNms(detections, 0.5, 100);
    // Should keep 2: higher-confidence Gate_Valve (0.9) and Flange (0.85).
    // The lower-confidence Gate_Valve (0.7) should be suppressed by 0.9 Gate_Valve.
    expect(nmsed.length).toBe(2);
    expect(nmsed.map((d) => d.canonicalClassId)).toEqual([1, 21]);
    expect(nmsed.map((d) => d.score)).toEqual([0.9, 0.85]);
  });
});
