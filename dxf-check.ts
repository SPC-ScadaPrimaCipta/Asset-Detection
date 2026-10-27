
import { parseDxf } from './lib/dxf-parser';
import * as fs from 'fs';
import * as path from 'path';

async function diagnoseDxf(filePath: string) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error('File not found:', fullPath);
    return;
  }

  console.log('Reading file:', fullPath);
  const buf = fs.readFileSync(fullPath);
  const parsed = parseDxf(buf);

  console.log('\n=== DXF Diagnostics ===');
  console.log('Total entities:', parsed.entities.length);
  
  const layers = new Set<string>();
  const texts: string[] = [];

  for (const e of parsed.entities) {
    layers.add(e.layer);
    if (e.kind === 'TEXT' || e.kind === 'MTEXT') {
      texts.push(e.text.trim());
    }
  }

  console.log('\n--- Unique Layers ---');
  console.log(Array.from(layers).sort().join('\n'));

  console.log('\n--- First 20 Text Labels ---');
  console.log(texts.slice(0, 20).join('\n'));

  console.log('\n--- Stats ---');
  console.log('Inserts:', parsed.entities.filter(e => e.kind === 'INSERT').length);
  console.log('Circles:', parsed.entities.filter(e => e.kind === 'CIRCLE').length);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: tsx dxf-check.ts <path-to-dxf>');
} else {
  diagnoseDxf(args[0]).catch(console.error);
}
