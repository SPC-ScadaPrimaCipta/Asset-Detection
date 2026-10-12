import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// Helper to inspect sections of any page
async function cropArea(pageId: string, imgPath: string, rect: { x: number; y: number; w: number; h: number }, outName: string) {
  const outDir = path.resolve(process.cwd(), 'storage/inspection-crops-custom', pageId);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const meta = await sharp(imgPath).metadata();
  const pageW = meta.width || 3573;
  const pageH = meta.height || 2526;

  const x = Math.max(0, Math.min(rect.x, pageW - 10));
  const y = Math.max(0, Math.min(rect.y, pageH - 10));
  const w = Math.min(pageW - x, rect.w);
  const h = Math.min(pageH - y, rect.h);

  const outPath = path.join(outDir, outName);
  await sharp(imgPath).extract({ left: x, top: y, width: w, height: h }).toFile(outPath);
  return outPath;
}

async function main() {
  console.log('Custom crop tool ready');
}

main();
