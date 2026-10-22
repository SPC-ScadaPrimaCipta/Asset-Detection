import { classifyDxfCandidate, extractPidRelations, qualityGate, classifyHybridCandidate } from '@/lib/mdo-pid-rules';
import { buildMdoRecord } from '@/lib/mdo-enrichment';

describe('MDO P&ID rules', () => {
  test('reads FROM and TO continuation text', () => {
    const result = extractPidRelations([
      { text: 'FROM FLARE HEADER', x: 10, y: 20 },
      { text: 'TO WASTE PIT W-0102', x: 90, y: 20 },
    ], { x: 50, y: 20 });
    expect(result.from).toBe('FLARE HEADER');
    expect(result.to).toBe('WASTE PIT W-0102');
  });

  test('reads OF and AT relation text', () => {
    const result = extractPidRelations([
      { text: 'OF PI-1010', x: 50, y: 20 },
      { text: 'AT NOZZLE N1', x: 50, y: 30 },
    ], { x: 50, y: 20 });
    expect(result.of).toBe('PI-1010');
    expect(result.at).toBe('NOZZLE N1');
  });

  test('drops untagged circle without equipment evidence', () => {
    expect(classifyDxfCandidate({ source: 'CIRCLE', assetTag: null, assetType: 'UNKNOWN', evidence: ['CIRCLE entity detected', 'No legend match'] })).toBe('DROP');
  });

  test('keeps tagged vector candidate for review', () => {
    expect(classifyDxfCandidate({ source: 'CIRCLE', assetTag: 'BV-1001', assetType: 'Gate Valve', evidence: [] })).toBe('KEEP');
  });

  test('drops untagged YOLO geometry without OCR source', () => {
    expect(qualityGate({ source: 'YOLO_GEO2', assetTag: null, assetType: 'Valve', confidence: 0.9, evidence: [] })).toBe('DROP');
  });

  test('keeps untagged legend-supported vision candidate for review', () => {
    expect(qualityGate({ source: 'VISION', assetTag: null, assetType: 'Gate Valve', confidence: 0.55, evidence: ['Symbol matches selected Legend: Gate Valve'] })).toBe('REVIEW');
  });

  test('drops synthetic tags even when type is valid', () => {
    expect(qualityGate({ source: 'VISION', assetTag: 'PV-004', assetType: 'Plug Valve', confidence: 0.9, evidence: ['[Auto-Tag] Generated unique project tag PV-004'] })).toBe('DROP');
  });

  test('keeps AI-only legend candidate as review candidate', () => {
    expect(classifyHybridCandidate({ source: 'VISION', assetTag: null, assetType: 'Gate Valve', confidence: 0.7, evidence: ['Legend match: Gate Valve'] })).toBe('REVIEW_CANDIDATE');
  });

  test('keeps vector asset as final candidate', () => {
    expect(classifyHybridCandidate({ source: 'DXF', assetTag: 'V-101', assetType: 'Vessel', confidence: 0.8, evidence: ['Legend match: Vessel'] })).toBe('FINAL');
  });

  test('builds MDO description from resolved relations', () => {
    const row = buildMdoRecord({
      assetTag: 'BV-1001',
      assetType: 'Ball Valve',
      size: '24',
      rawPosition: { x: 50, y: 20 },
    }, [
      { text: 'FROM CONOCO PHILLIPS', x: 10, y: 20 },
      { text: 'TO SDV-1012', x: 90, y: 20 },
      { text: 'OF PI-1010', x: 50, y: 20 },
    ]);
    expect(row.descriptionProposed).toBe('BALL VALVE 24" OF PI-1010 FROM CONOCO PHILLIPS TO SDV-1012');
    expect(row.descriptionLen).toBe(row.descriptionProposed.length);
  });
});
