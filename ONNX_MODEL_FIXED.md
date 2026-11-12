# Python Service - Fixed untuk ONNX Model

## ✅ FIXED Issues:

1. **Model Path:** Changed dari `models/best.pt` → `model/yolo-pid.onnx`
2. **Config:** Updated `config.py` untuk gunakan ONNX model
3. **Detection Worker:** Support ONNX format (Ultralytics auto-detect)

---

## 🚀 Start Service (MANUAL - 3 Terminals Required)

### Terminal 1: Python FastAPI Service
```bash
cd workers/python
python api_service.py
```

Wait untuk message:
```
INFO:     Uvicorn running on http://127.0.0.1:8765
```

### Terminal 2: Next.js Dev Server
```bash
npm run dev
```

### Terminal 3: BullMQ Worker
```bash
npm run worker
```

---

## ✅ Test Service

Setelah Terminal 1 running, test di terminal baru:

```bash
curl http://127.0.0.1:8765/health
```

Expected response:
```json
{"status":"ok","service":"TagFlow Python Workers"}
```

---

## 🧪 E2E Test

```bash
python test/e2e_hybrid_detection.py
```

---

## 📋 Files Modified (Latest)

- ✅ `workers/python/config.py` — Changed `YOLO_MODEL_PATH` to `model/yolo-pid.onnx`
- ✅ `workers/python/detection_worker.py` — Updated default path
- ✅ `workers/python/requirements.txt` — Added `pydantic-settings`

---

## ⚠️ IMPORTANT

**Model yang digunakan:** `model/yolo-pid.onnx` (ONNX format)

Ultralytics YOLO support ONNX natively:
```python
from ultralytics import YOLO
model = YOLO('model/yolo-pid.onnx')  # ✅ Works
```

Tidak perlu convert `.onnx` → `.pt`.

---

## 🐛 Troubleshooting

### Service not starting
```bash
# Check port 8765
netstat -ano | findstr :8765

# Kill if occupied
taskkill /F /PID <PID>
```

### Model not found
```bash
# Verify file exists
dir model\yolo-pid.onnx
```

Should show:
```
yolo-pid.onnx
```

### Import errors
```bash
pip install -r workers/python/requirements.txt
```

---

**Status:** ✅ Ready to start (ONNX model detected)

**Next:** Run Terminal 1 command above
