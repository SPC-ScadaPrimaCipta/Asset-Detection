import {
  legendTagPatterns,
  processPageDeterministic,
} from '@/lib/detection/pipeline/deterministic-page';

describe('legendTagPatterns', () => {
  it('converts P-### style to regex sources', () => {
    const out = legendTagPatterns([
      { tag_pattern: 'P-###' },
      { tag_pattern: 'VLV-*' },
      { tag_pattern: null },
    ]);
    expect(out).toHaveLength(2);
    expect(new RegExp(out[0].regex).test('P-101')).toBe(true);
    expect(new RegExp(out[0].regex).test('P-101A')).toBe(false);
    expect(new RegExp(out[1].regex).test('VLV-380795')).toBe(true);
  });
});

describe('processPageDeterministic', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns service-down when the sidecar is unreachable (legacy fallback)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    const out = await processPageDeterministic({
      buf: Buffer.from('x'),
      page: 1,
      jobId: 'j',
      docId: 'd',
      filename: 'f.pdf',
      effectiveLegendId: null,
      legendSymbols: [],
      tagPatterns: [],
      legendDefs: [],
      nullThreshold: 0.5,
      db: { query: jest.fn() },
      log: () => {},
    });
    expect(out).toEqual({ status: 'service-down', count: 0 });
  });
});
