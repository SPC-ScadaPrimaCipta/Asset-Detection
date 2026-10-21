/**
 * Scratch: time the DXF pipeline stages to see where latency actually is.
 * Usage: npx tsx scratch/timing-dxf.ts [filename]
 */
import { readFileSync } from 'node:fs';
import { parseDxf, splitDxfRegions } from '../lib/dxf-parser';
import { runDxfDetection } from '../lib/dxf-detection';

const file = process.argv[2] ?? 'storage/702b312c-ff9c-43d6-a983-58fd5344625f-INTAN_GS_SHEET_5.dxf';
const buf = readFileSync(file);
console.log('file:', file, `(${(buf.length / 1e6).toFixed(2)} MB)`);

const t0 = performance.now();
const parsed = parseDxf(buf);
const t1 = performance.now();
console.log(`parseDxf        : ${(t1 - t0).toFixed(0)} ms  (entities=${parsed.entities?.length ?? '?'})`);

const regions = splitDxfRegions(parsed);
const t2 = performance.now();
console.log(`splitDxfRegions : ${(t2 - t1).toFixed(0)} ms  (regions=${regions.length})`);

const res = runDxfDetection(buf, []);
const t3 = performance.now();
console.log(`runDxfDetection : ${(t3 - t2).toFixed(0)} ms  (detections=${res.detections.length}, geminiCandidates=${res.parseStats?.geminiCandidates})`);
console.log(`TOTAL local     : ${(t3 - t0).toFixed(0)} ms`);
