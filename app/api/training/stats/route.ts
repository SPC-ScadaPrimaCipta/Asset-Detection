/**
 * GET /api/training/stats
 * Training dataset statistics dan readiness untuk retraining
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

interface TrainingReadiness {
  total_confirmed: number;
  by_class: Record<string, number>;
  unique_classes: number;
  min_samples_per_class: number;
  ready_for_training: boolean;
  recommendation: string;
}

const MIN_SAMPLES_THRESHOLD = 50; // Minimum 50 sample untuk mulai training
const MIN_CLASS_SAMPLES = 10; // Minimum 10 sample per class

export async function GET() {
  try {
    // 1. Total konfirmasi
    const totalRes = await db.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM detections
      WHERE (detection_status = 'CONFIRMED' OR validation_status = 'VALID')
        AND bbox_w > 0 AND bbox_h > 0
    `);

    const total = totalRes.rows[0].count;

    // 2. Distribusi per asset type
    const classRes = await db.query<{ asset_type: string; count: number }>(`
      SELECT 
        LOWER(COALESCE(asset_type, 'unknown')) AS asset_type,
        COUNT(*)::int AS count
      FROM detections
      WHERE (detection_status = 'CONFIRMED' OR validation_status = 'VALID')
        AND bbox_w > 0 AND bbox_h > 0
      GROUP BY LOWER(COALESCE(asset_type, 'unknown'))
      ORDER BY count DESC
    `);

    const byClass: Record<string, number> = {};
    for (const row of classRes.rows) {
      byClass[row.asset_type] = row.count;
    }

    const uniqueClasses = Object.keys(byClass).length;
    const minSamples = Math.min(...Object.values(byClass));

    // 3. Hitung readiness
    const readyForTraining = total >= MIN_SAMPLES_THRESHOLD && minSamples >= MIN_CLASS_SAMPLES;

    let recommendation = '';
    if (total < MIN_SAMPLES_THRESHOLD) {
      recommendation = `Minimal ${MIN_SAMPLES_THRESHOLD} sample diperlukan. Sekarang: ${total}.`;
    } else if (minSamples < MIN_CLASS_SAMPLES) {
      recommendation = `Beberapa kelas kurang dari ${MIN_CLASS_SAMPLES} sample. Tambahkan data untuk kelas yang jarang.`;
    } else {
      recommendation = 'Dataset siap untuk training! Eksport dan jalankan di Google Colab.';
    }

    const stats: TrainingReadiness = {
      total_confirmed: total,
      by_class: byClass,
      unique_classes: uniqueClasses,
      min_samples_per_class: minSamples,
      ready_for_training: readyForTraining,
      recommendation,
    };

    return NextResponse.json(stats);
  } catch (err: any) {
    console.error('[training/stats] Error:', err);
    return NextResponse.json({
      error: 'Gagal mengambil statistik training',
      details: err.message,
    }, { status: 500 });
  }
}
