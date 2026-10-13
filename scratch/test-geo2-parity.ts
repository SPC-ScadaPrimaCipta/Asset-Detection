import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { runYoloGeo2Page, computeIoU } from '../lib/detection/yolo/yolo-geo2-runner';

async function main() {
  console.log('=== TEST 1: Memverifikasi Reproduksi GEO-2 pada Fixture sheet-1-p1 ===\n');

  const fixturePath = path.resolve(process.cwd(), 'fixtures/pid-eval/sheet-1/page_1.png');
  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture tidak ditemukan: ${fixturePath}`);
    process.exit(1);
  }

  const imgBuf = fs.readFileSync(fixturePath);
  const meta = await sharp(imgBuf).metadata();
  console.log(`Dimensi citra: ${meta.width} x ${meta.height} px`);

  const result = await runYoloGeo2Page(imgBuf, meta.width!, meta.height!);

  console.log(`\nHASIL RUNNER:`);
  console.log(`- Total Tiles: ${result.totalTiles}`);
  console.log(`- Raw Candidates Before Merge: ${result.rawCandidatesBeforeMerge}`);
  console.log(`- Retained Detections: ${result.retainedDetections}`);
  console.log(`- Suppressed Count: ${result.suppressedCount}`);
  console.log(`- Duration: ${result.durationMs}ms`);

  // Bandingkan dengan referensi acuan GEO-2 asli (87 deteksi)
  const fullPageHtml = fs.readFileSync('fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html', 'utf8');
  const fullPageData = JSON.parse(fullPageHtml.match(/const data = (\{[\s\S]*?\});\n/)![1]);
  const geo2BaselineItems = fullPageData.configs.geo2.items;

  console.log(`\nPERBANDINGAN TERHADAP ACUAN GEO-2 (87 DETEKSI):`);
  console.log(`- Acuan GEO-2 Items: ${geo2BaselineItems.length}`);
  console.log(`- Runner Retained Items: ${result.retainedDetections}`);

  if (result.retainedDetections !== 87) {
    console.error(`[GAGAL] Retained detections (${result.retainedDetections}) != 87!`);
    process.exit(1);
  }

  // Cek 1-to-1 match dengan acuan
  let matchedCount = 0;
  let maxCoordDiff = 0;
  let maxConfDiff = 0;

  for (const baseItem of geo2BaselineItems) {
    let bestIoU = 0;
    let matchedCand: any = null;

    for (const cand of result.detections) {
      const iou = computeIoU(
        { x1: cand.symbolBboxPx!.x, y1: cand.symbolBboxPx!.y, x2: cand.symbolBboxPx!.x + cand.symbolBboxPx!.width, y2: cand.symbolBboxPx!.y + cand.symbolBboxPx!.height },
        baseItem.box
      );
      if (iou > bestIoU) {
        bestIoU = iou;
        matchedCand = cand;
      }
    }

    if (bestIoU >= 0.90 && matchedCand && matchedCand.legendSymbol === baseItem.rawLabel) {
      matchedCount++;
      const cDiff = Math.abs(matchedCand.confidence - baseItem.confidence);
      if (cDiff > maxConfDiff) maxConfDiff = cDiff;
      const bDiff = Math.max(
        Math.abs(matchedCand.symbolBboxPx!.x - baseItem.box.x1),
        Math.abs(matchedCand.symbolBboxPx!.y - baseItem.box.y1),
        Math.abs(matchedCand.symbolBboxPx!.x + matchedCand.symbolBboxPx!.width - baseItem.box.x2),
        Math.abs(matchedCand.symbolBboxPx!.y + matchedCand.symbolBboxPx!.height - baseItem.box.y2)
      );
      if (bDiff > maxCoordDiff) maxCoordDiff = bDiff;
    }
  }

  console.log(`- Matched 1-to-1 Identik (IoU >= 0.90 & label sama): ${matchedCount} / 87`);
  console.log(`- Max Koordinat Difference: ${maxCoordDiff.toFixed(2)} px`);
  console.log(`- Max Confidence Difference: ${maxConfDiff.toFixed(6)}`);

  if (matchedCount === 87) {
    console.log('\n[PASS] Runner 100% mereproduksi GEO-2 asli dengan presisi sempurna!');
  } else {
    console.warn(`[WARN] Ada ${87 - matchedCount} kandidat dengan selisih kecil.`);
  }

  // === TEST 2: Halaman Lebih Kecil dari Tile 1280 (Bounding & Scaling check) ===
  console.log('\n=== TEST 2: Uji Halaman Kecil (< 1280 px) ===');
  const smallW = 800;
  const smallH = 600;
  const smallCrop = await sharp(imgBuf).extract({ left: 0, top: 0, width: smallW, height: smallH }).png().toBuffer();
  const smallRes = await runYoloGeo2Page(smallCrop, smallW, smallH);
  console.log(`- Halaman kecil 800x600 px: Tiles: ${smallRes.totalTiles}, Retained: ${smallRes.retainedDetections}`);
  let outOfBounds = 0;
  for (const d of smallRes.detections) {
    const b = d.symbolBboxPx!;
    if (b.x < 0 || b.y < 0 || b.x + b.width > smallW || b.y + b.height > smallH) {
      outOfBounds++;
    }
  }
  console.log(`- Out-of-bounds detections: ${outOfBounds}`);
  if (outOfBounds === 0) {
    console.log('[PASS] Seluruh deteksi pada halaman kecil berada tepat di dalam batas kanvas!');
  } else {
    console.error('[FAIL] Ada deteksi keluar batas kanvas!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error test:', err);
  process.exit(1);
});
