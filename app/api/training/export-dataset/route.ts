/**
 * POST /api/training/export-dataset
 * Trigger ekspor dataset YOLO dari konfirmasi user (incremental learning)
 */
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

interface TrainingStats {
  total_confirmed: number;
  last_export_count: number;
  last_export_at: string | null;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Check jumlah konfirmasi baru sejak export terakhir
    const statsRes = await db.query<TrainingStats>(`
      SELECT 
        COUNT(*)::int AS total_confirmed,
        0 AS last_export_count,
        NULL AS last_export_at
      FROM detections
      WHERE (detection_status = 'CONFIRMED' OR validation_status = 'VALID')
        AND bbox_w > 0 AND bbox_h > 0
    `);

    const stats = statsRes.rows[0];

    if (stats.total_confirmed === 0) {
      return NextResponse.json({
        error: 'Tidak ada deteksi terkonfirmasi untuk diekspor',
        stats,
      }, { status: 400 });
    }

    // 2. Jalankan export script
    const cwd = process.cwd();
    const exportCmd = 'npm run dataset:export-yolo';

    console.log('[training/export] Memulai ekspor dataset YOLO...');
    const { stdout, stderr } = await execAsync(exportCmd, {
      cwd,
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 300_000, // 5 menit timeout
    });

    console.log('[training/export] stdout:', stdout);
    if (stderr) console.warn('[training/export] stderr:', stderr);

    // 3. Cek hasil file ZIP
    const zipPath = path.join(cwd, 'yolo_dataset.zip');
    const zipExists = fs.existsSync(zipPath);
    const zipSize = zipExists ? fs.statSync(zipPath).size : 0;

    // 4. Log ekspor ke database (opsional: buat tabel training_exports)
    // await db.query(`
    //   INSERT INTO training_exports (confirmed_count, zip_size_bytes, exported_at)
    //   VALUES ($1, $2, NOW())
    // `, [stats.total_confirmed, zipSize]);

    return NextResponse.json({
      success: true,
      stats: {
        total_confirmed: stats.total_confirmed,
        zip_path: zipExists ? zipPath : null,
        zip_size_mb: (zipSize / 1024 / 1024).toFixed(2),
      },
      message: `Dataset YOLO berhasil diekspor dengan ${stats.total_confirmed} anotasi.`,
    });
  } catch (err: any) {
    console.error('[training/export] Error:', err);
    return NextResponse.json({
      error: 'Gagal mengekspor dataset',
      details: err.message,
    }, { status: 500 });
  }
}
