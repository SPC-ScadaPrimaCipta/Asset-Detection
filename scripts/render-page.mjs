#!/usr/bin/env node
// ESM script — called via child_process from pdf-render.ts
// Input (stdin): JSON { pdf: "<base64>", page: number, scale: number, mode?: "render"|"ocr-all" }
// Output (stdout):
//   mode=render: JSON { png: "<base64>", width: number, height: number }
//   mode=ocr-all: JSON { pages: string[] }
//              or: JSON { error: string }

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const { pdf: b64pdf, page: pageNumber, scale, mode = 'render' } = JSON.parse(input);
    const buffer = Buffer.from(b64pdf, 'base64');

    const { Document, Matrix, ColorSpace } = await import('mupdf');
    const doc = Document.openDocument(buffer, 'application/pdf');
    const pageCount = doc.countPages();

    // OCR text extraction mode — extract all pages at once
    if (mode === 'ocr-all') {
      const pages = [];
      for (let i = 0; i < pageCount; i++) {
        try {
          const p = doc.loadPage(i);
          const structured = p.toStructuredText('preserve-whitespace');
          pages.push(structured.asText().slice(0, 12000));
        } catch {
          pages.push('');
        }
      }
      process.stdout.write(JSON.stringify({ pages }));
      return;
    }

    // Default: render single page to PNG
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
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e) }));
    process.exit(1);
  }
});
