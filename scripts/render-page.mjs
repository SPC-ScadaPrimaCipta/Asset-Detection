#!/usr/bin/env node
// ESM script — called via child_process from pdf-render.ts
// Input (stdin): JSON { pdf: "<base64>", page: number, scale: number }
// Output (stdout): JSON { png: "<base64>", width: number, height: number }
//              or: JSON { error: string }

import { createRequire } from 'module';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const { pdf: b64pdf, page: pageNumber, scale } = JSON.parse(input);
    const buffer = Buffer.from(b64pdf, 'base64');

    const { Document, Matrix, ColorSpace } = await import('mupdf');

    const doc = Document.openDocument(buffer, 'application/pdf');
    const pageCount = doc.countPages();

    if (pageNumber < 1 || pageNumber > pageCount) {
      process.stdout.write(JSON.stringify({ error: `Page ${pageNumber} out of range (${pageCount} pages)` }));
      process.exit(0);
    }

    const page = doc.loadPage(pageNumber - 1);
    const matrix = Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(matrix, ColorSpace.DeviceRGB, false);
    const png = pixmap.asPNG();

    process.stdout.write(JSON.stringify({
      png: Buffer.from(png).toString('base64'),
      width: pixmap.w,
      height: pixmap.h,
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e) }));
    process.exit(1);
  }
});
