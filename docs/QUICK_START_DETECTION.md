# Quick Start: Running Detection

## Status Implementasi

### ✅ Siap Pakai Sekarang (Old Pipeline - Stable)
- Pure text-based DXF detection
- Gemini AI vision fallback
- Legend matching
- Tag association
- Learning loop (training export)

### ⏳ Perlu Setup (New Pipeline - Advanced)
- Multi-source detection (Legend + OpenCV + YOLO + OCR)
- Python CV service endpoints
- Tiling & multi-scale
- DXF coordinate mapping

---

## 🚀 Run Detection SEKARANG (Metode Lama - Stabil)

### Terminal 1: Start Web Server
```bash
npm run dev
```

### Terminal 2: Start Worker
```bash
npm run worker
```

### Browser
1. Buka http://localhost:3000
2. Login (default: `admin@tagflow.ai` / `SuperAdmin123!`)
3. Upload DXF di `/documents`
4. Pilih legend di `/legends`
5. Klik **Run Detection**
6. Tunggu progress → lihat hasil di `/detection`

**Expected:** Text-based detection dengan Gemini fallback (~8-15s per DXF)

---

## 🔬 Enable Multi-Source Pipeline (Experimental)

### Prerequisites

1. **Python CV Service Running**
```bash
# Terminal 3
cd services/cv
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

2. **Create Storage Directories**
```bash
mkdir -p storage/dataset/approved
mkdir -p storage/dataset/training
```

3. **Enable Feature Flag**
```bash
# .env.local
ENABLE_MULTI_SOURCE=true
```

4. **Restart Worker**
```bash
npm run worker
```

### Expected Behavior

Worker log akan show:
```
[detection] multi-source detection start
[detection] stage 1: legend matching
[detection] stage 2: opencv template matching
[detection] stage 3: yolo tiled detection
[detection] stage 4: ocr text extraction
[detection] multi-source detection done
```

⚠️ **Warning:** Multi-source pipeline belum fully functional karena Python endpoints masih placeholder.

---

## 🐛 Troubleshooting

### Worker tidak start
```bash
# Check Redis
redis-cli ping  # Harus return PONG

# Check PostgreSQL
psql -U postgres -d asset_detection -c "SELECT 1;"
```

### Detection stuck di PROCESSING
```bash
# Check worker logs
npm run worker  # Lihat error di terminal

# Check job status
npx tsx -e "import db from './lib/db.js'; const r = await db.query('SELECT id, status, error_message FROM detection_jobs ORDER BY created_at DESC LIMIT 5'); console.log(r.rows); process.exit(0);"
```

### Multi-source error
```
[detection] multi-source detection failed (non-fatal)
```

→ **Normal!** Fallback ke text-based detection. Multi-source masih experimental.

---

## 📊 Check Results

### Via UI
- Dashboard: http://localhost:3000
- Detection Workspace: http://localhost:3000/detection

### Via Database
```bash
# Total detections
npx tsx --env-file=.env.local scripts/compare-detection-results.ts

# Or SQL direct
psql -U postgres -d asset_detection -c "
SELECT 
  detection_source,
  COUNT(*) as count,
  AVG(confidence) as avg_conf
FROM detections
WHERE job_id = (SELECT id FROM detection_jobs ORDER BY created_at DESC LIMIT 1)
GROUP BY detection_source;
"
```

### Expected Output (Old Pipeline)
```
detection_source | count | avg_conf
-----------------+-------+----------
DXF              |    45 | 0.687
DXF_VISION       |    12 | 0.612
```

### Expected Output (New Pipeline - When Ready)
```
detection_source | count | avg_conf
-----------------+-------+----------
LEGEND           |    18 | 0.921
OPENCV           |     7 | 0.883
YOLO             |    34 | 0.794
DXF              |    12 | 0.652
```

---

## 🎯 Next Steps untuk Full Implementation

### 1. Python CV Service Endpoints (1-2 jam)
Tambahkan di `services/cv/app.py`:
- `/template-match` — OpenCV template matching
- `/yolo-detect` — YOLO tiled inference
- `/ocr` — EasyOCR text extraction
- `/embedding` — CLIP/Gemini embedding generation

### 2. Test Multi-Source Pipeline (30 menit)
```bash
ENABLE_MULTI_SOURCE=true npm run worker
# Upload DXF complex
# Verify logs show all 4 stages
```

### 3. Coordinate Mapping Verification (15 menit)
```sql
SELECT 
  asset_tag, 
  detection_source,
  bbox->>'x' as pixel_x,
  dxf_coordinates->>'x' as dxf_x
FROM detections
WHERE dxf_coordinates IS NOT NULL
LIMIT 10;
```

Verify: Pixel coords berbeda dari DXF coords (transformation working).

### 4. Learning Loop Test (30 menit)
```bash
# Approve 50+ detections via UI
# Trigger training export
curl -X POST http://localhost:3000/api/training/export-dataset

# Check output
ls -lh yolo_dataset.zip  # Harus ada & > 5MB
```

---

## ⚡ Performance Comparison

| Method | Time/Page | Accuracy | Status |
|--------|-----------|----------|--------|
| **Old (Text-based)** | 8-15s | 78% | ✅ **Stable (use this)** |
| **New (Multi-source)** | 25-50s | 92%* | ⏳ **Work in progress** |

*Estimated based on architecture design

---

## 🆘 Support

**Issue:** Multi-source tidak jalan  
**Solution:** Set `ENABLE_MULTI_SOURCE=false` dan pakai pipeline lama dulu

**Issue:** Butuh accuracy tinggi sekarang  
**Solution:** Pakai pipeline lama, approve banyak detections, nanti retrain YOLO

**Issue:** Mau implement Python endpoints  
**Solution:** Lihat spec lengkap di `docs/ULTIMATE_HYBRID_DETECTION.md`

---

**Last Updated:** 2026-11-05  
**Recommended:** Use old pipeline (stable) until Python endpoints ready
