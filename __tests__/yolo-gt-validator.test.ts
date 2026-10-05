import { validateGroundTruth } from '@/lib/detection/eval/validate';
import * as fs from 'fs';
import * as path from 'path';

describe('Ground Truth Validator — Offline Quality Gate', () => {
  const TMP_DIR = path.resolve(__dirname, '../storage/test-eval-tmp');

  beforeAll(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('rejects non-existent file', async () => {
    const res = await validateGroundTruth(path.join(TMP_DIR, 'missing.json'));
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes('not found'))).toBe(true);
  });

  it('rejects invalid JSON', async () => {
    const p = path.join(TMP_DIR, 'invalid.json');
    fs.writeFileSync(p, '{ broken json');
    const res = await validateGroundTruth(p);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes('Invalid JSON'))).toBe(true);
  });

  it('flags unsupported class ids (e.g. 0 Not_used, 32 out-of-range, 99 invalid) as errors', async () => {
    const p = path.join(TMP_DIR, 'bad-class.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        pages: [
          {
            pageId: 'p1',
            imagePath: 'dummy.png',
            width: 100,
            height: 100,
            annotations: [
              { id: 'a0', classId: 0, label: 'Not_used', bbox: { x: 10, y: 10, width: 20, height: 20 } },
              { id: 'a32', classId: 32, label: 'Out_of_range', bbox: { x: 10, y: 10, width: 20, height: 20 } },
              { id: 'a99', classId: 99, label: 'Invalid', bbox: { x: 10, y: 10, width: 20, height: 20 } },
            ],
          },
        ],
      }),
    );

    const res = await validateGroundTruth(p);
    expect(res.ok).toBe(false);
    expect(res.issues.filter((i) => i.level === 'error' && i.message.includes('Unsupported or invalid classId')).length).toBe(3);
  });

  it('flags non-canonical duplicate class IDs (5, 27, 31) as errors and directs to canonical', async () => {
    const p = path.join(TMP_DIR, 'duplicate-classes.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        pages: [
          {
            pageId: 'p1',
            imagePath: 'dummy.png',
            width: 100,
            height: 100,
            annotations: [
              { id: 'a5', classId: 5, label: 'Globe_valve_NO_dup', bbox: { x: 10, y: 10, width: 20, height: 20 } },
              { id: 'a27', classId: 27, label: 'Instrument_Field_dup', bbox: { x: 10, y: 10, width: 20, height: 20 } },
              { id: 'a31', classId: 31, label: 'Instrument_Panel_dup', bbox: { x: 10, y: 10, width: 20, height: 20 } },
            ],
          },
        ],
      }),
    );

    const res = await validateGroundTruth(p);
    expect(res.ok).toBe(false);
    const errors = res.issues.filter((i) => i.level === 'error' && i.message.includes('non-canonical duplicate'));
    expect(errors.length).toBe(3);
    expect(errors.some((e) => e.message.includes('classId 5') && e.message.includes('canonical classId 3'))).toBe(true);
    expect(errors.some((e) => e.message.includes('classId 27') && e.message.includes('canonical classId 26'))).toBe(true);
    expect(errors.some((e) => e.message.includes('classId 31') && e.message.includes('canonical classId 28'))).toBe(true);
  });

  it('accepts valid canonical classes (1, 3, 26, 28, 30)', async () => {
    const p = path.join(TMP_DIR, 'valid-canonical.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        pages: [
          {
            pageId: 'p1',
            imagePath: 'dummy.png',
            width: 100,
            height: 100,
            annotations: [
              { id: 'a1', classId: 1, label: 'Gate_Valve', bbox: { x: 5, y: 5, width: 10, height: 10 } },
              { id: 'a3', classId: 3, label: 'Globe_valve_NO', bbox: { x: 20, y: 5, width: 10, height: 10 } },
              { id: 'a26', classId: 26, label: 'Instrument_Field', bbox: { x: 35, y: 5, width: 10, height: 10 } },
              { id: 'a28', classId: 28, label: 'Instrument_Panel', bbox: { x: 50, y: 5, width: 10, height: 10 } },
              { id: 'a30', classId: 30, label: 'box', bbox: { x: 65, y: 5, width: 10, height: 10 } },
            ],
          },
        ],
      }),
    );

    const res = await validateGroundTruth(p);
    // There are no errors, only warnings (e.g. image not found / fewer than 10 pages / missing other classes)
    const errors = res.issues.filter((i) => i.level === 'error' && i.message.includes('classId'));
    expect(errors.length).toBe(0);
    expect(res.classCounts['1']).toBe(1);
    expect(res.classCounts['3']).toBe(1);
    expect(res.classCounts['26']).toBe(1);
    expect(res.classCounts['28']).toBe(1);
    expect(res.classCounts['30']).toBe(1);
  });

  it('flags out-of-bounds bounding boxes', async () => {
    const p = path.join(TMP_DIR, 'out-of-bounds.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        pages: [
          {
            pageId: 'p1',
            imagePath: 'dummy.png',
            width: 1000,
            height: 1000,
            annotations: [
              // x + width = 1200 > 1000
              { id: 'a1', classId: 1, label: 'Gate_Valve', bbox: { x: 900, y: 100, width: 300, height: 50 } },
            ],
          },
        ],
      }),
    );

    const res = await validateGroundTruth(p);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes('exceeds page bounds'))).toBe(true);
  });

  it('flags degenerate (zero or negative) bounding boxes', async () => {
    const p = path.join(TMP_DIR, 'degenerate.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        pages: [
          {
            pageId: 'p1',
            imagePath: 'dummy.png',
            width: 1000,
            height: 1000,
            annotations: [
              { id: 'a1', classId: 1, label: 'Gate_Valve', bbox: { x: 100, y: 100, width: 0, height: 50 } },
            ],
          },
        ],
      }),
    );

    const res = await validateGroundTruth(p);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes('Degenerate bbox'))).toBe(true);
  });

  it('warns when dataset has fewer than 10 pages', async () => {
    const p = path.join(TMP_DIR, 'few-pages.json');
    fs.writeFileSync(
      p,
      JSON.stringify({
        pages: [
          {
            pageId: 'p1',
            imagePath: 'dummy.png',
            width: 1000,
            height: 1000,
            annotations: [],
          },
        ],
      }),
    );

    const res = await validateGroundTruth(p);
    expect(res.belowMinPages).toBe(true);
    expect(res.issues.some((i) => i.message.includes('requires ≥10'))).toBe(true);
  });
});
