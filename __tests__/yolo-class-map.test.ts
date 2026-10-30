import {
  YOLO_CLASS_COUNT,
  YOLO_CLASS_MAP,
  getCanonicalClassIds,
  resolveYoloClass,
  validateYoloClassMap,
} from '@/lib/detection/yolo/yolo-class-map';

describe('YOLO class map — Stage 1 contract', () => {
  it('defines exactly 32 classes (IDs 0-31)', () => {
    expect(YOLO_CLASS_COUNT).toBe(32);
    const keys = Object.keys(YOLO_CLASS_MAP).map(Number).sort((a, b) => a - b);
    expect(keys.length).toBe(32);
    expect(keys[0]).toBe(0);
    expect(keys[keys.length - 1]).toBe(31);
  });

  it('class 0 (Not_used) is marked invalid and returns null from resolveYoloClass', () => {
    expect(YOLO_CLASS_MAP[0].isValid).toBe(false);
    expect(resolveYoloClass(0)).toBeNull();
  });

  it('resolves duplicate class 5 -> canonical class 3 (Globe_valve_NO)', () => {
    const raw = YOLO_CLASS_MAP[5];
    expect(raw.isCanonical).toBe(false);
    expect(raw.canonicalId).toBe(3);

    const resolved = resolveYoloClass(5);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(3);
    expect(resolved!.yoloLabel).toBe('Globe_valve_NO');
    expect(resolved!.isCanonical).toBe(true);
  });

  it('resolves duplicate class 27 -> canonical class 26 (Instrument_Field)', () => {
    const raw = YOLO_CLASS_MAP[27];
    expect(raw.isCanonical).toBe(false);
    expect(raw.canonicalId).toBe(26);

    const resolved = resolveYoloClass(27);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(26);
    expect(resolved!.yoloLabel).toBe('Instrument_Field');
    expect(resolved!.isCanonical).toBe(true);
  });

  it('resolves duplicate class 31 -> canonical class 28 (Instrument_Panel)', () => {
    const raw = YOLO_CLASS_MAP[31];
    expect(raw.isCanonical).toBe(false);
    expect(raw.canonicalId).toBe(28);

    const resolved = resolveYoloClass(31);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(28);
    expect(resolved!.yoloLabel).toBe('Instrument_Panel');
    expect(resolved!.isCanonical).toBe(true);
  });

  it('class 32 (stale in data.yaml) returns null and is not present in the map', () => {
    expect(YOLO_CLASS_MAP[32]).toBeUndefined();
    expect(resolveYoloClass(32)).toBeNull();
  });

  it('negative or non-integer class IDs return null', () => {
    expect(resolveYoloClass(-1)).toBeNull();
    expect(resolveYoloClass(999)).toBeNull();
    expect(resolveYoloClass(1.5)).toBeNull();
    expect(resolveYoloClass(NaN)).toBeNull();
  });

  it('validateYoloClassMap passes for 32 classes and throws for wrong counts', () => {
    expect(() => validateYoloClassMap(32)).not.toThrow();
    expect(() => validateYoloClassMap(33)).toThrow(/mismatch/);
    expect(() => validateYoloClassMap(31)).toThrow(/mismatch/);
  });

  it('getCanonicalClassIds excludes duplicates and class 0', () => {
    const canonicals = getCanonicalClassIds();
    expect(canonicals).not.toContain(0);  // Not_used
    expect(canonicals).not.toContain(5);  // duplicate of 3
    expect(canonicals).not.toContain(27); // duplicate of 26
    expect(canonicals).not.toContain(31); // duplicate of 28
    expect(canonicals).toContain(1);      // Gate_Valve
    expect(canonicals).toContain(3);      // Globe_valve_NO
    expect(canonicals).toContain(26);     // Instrument_Field
    expect(canonicals).toContain(28);     // Instrument_Panel
    expect(canonicals.length).toBe(32 - 1 /* Not_used */ - 3 /* duplicates */);
  });
});
