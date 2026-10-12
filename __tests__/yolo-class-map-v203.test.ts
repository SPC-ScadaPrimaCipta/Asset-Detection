import fs from 'fs';
import path from 'path';
import {
  YOLO_V203_CLASS_COUNT,
  YOLO_V203_CLASS_MAP,
  YOLO_V203_CLASS_CHANNEL_OFFSET,
  YOLO_V203_CANDIDATE_COUNT,
  YOLO_V203_INPUT_SIZE,
  YOLO_V203_OUTPUT_CHANNELS,
  YOLO_V203_MAX_CLASS_ID,
  getV203CanonicalClassIds,
  resolveYoloV203Class,
  validateYoloV203ClassMap,
} from '@/lib/detection/yolo/yolo-class-map-v203';

describe('YOLO v203 raw class map and model contract', () => {
  const snapshotPath = path.resolve(process.cwd(), 'model/yolo-v203-names.json');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Record<string, string>;

  it('defines contiguous raw IDs 0 through 202', () => {
    const ids = Object.keys(YOLO_V203_CLASS_MAP).map(Number).sort((a, b) => a - b);
    expect(YOLO_V203_CLASS_COUNT).toBe(203);
    expect(ids).toEqual(Array.from({ length: 203 }, (_, id) => id));
    expect(YOLO_V203_MAX_CLASS_ID).toBe(202);
  });

  it('matches every raw label to the ONNX metadata snapshot', () => {
    for (let id = 0; id < YOLO_V203_CLASS_COUNT; id++) {
      expect(YOLO_V203_CLASS_MAP[id].yoloLabel).toBe(snapshot[String(id)]);
    }
  });

  it.each([
    [0, 'valve.3way_ball.iso'],
    [13, 'valve.ball.iso'],
    [16, 'valve.butterfly.niso'],
    [60, 'valve.general.iso'],
    [202, 'fitting.eccentric_reducer.iso'],
  ])('keeps raw label for class %i', (id, label) => {
    expect(YOLO_V203_CLASS_MAP[id].yoloLabel).toBe(label);
  });

  it('exposes only unresolved semantic fields', () => {
    for (const info of Object.values(YOLO_V203_CLASS_MAP)) {
      expect(info.assetType).toBeNull();
      expect(info.equipmentClass).toBeNull();
      expect(info.detectionSubtype).toBeNull();
      expect(Object.keys(info).sort()).toEqual([
        'assetType', 'detectionSubtype', 'equipmentClass', 'id', 'yoloLabel',
      ].sort());
    }
  });

  it('does not disable unknown labels', () => {
    const unknown = Object.values(YOLO_V203_CLASS_MAP).filter((info) => info.yoloLabel.startsWith('unknown.'));
    expect(unknown.length).toBeGreaterThan(0);
    for (const info of unknown) expect(resolveYoloV203Class(info.id)).toEqual(info);
  });

  it('uses the v203 tensor contract without changing the old model contract', () => {
    expect(YOLO_V203_INPUT_SIZE).toBe(1024);
    expect(YOLO_V203_CLASS_CHANNEL_OFFSET).toBe(4);
    expect(YOLO_V203_OUTPUT_CHANNELS).toBe(207);
    expect(YOLO_V203_OUTPUT_CHANNELS).toBe(YOLO_V203_CLASS_CHANNEL_OFFSET + YOLO_V203_CLASS_COUNT);
    expect(YOLO_V203_CANDIDATE_COUNT).toBe(21504);
  });

  it('resolves every valid ID and rejects invalid lookups safely', () => {
    for (let id = 0; id <= 202; id++) expect(resolveYoloV203Class(id)?.id).toBe(id);
    for (const id of [-1, 203, 999, 1.5, NaN]) expect(resolveYoloV203Class(id)).toBeNull();
  });

  it('returns all raw IDs without filtering or semantic canonicalization', () => {
    expect(getV203CanonicalClassIds()).toEqual(Array.from({ length: 203 }, (_, id) => id));
  });

  it('validates the raw map', () => {
    expect(() => validateYoloV203ClassMap(203)).not.toThrow();
    expect(() => validateYoloV203ClassMap(202)).toThrow(/mismatch/);
    expect(() => validateYoloV203ClassMap(204)).toThrow(/mismatch/);
  });
});
