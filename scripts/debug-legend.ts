import { createHash } from 'crypto';
import { getFile } from '@/lib/storage';
import { renderPageToPng, getPdfPageCountFromBuffer } from '@/lib/pdf-render';

async function main() {
const legendId = process.argv[2] ?? '74cc1ce2-c322-406e-a4fc-6f5aa3526c56';
const pdf = (await getFile(`legend-${legendId}.pdf`)) as unknown as Buffer;
console.log('legend pdf bytes:', pdf.length, 'sha:', createHash('sha256').update(pdf).digest('hex').slice(0, 12));
const pageCount = await getPdfPageCountFromBuffer(pdf);
console.log('pages:', pageCount);
const pages: { pageNumber: number; pngBase64: string }[] = [];
for (let p = 1; p <= Math.min(pageCount, 3); p++) {
  const { png, width, height } = await renderPageToPng(pdf, p, 3.0);
  console.log(`page ${p}: ${width}x${height} png=${Math.round(png.length / 1024)}KB`);
  pages.push({ pageNumber: p, pngBase64: png.toString('base64') });
}
const res = await fetch('http://127.0.0.1:8001/legend/extract', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    legendId, pages,
    pdfSha256: createHash('sha256').update(pdf).digest('hex'),
    ocrProvider: 'tesseract',
  }),
});
const data = await res.json() as {
  definitions: { label: string; symbolId: string }[];
  debug: { pageNumber: number; visualCount: number; ocrCount: number; associations: unknown[] }[];
  warnings: string[]; timings: unknown[];
};
console.log('defs:', data.definitions?.length, JSON.stringify(data.definitions?.map((d) => d.label)));
console.log('warnings:', JSON.stringify(data.warnings));
for (const d of data.debug ?? []) {
  console.log(`page ${d.pageNumber}: visual=${d.visualCount} ocr=${d.ocrCount}`);
}
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
