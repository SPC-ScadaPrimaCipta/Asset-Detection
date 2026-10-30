import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

interface Candidate {
  classId: number;
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

async function main() {
  const candidatesPath = path.resolve(process.cwd(), 'storage/yolo-candidates-all-pages.json');
  if (!fs.existsSync(candidatesPath)) {
    console.error('Candidates file not found:', candidatesPath);
    return;
  }

  const candidates: Record<string, Candidate[]> = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
  const outDir = path.resolve(process.cwd(), 'storage/annotation-inspection-crops');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let totalCrops = 0;
  for (const [pageId, dets] of Object.entries(candidates)) {
    const pageDir = path.join(outDir, pageId);
    if (!fs.existsSync(pageDir)) {
      fs.mkdirSync(pageDir, { recursive: true });
    }

    let imgFolder = pageId.replace('-p1', '').replace('-p2', '');
    if (pageId.startsWith('fire-water')) {
      imgFolder = 'fire-water';
    }
    const pageNum = pageId.endsWith('-p2') ? 2 : 1;
    const imgPath = path.resolve(process.cwd(), 'fixtures/pid-eval', imgFolder, `page_${pageNum}.png`);

    if (!fs.existsSync(imgPath)) {
      console.log('Image not found for', pageId, imgPath);
      continue;
    }

    const meta = await sharp(imgPath).metadata();
    const pageW = meta.width || 3573;
    const pageH = meta.height || 2526;

    for (let i = 0; i < dets.length; i++) {
      const d = dets[i];
      const pad = 40;
      const x = Math.max(0, d.bbox.x - pad);
      const y = Math.max(0, d.bbox.y - pad);
      const w = Math.min(pageW - x, d.bbox.width + pad * 2);
      const h = Math.min(pageH - y, d.bbox.height + pad * 2);

      if (w <= 0 || h <= 0) continue;

      const safeLabel = d.label.replace(/[^a-zA-Z0-9_]/g, '_');
      const cropPath = path.join(
        pageDir,
        `crop_${String(i).padStart(2, '0')}_${safeLabel}_conf_${d.confidence.toFixed(2)}.png`,
      );

      await sharp(imgPath).extract({ left: x, top: y, width: w, height: h }).toFile(cropPath);
      totalCrops++;
    }
  }

  console.log(`Generated ${totalCrops} candidate inspection crops across all pages.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
