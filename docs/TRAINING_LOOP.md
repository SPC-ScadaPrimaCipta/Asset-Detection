# YOLO Training Loop — Incremental Learning from User Confirmations

## Overview

Sistem learning loop otomatis untuk meningkatkan akurasi YOLO detection model berdasarkan konfirmasi user.

## Workflow

```text
User konfirmasi deteksi
       ↓
[included_in_training = FALSE] marked
       ↓
Dataset stats updated
       ↓
Threshold reached? (50+ samples)
       ↓
Export YOLO dataset
       ↓
[included_in_training = TRUE] marked
       ↓
Training di Google Colab
       ↓
Deploy model baru (yolov11-custom.pt)
       ↓
Worker reload model
       ↓
Deteksi makin akurat ✨
```

## API Endpoints

### GET /api/training/stats

Cek readiness dataset untuk training.

**Response:**
```json
{
  "total_confirmed": 156,
  "by_class": {
    "valve": 45,
    "pump": 32,
    "vessel": 28,
    ...
  },
  "unique_classes": 7,
  "min_samples_per_class": 12,
  "ready_for_training": true,
  "recommendation": "Dataset siap untuk training! Eksport dan jalankan di Google Colab."
}
```

### POST /api/training/export-dataset

Trigger export dataset YOLO ke `yolo_dataset.zip`.

**Response:**
```json
{
  "success": true,
  "stats": {
    "total_confirmed": 156,
    "zip_path": "D:\\Asset-Detection\\yolo_dataset.zip",
    "zip_size_mb": "12.34"
  },
  "message": "Dataset YOLO berhasil diekspor dengan 156 anotasi."
}
```

## Manual Export

```bash
npm run dataset:export-yolo
```

Output: `yolo_dataset.zip` siap upload ke Google Colab.

## Dataset Structure

```
yolo_dataset/
├── images/
│   ├── train/  (80%)
│   └── val/    (20%)
├── labels/
│   ├── train/  (YOLO format txt)
│   └── val/
└── data.yaml
```

## Training di Google Colab

1. Upload `yolo_dataset.zip` ke Colab
2. Unzip & training:

```python
!unzip yolo_dataset.zip -d dataset
!yolo train model=yolov11n.pt data=dataset/data.yaml epochs=50 imgsz=1024
```

3. Download best model: `runs/detect/train/weights/best.pt`
4. Deploy ke `services/cv/models/yolov11-custom.pt`
5. Restart worker: `npm run worker`

## Thresholds

| Parameter | Value | Description |
|-----------|-------|-------------|
| `MIN_SAMPLES_THRESHOLD` | 50 | Total minimum konfirmasi untuk mulai training |
| `MIN_CLASS_SAMPLES` | 10 | Minimum sample per class |

Adjust di `app/api/training/stats/route.ts`.

## Database Schema

### `detections`
- `included_in_training` BOOLEAN — Flag marking sudah diexport
- `training_exported_at` TIMESTAMPTZ — Timestamp export terakhir

### `training_exports`
Log setiap export:
- `confirmed_count` — Total anotasi
- `unique_classes` — Jumlah class unik
- `zip_size_bytes` — Ukuran ZIP
- `exported_at` — Timestamp
- `notes` — Catatan tambahan

## Monitoring

```sql
-- Cek total konfirmasi belum diexport
SELECT COUNT(*) FROM detections 
WHERE (detection_status = 'CONFIRMED' OR validation_status = 'VALID')
  AND included_in_training = FALSE;

-- Distribusi per class
SELECT asset_type, COUNT(*) 
FROM detections 
WHERE detection_status = 'CONFIRMED'
GROUP BY asset_type 
ORDER BY COUNT(*) DESC;

-- History export
SELECT * FROM training_exports ORDER BY exported_at DESC;
```

## Automation (Future)

Tambahkan cron job atau BullMQ scheduler:

```typescript
// workers/training-scheduler.ts
import { Queue, Worker } from 'bullmq';

const trainingQueue = new Queue('training-export', {
  connection: { host: 'localhost', port: 6379 }
});

// Trigger setiap hari jam 2 pagi
await trainingQueue.add('daily-export', {}, {
  repeat: { pattern: '0 2 * * *' }
});
```

## Best Practices

1. **Incremental learning:** Export berkala (weekly) untuk fine-tune model
2. **Class balance:** Pastikan semua class punya minimal 10 sample
3. **Quality over quantity:** Reject deteksi buruk sebelum confirm
4. **Version control:** Simpan setiap trained model dengan timestamp
5. **A/B testing:** Deploy model baru di shadow mode dulu, compare accuracy

## Troubleshooting

**Q: Export gagal "Tidak ada deteksi terkonfirmasi"**  
A: Pastikan user sudah confirm deteksi via UI atau API `/api/detections/[id]/confirm`

**Q: Model baru tidak membaik**  
A: Cek distribusi class — mungkin ada class dengan sample terlalu sedikit

**Q: ZIP file terlalu besar**  
A: Filter hanya deteksi confidence > 0.8, atau gunakan incremental export

## References

- YOLO v11 Docs: https://docs.ultralytics.com/
- Training Custom YOLO: https://docs.ultralytics.com/modes/train/
- Google Colab: https://colab.research.google.com/
