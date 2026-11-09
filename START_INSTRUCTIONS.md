# 🚀 START TAGFLOW - SIMPLE INSTRUCTIONS

## Option 1: Auto-Start (Recommended)

Double-click:
```
START_ALL_SERVICES.bat
```

This will open 3 terminal windows automatically.

---

## Option 2: Manual Start (3 Terminals)

### Terminal 1 - Python Service
```bash
cd workers/python
python api_service.py
```

Wait for:
```
INFO:     Uvicorn running on http://127.0.0.1:8765
```

### Terminal 2 - Next.js Dev
```bash
npm run dev
```

Wait for:
```
Ready - started server on http://localhost:3000
```

### Terminal 3 - BullMQ Worker
```bash
npm run worker
```

---

## Verify Everything Works

Run verification script:
```bash
python verify_services.py
```

Expected output:
```
✅ Python Service
✅ Next.js Server
✅ YOLO Model
✅ Database
✅ Redis

Results: 5/5 tests passed

✅ ALL SYSTEMS READY
```

---

## Access Application

Open browser:
```
http://localhost:3000
```

---

## Stop Services

Press `Ctrl+C` in each of the 3 terminal windows.

---

## Troubleshooting

### Port 8765 already in use
```bash
taskkill /F /IM python.exe
```
Then restart Python service.

### Port 3000 already in use
```bash
# Find process
netstat -ano | findstr :3000

# Kill (replace <PID>)
taskkill /F /PID <PID>
```

### Database/Redis not running
Check Docker containers or local PostgreSQL/Redis services.

---

**That's it!** Just 3 terminals, all services ready.
