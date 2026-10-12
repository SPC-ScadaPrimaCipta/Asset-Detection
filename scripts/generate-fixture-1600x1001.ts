#!/usr/bin/env tsx
/**
 * Script to extract non-square crop 1600x1001 directly from source full-sheet P&ID image
 * Source: fixtures/pid-eval/sheet-1/page_1.png (3573 x 2526)
 * Output: fixtures/Sheet_1-1__crop_1600x1001.png (1600 x 1001)
 *
 * Crop Coordinates:
 *   left: 0, top: 0, width: 1600, height: 1001
 *
 * Mathematical characteristics for 1024x1024 letterbox:
 *   scale = 1024 / 1600 = 0.64
 *   scaledW = 1024
 *   scaledH = round(1001 * 0.64) = 641
 *   padX = 0
 *   padY = floor((1024 - 641) / 2) = 191
 *   bottomPad = 1024 - 641 - 191 = 192
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';

async function main() {
  const sourcePath = path.resolve(process.cwd(), 'fixtures/pid-eval/sheet-1/page_1.png');
  const targetPath = path.resolve(process.cwd(), 'fixtures/Sheet_1-1__crop_1600x1001.png');

  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source full-sheet image not found at: ${sourcePath}`);
    process.exit(1);
  }

  const sourceBuffer = fs.readFileSync(sourcePath);
  const sourceSha = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

  const sourceMeta = await sharp(sourceBuffer).metadata();
  console.log('Source Image:');
  console.log(`  Path   : ${sourcePath}`);
  console.log(`  Size   : ${sourceMeta.width} x ${sourceMeta.height}`);
  console.log(`  SHA-256: ${sourceSha}`);

  if (sourceMeta.width !== 3573 || sourceMeta.height !== 2526) {
    console.warn(`⚠️ Warning: Expected 3573x2526, found ${sourceMeta.width}x${sourceMeta.height}`);
  }

  const cropLeft = 0;
  const cropTop = 0;
  const cropWidth = 1600;
  const cropHeight = 1001;

  await sharp(sourceBuffer)
    .extract({
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toFile(targetPath);

  const croppedBuffer = fs.readFileSync(targetPath);
  const croppedSha = crypto.createHash('sha256').update(croppedBuffer).digest('hex');
  const croppedMeta = await sharp(croppedBuffer).metadata();

  console.log('\nCropped Fixture:');
  console.log(`  Path   : ${targetPath}`);
  console.log(`  Size   : ${croppedMeta.width} x ${croppedMeta.height}`);
  console.log(`  SHA-256: ${croppedSha}`);
  console.log(`  Crop Coordinates: left=${cropLeft}, top=${cropTop}, width=${cropWidth}, height=${cropHeight}`);
  console.log('✅ Fixture generated successfully.');
}

main().catch((err) => {
  console.error('Fatal error generating fixture:', err);
  process.exit(1);
});
