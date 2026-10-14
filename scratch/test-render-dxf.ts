// Quick test render — run with: npx tsx scratch/test-render-dxf.ts
import { readFileSync, writeFileSync } from 'fs';
import { renderDxfToSvg } from '../lib/dxf-svg-renderer';

const buf = readFileSync('storage/d1973331-9335-497a-a670-6457b6508fd6-INTAN_GS.dxf');
const { svg, extents, entityCount } = renderDxfToSvg(buf);

console.log('entityCount:', entityCount);
console.log('extents:', extents);
console.log('SVG size:', svg.length, 'bytes');
console.log('SVG lines:', svg.split('\n').length);

writeFileSync('scratch/test-output.svg', svg, 'utf-8');
console.log('Written to scratch/test-output.svg');
