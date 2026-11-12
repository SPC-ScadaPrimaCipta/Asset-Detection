import { assembleMdoDescription, cleanMdoFieldValue } from '@/lib/mdo-description';

describe('assembleMdoDescription - PT Accenture Indonesia Description Rule', () => {
  it('Example 1: correctly formats Pipe without FROM', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'MTR-',
      equipmentTypeShort: 'PIPE',
      size: '2',
      ofValue: 'METERING B',
      fromValue: null,
      toValue: 'VENT',
    });
    expect(desc).toBe('MTR-PIPE 2" OF METERING B TO VENT');
  });

  it('Example 2: correctly formats Pipe with both FROM and TO', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'MTR-',
      equipmentTypeShort: 'PIPE',
      size: '2',
      ofValue: 'PIGR PHASE 2',
      fromValue: 'GRS',
      toValue: 'SUMP TANK',
    });
    expect(desc).toBe('MTR-PIPE 2" OF PIGR PHASE 2 FROM GRS TO SUMP TANK');
  });

  it('Example 3: correctly formats Press Gauge without Size and enforces Instrument Rule (no FROM/TO, uses OF & AT)', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'MTR-',
      equipmentTypeShort: 'PG',
      size: null,
      ofValue: 'JMPR LINE',
      fromValue: 'SDV-101', // Should be omitted
      toValue: 'S CATCHER',  // Should be omitted
      atValue: 'S CATCHER',
    });
    expect(desc).toBe('MTR-PG OF JMPR LINE AT S CATCHER');
  });

  it('Example 4: correctly formats Check Valve (CKV)', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'MTR-',
      equipmentTypeShort: 'CKV',
      size: '4',
      ofValue: 'DRAIN S CATCHER',
      fromValue: null,
      toValue: 'SUMP TANK',
    });
    expect(desc).toBe('MTR-CKV 4" OF DRAIN S CATCHER TO SUMP TANK');
  });

  it('Example 5: correctly formats Ball Valve (BV)', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'MTR-',
      equipmentTypeShort: 'BV',
      size: '2',
      ofValue: 'S CATCHER',
      fromValue: null,
      toValue: 'MEASURING LEVEL',
    });
    expect(desc).toBe('MTR-BV 2" OF S CATCHER TO MEASURING LEVEL');
  });

  it('User Example: Pressure Transmitter enforces Instrument Rule (no FROM/TO, uses OF & AT)', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'GRS',
      equipmentTypeShort: 'PT',
      size: '1/2"',
      ofValue: 'FUEL GAS SYSTEM',
      fromValue: 'SDV-101', // Should be omitted
      toValue: 'PRESSURE TRANSMITTER A', // Should be omitted
      atValue: 'WELLHEAD',
    });
    expect(desc).toBe('GRS-PT 1/2" OF FUEL GAS SYSTEM AT WELLHEAD');
  });

  it('handles clean omission when OF, FROM, or TO are empty or dash', () => {
    const desc = assembleMdoDescription({
      locationPrefix: 'GRS-',
      equipmentTypeShort: 'P',
      size: '3',
      ofValue: '-',
      fromValue: 'TK-100',
      toValue: 'V-200',
    });
    expect(desc).toBe('GRS-P 3" FROM TK-100 TO V-200');
  });

  it('strips redundant leading FROM/TO/OF from input values', () => {
    expect(cleanMdoFieldValue('FROM SDV-1012')).toBe('SDV-1012');
    expect(cleanMdoFieldValue('TO VENT')).toBe('VENT');
    expect(cleanMdoFieldValue('OF HEADER LINE')).toBe('HEADER LINE');
  });
});
