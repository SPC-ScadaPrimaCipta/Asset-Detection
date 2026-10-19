import { persistDetections, type PersistableDetection, type DbLike, type PersistContext } from '@/lib/detection/persistence/detection-repository';

describe('Detection Repository Size Field', () => {
  it('includes size in SQL INSERT parameters', async () => {
    const executedQueries: { text: string; params: unknown[] }[] = [];
    const mockDb: DbLike = {
      query: async (text: string, params: unknown[]) => {
        executedQueries.push({ text, params });
        return { rows: [] };
      },
    };

    const det: PersistableDetection = {
      assetTag: 'VLV-001',
      assetType: 'Valve',
      confidence: 0.95,
      bbox: { x: 10, y: 10, width: 20, height: 20 },
      evidence: ['Symbol detected'],
      size: '4"',
    };

    const ctx: PersistContext = {
      jobId: '00000000-0000-0000-0000-000000000001',
      docId: '00000000-0000-0000-0000-000000000002',
      filename: 'PID-001.pdf',
      legendSymbols: [],
      nullThreshold: 0.65,
      effectiveLegendId: null,
    };

    await persistDetections(mockDb, [det], ctx, 1);

    const insertQuery = executedQueries.find(q => q.text.includes('INSERT INTO detections'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.text).toContain('size');
    expect(insertQuery?.params).toContain('4"');
  });
});
