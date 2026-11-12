import assert from 'node:assert';
import { isInstrumentAsset, assembleMdoDescription } from '../lib/mdo-description';
import { buildMdoRecord, buildPdfMdoRecord } from '../lib/mdo-enrichment';

console.log('--- RUNNING MDO INSTRUMENT RULE VERIFICATION ---');

// 1. Classification Tests
assert.strictEqual(isInstrumentAsset('Pressure Transmitter', 'PT'), true, 'PT is instrument');
assert.strictEqual(isInstrumentAsset('Temperature Transmitter', 'TT'), true, 'TT is instrument');
assert.strictEqual(isInstrumentAsset('Flow Transmitter', 'FT'), true, 'FT is instrument');
assert.strictEqual(isInstrumentAsset('Level Transmitter', 'LT'), true, 'LT is instrument');
assert.strictEqual(isInstrumentAsset('Pressure Gauge', 'PG'), true, 'PG is instrument');
assert.strictEqual(isInstrumentAsset('Pressure Indicator', 'PI'), true, 'PI is instrument');
assert.strictEqual(isInstrumentAsset('Level Gauge', 'LG'), true, 'LG is instrument');
assert.strictEqual(isInstrumentAsset('Analyzer Transmitter', 'AT'), true, 'AT is instrument');

// In-line valves are NOT instruments (they have fluid flow)
assert.strictEqual(isInstrumentAsset('Control Valve', 'CV'), false, 'CV is in-line valve');
assert.strictEqual(isInstrumentAsset('Pressure Safety Valve', 'PSV'), false, 'PSV is safety valve');
assert.strictEqual(isInstrumentAsset('Ball Valve', 'BV'), false, 'BV is valve');
assert.strictEqual(isInstrumentAsset('Check Valve', 'CKV'), false, 'CKV is valve');
assert.strictEqual(isInstrumentAsset('Piping Segment', 'PIPE'), false, 'PIPE is piping');
assert.strictEqual(isInstrumentAsset('Centrifugal Pump', 'P'), false, 'P is pump');
console.log('✓ 1. Classification checks PASSED');

// 2. assembleMdoDescription tests
const ptDesc = assembleMdoDescription({
  locationPrefix: 'GRS',
  equipmentTypeShort: 'PT',
  size: '1/2"',
  ofValue: 'FUEL GAS SYSTEM',
  fromValue: 'SDV-101', // MUST be omitted
  toValue: 'VENT',      // MUST be omitted
  atValue: 'WELLHEAD',
});
assert.strictEqual(ptDesc, 'GRS-PT 1/2" OF FUEL GAS SYSTEM AT WELLHEAD');
console.log('✓ 2. assembleMdoDescription for PT correctly omitted FROM & TO:', ptDesc);

const pgDesc = assembleMdoDescription({
  locationPrefix: 'MTR',
  equipmentTypeShort: 'PG',
  size: '2',
  ofValue: 'HEADER LINE',
  fromValue: 'P-101',
  toValue: 'V-201',
  atValue: 'DISCHARGE NOZZLE',
});
assert.strictEqual(pgDesc, 'MTR-PG 2" OF HEADER LINE AT DISCHARGE NOZZLE');
console.log('✓ 3. assembleMdoDescription for PG correctly omitted FROM & TO:', pgDesc);

// Valves must keep FROM & TO
const bvDesc = assembleMdoDescription({
  locationPrefix: 'GRS',
  equipmentTypeShort: 'BV',
  size: '2',
  ofValue: 'HEADER LINE',
  fromValue: 'SDV-101',
  toValue: 'V-101',
  atValue: 'WELLHEAD',
});
assert.strictEqual(bvDesc, 'GRS-BV 2" OF HEADER LINE FROM SDV-101 TO V-101 AT WELLHEAD');
console.log('✓ 4. assembleMdoDescription for BV correctly kept FROM & TO:', bvDesc);

// 3. buildMdoRecord tests
const mdoRec = buildMdoRecord(
  {
    assetTag: '30756-PT-1001',
    assetType: 'PT',
    description: 'PRESSURE TRANSMITTER',
    size: '1/2',
    rawPosition: { x: 100, y: 100 },
    relationRadius: 100,
    locationPrefix: 'GRS',
  },
  [
    { text: 'FROM CONOCO', x: 105, y: 100 },
    { text: 'TO SDV-101', x: 110, y: 100 },
    { text: 'OF HEADER LINE', x: 115, y: 100 },
    { text: 'AT WELLHEAD', x: 120, y: 100 },
  ],
);
assert.strictEqual(mdoRec.from, null, 'buildMdoRecord forced from to null');
assert.strictEqual(mdoRec.to, null, 'buildMdoRecord forced to to null');
assert.strictEqual(mdoRec.of, 'HEADER LINE', 'buildMdoRecord kept of');
assert.strictEqual(mdoRec.at, 'WELLHEAD', 'buildMdoRecord kept at');
assert.strictEqual(mdoRec.description, 'GRS-PT 1/2" OF HEADER LINE AT WELLHEAD');
console.log('✓ 5. buildMdoRecord for PT PASSED');

// 4. buildPdfMdoRecord tests
const pdfRec = buildPdfMdoRecord({
  detection: {
    id: 'det-1',
    assetTag: 'PT-2001',
    assetType: 'Pressure Transmitter',
    size: '1/2"',
  },
  anchors: [],
  aiRelation: {
    assetTag: 'PT-2001',
    from: 'TK-100',
    to: 'P-101',
    of: 'HP SEPARATOR SYSTEM',
    at: 'SUCTION NOZZLE',
    size: '1/2"',
    direction: 'INLET',
  },
  locationPrefix: 'WHP',
});
assert.strictEqual(pdfRec.from, null, 'buildPdfMdoRecord forced from to null');
assert.strictEqual(pdfRec.to, null, 'buildPdfMdoRecord forced to to null');
assert.strictEqual(pdfRec.of, 'HP SEPARATOR SYSTEM', 'buildPdfMdoRecord kept of');
assert.strictEqual(pdfRec.at, 'SUCTION NOZZLE', 'buildPdfMdoRecord kept at');
assert.strictEqual(pdfRec.description, 'WHP-PT 1/2" OF HP SEPARATOR SYSTEM AT SUCTION NOZZLE');
console.log('✓ 6. buildPdfMdoRecord for PT PASSED');

console.log('--- ALL 6 VERIFICATION CHECKS PASSED SUCCESSFULLY ---');

