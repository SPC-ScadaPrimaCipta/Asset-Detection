/**
 * Render PDF pages to PNG for manual ground-truth annotation.
 *
 * Run: npx tsx scripts/render-pages-for-annotation.ts <pdf> <output-dir> [scale]
 *
 * Uses the SAME render scale as the production detection pipeline (3.0) so that
 * annotated pixel coordinates match the coordinates YOLO operates on.
 *
 * Output:
 *   <output-dir>/page_1.png, page_2.png, ...
 *   <output-dir>/metadata.json  ({ pages: [{ pageNumber, width, height }] })
 */

import * as fs from 'fs';
import * as path from 'path';
import { renderPageToPng, getPdfPageCountFromBuffer } from '../lib/pdf-render';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/render-pages-for-annotation.ts <pdf> <output-dir> [scale]');
    process.exit(1);
  }

  const pdfPath = path.resolve(process.cwd(), args[0]);
  const outDir = path.resolve(process.cwd(), args[1]);
  const scale = args[2] ? parseFloat(args[2]) : 3.0;

  if (!fs.existsSync(pdfPath)) {
    console.error('PDF not found:', pdfPath);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const buffer = fs.readFileSync(pdfPath);
  const pageCount = await getPdfPageCountFromBuffer(buffer);
  console.log(`PDF: ${path.basename(pdfPath)} — ${pageCount} page(s), scale ${scale}`);

  const pages: Array<{ pageNumber: number; width: number; height: number; file: string }> = [];

  for (let p = 1; p <= pageCount; p++) {
    const { png, width, height } = await renderPageToPng(buffer, p, scale);
    const file = `page_${p}.png`;
    fs.writeFileSync(path.join(outDir, file), png);
    pages.push({ pageNumber: p, width, height, file });
    console.log(`  page ${p}: ${width}x${height} -> ${file}`);
  }

  fs.writeFileSync(
    path.join(outDir, 'metadata.json'),
    JSON.stringify({ sourcePdf: path.basename(pdfPath), scale, pages }, null, 2),
  );

  console.log(`\nWrote ${pages.length} page(s) + metadata.json to ${outDir}`);
  console.log('\nAnnotate these PNGs, then build a ground-truth JSON (see docs/YOLO_EVALUATION_GUIDE.md).');
}

main().catch((e) => {
  console.error('RENDER ERROR:', e);
  process.exit(1);
});
