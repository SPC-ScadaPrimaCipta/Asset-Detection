# Python Service: Troubleshooting & Quick Fix

## Issue Encountered

```
❌ Cannot connect to Python service: Read timed out
```

**Root cause:** YOLO model file missing at `models/best.pt`

---

## ✅ QUICK FIX (Recommended)

Run auto-setup script:

```bash
python setup_model.py
```

Script akan:
1. Create `models/` directory
2. Download YOLOv8n model (~6 MB)
3. Copy ke `models/best.pt`
4. Print next steps

---

## Manual Fix (Alternative)

### Step 1: Create models directory
```bash
mkdir models
```

### Step 2: Download model
```python
python
>>> from ultralytics import YOLO
>>> YOLO('yolov8n.pt').save('models/best.pt')
>>> exit()
```

### Step 3: Verify
```bash
dir models\best.pt
```

---

## Start Services (3 Terminals)

### Terminal 1: Python FastAPI
```bash
python workers/python/api_service.py
```

Wait for:
```
INFO:     Uvicorn running on http://127.0.0.1:8765
```

### Terminal 2: Next.js Dev
```bash
npm run dev
```

### Terminal 3: BullMQ Worker
```bash
npm run worker
```

---

## Test Service

### Health Check
```bash
curl http://127.0.0.1:8765/health
```

Expected:
```json
{"status":"ok","service":"TagFlow Python Workers"}
```

### E2E Test
```bash
python test/e2e_hybrid_detection.py
```

Expected output:
```
✅ Python service healthy
✅ DXF parsing (if sample_pid.dxf exists)
✅ YOLO detection (if sample_pid.png exists)
✅ Spatial matching
⚠️  Learning workflow (manual test required)
```

---

## Common Errors & Fixes

### 1. `FileNotFoundError: models/best.pt`
**Fix:** Run `python setup_model.py`

### 2. `PydanticImportError: BaseSettings moved to pydantic-settings`
**Status:** ✅ Already fixed in code
**Verify:** 
```bash
pip install pydantic-settings
```

### 3. `ModuleNotFoundError: No module named 'ultralytics'`
**Fix:**
```bash
pip install -r workers/python/requirements.txt
```

### 4. Port 8765 already in use
**Fix (Windows):**
```bash
netstat -ano | findstr :8765
taskkill /F /PID <PID>
```

### 5. Service starts but test times out
**Check:**
- Firewall allow Python
- Service logs show `Uvicorn running on http://127.0.0.1:8765`
- Try: `curl -v http://127.0.0.1:8765/health`

---

## Architecture Summary

```
TypeScript Detection Job
       ↓
  HTTP POST /yolo-detect
       ↓
Python FastAPI Service (port 8765)
       ↓
   ┌──────────────────┐
   │ Detection Worker │ → YOLO + pgvector similarity
   │ Spatial Matcher  │ → KDTree tag-to-symbol
   │ Learning Worker  │ → Crop + Embed + DB
   │ DXF Parser       │ → Text grouping + circles
   └──────────────────┘
       ↓
PostgreSQL + pgvector
```

---

## Files Created (Latest Session)

- ✅ `setup_model.py` — Auto-download YOLO model
- ✅ `PYTHON_SERVICE_SETUP.md` — Detailed setup guide
- ✅ `workers/python/test_service.py` — Minimal test service (no YOLO)
- ✅ `start-python-service.bat` — Windows startup script
- ✅ Fixed: `workers/python/config.py` — Pydantic v2 compatibility
- ✅ Fixed: `workers/python/api_service.py` — Lazy YOLO loading
- ✅ Updated: `workers/python/requirements.txt` — Added `pydantic-settings`

---

## Next Steps

1. **Setup model:**
   ```bash
   python setup_model.py
   ```

2. **Start Python service:**
   ```bash
   python workers/python/api_service.py
   ```

3. **Test health:**
   ```bash
   curl http://127.0.0.1:8765/health
   ```

4. **Run E2E test:**
   ```bash
   python test/e2e_hybrid_detection.py
   ```

5. **Manual integration test:**
   - Upload P&ID via UI
   - Run detection
   - Approve detections
   - Verify pgvector embeddings

---

**Status:** 🟡 Ready after model setup

**Estimated setup time:** 2-5 minutes

**Total disk space needed:** ~100 MB (YOLO model + dependencies)
