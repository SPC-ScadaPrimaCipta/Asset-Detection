import mupdf from 'mupdf';
import fs from 'fs';

const { Document, Matrix, ColorSpace } = mupdf;
const buf = fs.readFileSync('D:\\Asset-Detection\\storage\\legend-7045609b-cede-4509-b480-4d5a555f3fd7.pdf');
const doc = Document.openDocument(buf, 'application/pdf');
console.log('Pages:', doc.countPages());
const page = doc.loadPage(0);
const pixmap = page.toPixmap(Matrix.scale(1, 1), ColorSpace.DeviceRGB, false);
console.log('Render OK:', pixmap.getWidth(), 'x', pixmap.getHeight());
