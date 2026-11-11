# 🚀 TAGFLOW - QUICK START COMMANDS

## ✅ SYSTEM STATUS: 94% READY (30/32 checks passed)

**What's working:**
- ✅ All files in place (YOLO model, Python workers, configs)
- ✅ All dependencies installed (Python + Node)
- ✅ PostgreSQL running (port 5432)
- ✅ Redis running (port 6379)
- ✅ Next.js running (port 3000)

**What needs to start:**
- ⏳ Python service (port 8765)
- ⏳ BullMQ worker

---

## 📋 START COMMANDS

### 1️⃣ Python Service (NEW TERMINAL)
```bash
cd workers/python
python api_service.py
```

**Wait for:**
```
INFO:     Uvicorn running on http://127.0.0.1:8765
```

### 2️⃣ BullMQ Worker (NEW TERMINAL)
```bash
npm run worker
```

**Wait for:**
```
Worker started and listening for jobs...
```

### 3️⃣ Access App
```
http://localhost:3000
```

---

## ✅ VERIFY

```bash
# Check all services
python system_check.py

# Test Python service
curl http://127.0.0.1:8765/health

# Run E2E test
python test/e2e_hybrid_detection.py
```

---

## 🛑 STOP SERVICES

Press `Ctrl+C` in each terminal window.

Or:
```bash
taskkill /F /IM python.exe
taskkill /F /IM node.exe
```

---

## 📊 QUICK TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| Port 8765 occupied | `taskkill /F /IM python.exe` |
| Port 3000 occupied | `taskkill /F /IM node.exe` |
| Python import error | `cd workers/python && pip install -r requirements.txt` |
| Database error | Check `.env.local` DATABASE_URL |

---

## 📁 IMPORTANT FILES

| File | Purpose |
|------|---------|
| `model/yolo-pid.onnx` | YOLO model (98.9 MB) ✅ |
| `workers/python/api_service.py` | Python FastAPI service ✅ |
| `.env.local` | Environment config ✅ |
| `system_check.py` | Full verification script ✅ |

---

## 🎯 WORKFLOW

1. Start Python service (Terminal 1)
2. Start BullMQ worker (Terminal 2)
3. Open http://localhost:3000
4. Upload P&ID document
5. Run detection
6. Review & approve results
7. Export Asset Register

---

**That's it! System is 94% ready, just start 2 services.**

**Full docs:** `FINAL_VERIFICATION_REPORT.md`
