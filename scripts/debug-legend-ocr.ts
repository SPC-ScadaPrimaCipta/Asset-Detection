import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import { writeFile } from 'fs/promises';

async function main() {
  const pdf = (await getFile(`legend-74cc1ce2-c322-406e-a4fc-6f5aa3526c56.pdf`)) as unknown as Buffer;
  const { png, width, height } = await renderPageToPng(pdf, 1, 1.0);
  await writeFile('logs/legend-p1-s1.png', png);
  console.log(`saved logs/legend-p1-s1.png ${width}x${height}`);
  const res = await fetch('http://127.0.0.1:8001/ocr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pngBase64: png.toString('base64'), ocrProvider: 'tesseract' }),
  });
  const data = await res.json() as { texts: { text: string; confidence: number }[]; warnings: string[]; provider: string };
  console.log('status:', res.status, 'provider:', data.provider);
  console.log('ntexts:', data.texts?.length);
  console.log('texts:', JSON.stringify((data.texts ?? []).slice(0, 15)));
  console.log('warnings:', JSON.stringify(data.warnings));
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
