import * as mupdf from 'mupdf';
import { readFileSync } from 'fs';

const pdfBuf = readFileSync('storage/legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
const page = doc.loadPage(0);

// Get natural page bounds (in PDF points, 1pt = 1/72 inch)
const bounds = page.getBounds();
console.log('PDF page bounds (pt):', JSON.stringify(bounds));

// Render at different scales and check pixel dimensions
for (const scale of [1.0, 1.5, 2.0, 2.5]) {
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  console.log(`scale=${scale}: ${pixmap.getWidth()}x${pixmap.getHeight()} px`);
}

// pdfjs-dist uses 96dpi by default (scale=1 = 72pt -> 72px, but CSS pixels at 96dpi = scale 1.3333)
// pdfjs getViewport({scale: 1}) returns width in CSS pixels where 1pt = 1px
console.log('\npdfjs scale=1 would give:', JSON.stringify(bounds), 'px (pt = px at scale 1)');
console.log('pdfjs scale=2 would give: ~', Math.round((bounds[2]-bounds[0])*2), 'x', Math.round((bounds[3]-bounds[1])*2), 'px');
