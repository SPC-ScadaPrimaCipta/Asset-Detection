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

  it('strictly forces from and to to null for instruments (e.g. PT)', () => {
    const record = buildMdoRecord({
      assetTag: '30756-PT-1001',
      assetType: 'PT',
      description: 'PRESSURE TRANSMITTER',
      size: '1/2',
      rawPosition: { x: 100, y: 100 },
      relationRadius: 100,
      locationPrefix: 'GRS',
    }, [
      { text: 'FROM CONOCO PHILLIPS', x: 105, y: 100 },
      { text: 'TO SDV-1012', x: 110, y: 100 },
      { text: 'OF HEADER LINE', x: 115, y: 100 },
      { text: 'AT WELLHEAD', x: 120, y: 100 },
    ]);

    expect(record.from).toBeNull();
    expect(record.to).toBeNull();
    expect(record.of).toBe('HEADER LINE');
    expect(record.at).toBe('WELLHEAD');
    expect(record.description).toBe('GRS-PT 1/2" OF HEADER LINE AT WELLHEAD');
  });
});
