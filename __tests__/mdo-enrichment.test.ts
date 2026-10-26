import { buildMdoRecord } from '@/lib/mdo-enrichment';

describe('buildMdoRecord', () => {
  it('returns only requested business fields and uses detected component name', () => {
    const record = buildMdoRecord({
      assetTag: '30756-BV-1001',
      assetType: 'BV',
      description: 'BALL VALVE',
      size: '3/4',
      rawPosition: { x: 100, y: 100 },
    }, []);

    expect(record).toEqual({
      tagNoProposed: '30756-BV-1001',
      equipmentType: 'BV',
      equipmentTypeShort: 'BV',
      equipmentName: 'BV',
      componentName: 'BALL VALVE',
      from: null,
      to: null,
      of: null,
      at: null,
      size: '3/4',
      description: 'BV 3/4"',
      locationPrefix: null,
    });
  });

  it('resolves explicit relation anchors without inventing missing At', () => {
    const record = buildMdoRecord({
      assetTag: '30756-BV-1001',
      assetType: 'BV',
      description: 'BALL VALVE',
      size: '3/4',
      rawPosition: { x: 100, y: 100 },
      relationRadius: 100,
    }, [
      { text: 'FROM CONOCO PHILLIPS', x: 105, y: 100 },
      { text: 'TO SDV-1012', x: 110, y: 100 },
      { text: 'OF PI-1010', x: 115, y: 100 },
    ]);

    expect(record.from).toBe('CONOCO PHILLIPS');
    expect(record.to).toBe('SDV-1012');
    expect(record.of).toBe('PI-1010');
    expect(record.at).toBeNull();
  });
});
