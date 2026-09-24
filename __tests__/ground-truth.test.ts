import { readFileSync } from 'fs';
import { join } from 'path';
import type { GTPage } from '@/lib/detection/eval/gt-model';

const loadGT = (): GTPage =>
  JSON.parse(readFileSync(join(process.cwd(), 'services', 'cv', 'tests', 'gt_pdt11_snippet_v1.json'), 'utf-8'));

describe('ground truth annotation (human, independent)', () => {
  it('has positive + ambiguous + unknown + explicit negatives', () => {
    const gt = loadGT();
    const statuses = new Set(gt.assets.map((a) => a.status));
    expect(statuses.has('positive')).toBe(true);
    expect(statuses.has('ambiguous')).toBe(true);
    expect(statuses.has('unknown')).toBe(true);
    expect(gt.assets.filter((a) => a.status === 'positive')).toHaveLength(9);
    expect(gt.negatives.length).toBeGreaterThanOrEqual(10);
  });

  it('covers 6-digit tags, tagless asset, and association case', () => {
    const gt = loadGT();
    const tags = gt.assets.map((a) => a.tag);
    expect(tags).toContain('VLV-380795');
    expect(tags).toContain('P-380126');
    expect(gt.assets.some((a) => a.status === 'positive' && a.tag === null)).toBe(true);
    expect(gt.assets.some((a) => a.id === 'gt-007' && a.tagBBox !== null)).toBe(true);
  });

  it('records methodology (coordMethod + conditions)', () => {
    const gt = loadGT();
    expect(gt.coordMethod).toBe('visual-estimate');
    expect(gt.conditions.ocrDifficulty).toBe('high');
    expect(gt.version).toBe('gt-v1');
  });
});
