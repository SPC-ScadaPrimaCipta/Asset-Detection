import {
  applyFieldConfidenceGate,
  formatEmbeddingForPg,
  normalizeAssetTag,
  persistDetections,
  resolveLegendSymbolId,
  type DbLike,
  type PersistableDetection,
} from '@/lib/detection/persistence/detection-repository';

const base: PersistableDetection = {
  assetTag: 'JB - 03',
  assetType: 'Junction Box',
  description: 'desc',
  equipmentClass: null,
  service: 'svc',
  location: null,
  unit: null,
  area: null,
  mainEquipment: 'eq',
  legendSymbol: 'Junction Box',
  confidence: 0.9,
  bbox: { x: 100, y: 200, width: 50, height: 60 },
  evidence: ['VISION_DETECTION'],
  detection_source: 'VISION',
  canonical_features: 'shape=rect',
  image_hash: 'abc',
  symbol_embedding: [0.1, 0.2],
  confidence_breakdown: { vision: 0.9 },
  validation_status: 'VALID',
  field_confidence: { service: 0.8, mainEquipment: 0.3, description: 0.9 },
  field_provenance: null,
  audit: null,
};

describe('normalizeAssetTag', () => {
  it('removes spaces around hyphens (worker:426 parity)', () => {
    expect(normalizeAssetTag('JB - 03')).toBe('JB-03');
    expect(normalizeAssetTag('  P-101  ')).toBe('P-101');
    expect(normalizeAssetTag(null)).toBeNull();
  });
});

describe('resolveLegendSymbolId', () => {
  const symbols = [{ id: 's1', asset_type: 'Pump', symbol_name: 'Centrifugal Pump' }];
  it('matches asset_type or symbol_name', () => {
    expect(resolveLegendSymbolId('Pump', symbols)).toBe('s1');
    expect(resolveLegendSymbolId('Centrifugal Pump', symbols)).toBe('s1');
    expect(resolveLegendSymbolId('Valve', symbols)).toBeNull();
    expect(resolveLegendSymbolId(null, symbols)).toBeNull();
  });
});

describe('applyFieldConfidenceGate', () => {
  it('nulls fields below threshold and appends evidence', () => {
    const out = applyFieldConfidenceGate(base, 0.5);
    expect(out.service).toBe('svc'); // 0.8 ≥ 0.5
    expect(out.mainEquipment).toBeNull(); // 0.3 < 0.5
    expect(out.description).toBe('desc');
    expect(out.evidence.join(' ')).toMatch(/mainEquipment/);
  });
});

describe('formatEmbeddingForPg', () => {
  it('formats pgvector literal, null when absent', () => {
    expect(formatEmbeddingForPg([0.1, 0.2])).toBe('[0.1,0.2]');
    expect(formatEmbeddingForPg(null)).toBeNull();
    expect(formatEmbeddingForPg('x')).toBeNull();
  });
});

describe('persistDetections', () => {
  const makeDb = (): DbLike & { calls: { text: string; params: unknown[] }[] } => {
    const calls: { text: string; params: unknown[] }[] = [];
    return {
      calls,
      query: async (text: string, params: unknown[]) => {
        calls.push({ text, params });
        // Simulate pre-migration DB: V2 dual-write UPDATE fails (no columns)
        if (text.startsWith('UPDATE detections')) throw new Error('column does not exist');
        return { rows: [] };
      },
    };
  };

  it('inserts legacy row + attempts V2 dual-write, preserving semantics', async () => {
    const db = makeDb();
    const res = await persistDetections(
      db,
      [base],
      {
        jobId: 'job1',
        docId: 'doc1',
        filename: 'P&ID-001.pdf',
        effectiveLegendId: 'leg1',
        legendSymbols: [{ id: 's1', asset_type: 'Junction Box', symbol_name: 'Junction Box' }],
        nullThreshold: 0.5,
      },
      3
    );
    expect(res.persisted).toBe(1);
    expect(res.ids).toHaveLength(1);
    const insert = db.calls.find((c) => c.text.startsWith('INSERT INTO detections'));
    expect(insert).toBeDefined();
    const p = insert!.params;
    expect(p[1]).toBe('job1'); // job_id
    expect(p[2]).toBe('doc1'); // document_id
    expect(p[3]).toBe('JB-03'); // normalized tag
    expect(p[11]).toBe('P&ID-001.pdf'); // pid_number = filename
    expect(p[12]).toBe(3); // pid_page
    expect(p[14]).toBe('s1'); // legend_symbol_id
    expect(p[24]).toBe('[0.1,0.2]'); // embedding pgvector string
    // V2 dual-write attempted (fails silently pre-migration)
    expect(db.calls.some((c) => c.text.startsWith('UPDATE detections'))).toBe(true);
  });

  it('persists audit via detection audit object (non-fatal)', async () => {
    const db = makeDb();
    let auditId: string | null = null;
    const withAudit: PersistableDetection = {
      ...base,
      audit: {
        setDetectionId: (id: string) => {
          auditId = id;
        },
        persist: async () => {},
      },
    };
    const res = await persistDetections(
      db,
      [withAudit],
      {
        jobId: 'j',
        docId: 'd',
        filename: 'f.pdf',
        effectiveLegendId: null,
        legendSymbols: [],
        nullThreshold: 0.5,
      },
      1
    );
    expect(res.persisted).toBe(1);
    expect(auditId).toBe(res.ids[0]);
  });
});
