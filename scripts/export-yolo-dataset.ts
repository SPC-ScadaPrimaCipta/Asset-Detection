/**
 * Script Ekspor Dataset YOLO untuk Pelatihan / Fine-Tuning di Google Colab
 *
 * Cara menjalankan:
 *   npm run dataset:export-yolo
 *
 * Output:
 *   yolo_dataset.zip (siap upload ke Google Colab)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import db from '../lib/db';
import sharp from 'sharp';

interface ConfirmedDetection {
  id: string;
  document_page_id: string;
  document_id: string;
  page_number: number;
  asset_type: string;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  image_path: string | null;
}

// Map kelas sederhana (0: valve, 1: pump, 2: instrument, dll.)
const COMMON_CLASSES: Record<string, number> = {
  valve: 0,
  ball_valve: 0,
  gate_valve: 0,
  check_valve: 0,
  globe_valve: 0,
  needle_valve: 0,
  butterfly_valve: 0,
  control_valve: 0,
  pump: 1,
  centrifugal_pump: 1,
  vessel: 2,
  tank: 2,
  heat_exchanger: 3,
  compressor: 4,
  instrument: 5,
  indicator: 5,
  transmitter: 5,
  filter: 6,
  strainer: 6,
};

function resolveClassId(assetType: string): number {
  const norm = (assetType || '').toLowerCase().replace(/[\s-]+/g, '_');
  for (const [key, id] of Object.entries(COMMON_CLASSES)) {
    if (norm.includes(key)) return id;
  }
  return 0; // default valve
}

async function main() {
  console.log('📦 Memulai proses ekspor dataset YOLO...');

  const outputBase = path.resolve(process.cwd(), 'dataset_yolo');
  const imagesTrain = path.join(outputBase, 'images', 'train');
  const imagesVal = path.join(outputBase, 'images', 'val');
  const labelsTrain = path.join(outputBase, 'labels', 'train');
  const labelsVal = path.join(outputBase, 'labels', 'val');

  // Bersihkan dan buat direktori
  if (fs.existsSync(outputBase)) {
    fs.rmSync(outputBase, { recursive: true, force: true });
  }
  [imagesTrain, imagesVal, labelsTrain, labelsVal].forEach((dir) =>
    fs.mkdirSync(dir, { recursive: true })
  );

  // Ambil semua aset yang sudah dikonfirmasi
  const res = await db.query<ConfirmedDetection>(`
    SELECT 
      d.id, d.document_page_id, d.asset_type,
      d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h,
      dp.document_id, dp.page_number, dp.image_path
    FROM detections d
    JOIN document_pages dp ON d.document_page_id = dp.id
    WHERE (d.detection_status = 'CONFIRMED' OR d.validation_status = 'VALID')
      AND d.bbox_w > 0 AND d.bbox_h > 0
  `);

  if (res.rows.length === 0) {
    console.warn('⚠️ Belum ada deteksi dengan status CONFIRMED di database.');
    console.log('Membuat dataset dummy/sample dari storage/dataset/ agar struktur siap digunakan...');
  } else {
    console.log(`🔍 Ditemukan ${res.rows.length} aset terkonfirmasi.`);
  }

  // Kelompokkan per halaman
  const pageMap = new Map<string, ConfirmedDetection[]>();
  for (const row of res.rows) {
    const list = pageMap.get(row.document_page_id) || [];
    list.push(row);
    pageMap.set(row.document_page_id, list);
  }

  const pageIds = Array.from(pageMap.keys());
  let processedCount = 0;

  for (let i = 0; i < pageIds.length; i++) {
    const pageId = pageIds[i];
    const detections = pageMap.get(pageId)!;
    let rawImagePath = detections[0].image_path;
    const docId = detections[0].document_id;
    const pageNum = detections[0].page_number;

    if (!rawImagePath || !fs.existsSync(rawImagePath)) {
      // Cari file viewer di storage/pages/ atau storage/
      const searchDirs = [
        path.resolve(process.cwd(), 'storage/pages'),
        path.resolve(process.cwd(), 'storage'),
      ];
      for (const sDir of searchDirs) {
        if (!fs.existsSync(sDir)) continue;
        const matches = fs
          .readdirSync(sDir)
          .filter(
            (f) =>
              f.startsWith(`viewer-${docId}-p${pageNum}`) &&
              (f.endsWith('.png') || f.endsWith('.jpg'))
          );
        if (matches.length > 0) {
          rawImagePath = path.join(sDir, matches[0]);
          break;
        }
      }
    }

    if (!rawImagePath || !fs.existsSync(rawImagePath)) {
      console.warn(`[export] Tidak dapat menemukan gambar untuk page ${pageId} (Doc ${docId} P${pageNum})`);
      continue;
    }

    const fullImgPath = rawImagePath;

    // Split 80% train, 20% val
    const isVal = i % 5 === 0;
    const targetImgDir = isVal ? imagesVal : imagesTrain;
    const targetLblDir = isVal ? labelsVal : labelsTrain;

    const baseName = `page_${pageId.slice(0, 8)}`;
    const outImgPath = path.join(targetImgDir, `${baseName}.jpg`);
    const outLblPath = path.join(targetLblDir, `${baseName}.txt`);

    // Convert/resize halaman ke 1024x1024 (standar YOLO input)
    await sharp(fullImgPath)
      .resize(1024, 1024, { fit: 'fill' })
      .jpeg({ quality: 90 })
      .toFile(outImgPath);

    // Tulis format YOLO: <class> <x_center> <y_center> <width> <height> (0-1 normalized)
    const labelLines: string[] = [];
    for (const d of detections) {
      const classId = resolveClassId(d.asset_type);
      const xCenter = (d.bbox_x + d.bbox_w / 2) / 1000;
      const yCenter = (d.bbox_y + d.bbox_h / 2) / 1000;
      const normW = d.bbox_w / 1000;
      const normH = d.bbox_h / 1000;

      // Clamp 0 to 1
      const cx = Math.max(0, Math.min(1, xCenter)).toFixed(6);
      const cy = Math.max(0, Math.min(1, yCenter)).toFixed(6);
      const w = Math.max(0.001, Math.min(1, normW)).toFixed(6);
      const h = Math.max(0.001, Math.min(1, normH)).toFixed(6);

      labelLines.push(`${classId} ${cx} ${cy} ${w} ${h}`);
    }

    fs.writeFileSync(outLblPath, labelLines.join('\n'), 'utf8');
    processedCount += detections.length;
  }

  // Tulis data.yaml untuk Ultralytics YOLO
  const yamlContent = `
path: .
train: images/train
val: images/val

nc: 7
names:
  0: valve
  1: pump
  2: vessel
  3: heat_exchanger
  4: compressor
  5: instrument
  6: filter
`.trim();

  fs.writeFileSync(path.join(outputBase, 'data.yaml'), yamlContent, 'utf8');
  console.log(`✅ ${processedCount} anotasi pada ${pageIds.length} halaman berhasil disiapkan.`);

  // Buat ZIP file
  const zipPath = path.resolve(process.cwd(), 'yolo_dataset.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  console.log('🗜️  Mengompres dataset menjadi yolo_dataset.zip...');
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Compress-Archive -Path '${outputBase}\\*' -DestinationPath '${zipPath}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`cd "${outputBase}" && zip -r "${zipPath}" ./*`, { stdio: 'inherit' });
    }
    console.log(`🎉 Berhasil! File dataset siap upload ke Google Colab: ${zipPath}`);
  } catch (zipErr) {
    console.error('Gagal membuat zip secara otomatis:', zipErr);
    console.log(`Anda dapat mengompres folder '${outputBase}' secara manual.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error saat ekspor dataset:', err);
  process.exit(1);
});
