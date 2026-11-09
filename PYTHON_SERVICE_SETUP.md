# Python Service Quick Start

## Problem: YOLO Model Missing

Service membutuhkan YOLO model di `models/best.pt`. Ada 3 opsi:

### Option 1: Download Pre-trained YOLOv8 (Recommended untuk Testing)

```bash
# Install ultralytics jika belum
pip install ultralytics

# Download model base YOLOv8 nano (paling ringan)
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='pt'); import shutil; shutil.copy('yolov8n.pt', 'models/best.pt')"
```

Atau manual:
```python
from ultralytics import YOLO
import shutil
import os

os.makedirs('models', exist_ok=True)
model = YOLO('yolov8n.pt')  # Auto-download
shutil.copy('yolov8n.pt', 'models/best.pt')
print("✅ Model ready at models/best.pt")
```

### Option 2: Use Trained Model

Jika sudah punya trained model:

```bash
mkdir -p models
cp /path/to/your/trained/model.pt models/best.pt
```

### Option 3: Test Service Only (No YOLO)

Start minimal service tanpa YOLO untuk test connectivity:

```bash
python workers/python/test_service.py
```

Test:
```bash
curl http://127.0.0.1:8765/health
```

## Start Full Service (After Model Ready)

### Terminal 1 - Python Service
```bash
cd workers/python
python api_service.py
```

### Terminal 2 - Next.js Dev
```bash
npm run dev
```

### Terminal 3 - BullMQ Worker
```bash
npm run worker
```

## Verify Service

```bash
# Test Python service health
curl http://127.0.0.1:8765/health

# Expected response:
# {"status":"ok","service":"TagFlow Python Workers"}
```

## Run E2E Test

After service is running:

```bash
python test/e2e_hybrid_detection.py
```

## Troubleshooting

### Port 8765 Already in Use

```bash
# Windows: Find process
netstat -ano | findstr :8765

# Kill process (replace PID)
taskkill /F /PID <PID>
```

### Pydantic Import Error

Fixed: `pydantic-settings` now in requirements.txt

```bash
pip install pydantic-settings
```

### YOLO Model Error

```
FileNotFoundError: models/best.pt
```

Fix: Download model (see Option 1 above)

### Service Starts but Test Timeout

Check firewall:
- Allow Python through Windows Firewall
- Verify port 8765 accessible: `netstat -an | findstr 8765`

## Quick Test Commands

```bash
# 1. Test service starts (no actual inference)
python workers/python/test_service.py
# Ctrl+C to stop

# 2. Download YOLO model
python -c "from pathlib import Path; Path('models').mkdir(exist_ok=True); from ultralytics import YOLO; YOLO('yolov8n.pt').save('models/best.pt'); print('✅ Model ready')"

# 3. Start full service
python workers/python/api_service.py
# Keep running in terminal

# 4. In another terminal: Test health
curl http://127.0.0.1:8765/health

# 5. Run E2E test
python test/e2e_hybrid_detection.py
```

## Manual YOLO Model Setup (Step-by-Step)

1. Create models directory:
```bash
mkdir models
```

2. Open Python:
```bash
python
```

3. In Python REPL:
```python
from ultralytics import YOLO
import shutil

# Download YOLOv8n (smallest, fastest)
model = YOLO('yolov8n.pt')
print(f"Model downloaded to: yolov8n.pt")

# Copy to expected location
shutil.copy('yolov8n.pt', 'models/best.pt')
print("✅ Model ready at models/best.pt")

# Exit Python
exit()
```

4. Start service:
```bash
python workers/python/api_service.py
```

5. Verify:
```bash
curl http://127.0.0.1:8765/health
```

Expected:
```json
{"status":"ok","service":"TagFlow Python Workers"}
```

Done! Service ready for detection requests.
