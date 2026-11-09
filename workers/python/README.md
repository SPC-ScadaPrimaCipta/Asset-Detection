# Python Workers: Hybrid P&ID Detection System

Continuous learning architecture dengan DXF Vector Parsing, YOLO, OpenCV, OCR, dan pgvector embeddings.

## Architecture

```text
TypeScript (Next.js)
       ↓
  HTTP (port 8765)
       ↓
Python FastAPI Service
       ↓
   ┌──────────────────────┐
   │  Detection Worker    │ → YOLO + pgvector similarity
   │  Spatial Matcher     │ → KDTree tag-to-symbol matching
   │  Learning Worker     │ → Crop + Embed + pgvector insert
   │  DXF Parser          │ → Vertical text grouping + circles
   │  Tiling Worker       │ → SAHI-style 1024×1024 overlap
   └──────────────────────┘
       ↓
  PostgreSQL + pgvector
```

## Setup

### 1. Install Dependencies

```bash
cd workers/python
pip install -r requirements.txt
```

**Key dependencies:**
- `ultralytics` (YOLO v8)
- `open-clip-torch>=2.20.0` (CLIP embeddings, compatible torch>=2.0)
- `ezdxf` (DXF parsing)
- `opencv-python`, `scipy`, `scikit-learn`
- `psycopg2-binary`, `pgvector`
- `fastapi`, `uvicorn`
- `easyocr` (OCR fallback)

### 2. Database Migration

Run pgvector migration:

```bash
npm run migrate
```

Creates:
- `asset_training_embeddings` table (512-dim vectors)
- `legend_symbols.embedding` column
- IVFFlat indexes for cosine similarity
- Helper function `find_similar_symbols()`

### 3. Model Download

Download YOLO model (or use existing):

```bash
# Option 1: Use existing trained model
cp /path/to/your/best.pt models/best.pt

# Option 2: Download YOLOv8 base model
# from ultralytics import YOLO
# model = YOLO('yolov8n.pt')  # nano model
# model.save('models/best.pt')
```

### 4. Environment Variables

Add to `.env.local`:

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/asset_detection"
STORAGE_PATH="./storage"
YOLO_MODEL_PATH="./models/best.pt"
SIMILARITY_THRESHOLD=0.88
NMS_IOU_THRESHOLD=0.3
```

## Running the Service

### Start Python API Service

```bash
python workers/python/api_service.py
```

Service runs on `http://127.0.0.1:8765`

**Endpoints:**
- `GET /health` — Health check
- `POST /yolo-detect` — YOLO + pgvector detection
- `POST /spatial-match` — Tag-to-symbol spatial matching
- `POST /learning/process-approval` — Continuous learning insert
- `POST /dxf/parse` — DXF parsing with vertical text grouping

### Start Next.js App

Terminal 1:
```bash
npm run dev
```

Terminal 2:
```bash
npm run worker  # TypeScript BullMQ worker
```

Terminal 3:
```bash
python workers/python/api_service.py  # Python FastAPI service
```

## Testing

### End-to-End Test

```bash
# 1. Prepare test files
mkdir -p storage/test
# Place sample_pid.png and sample_pid.dxf in storage/test/

# 2. Run test script
python test/e2e_hybrid_detection.py
```

Expected output:
- ✅ DXF parsing: texts, circles, inserts
- ✅ YOLO detection: detections by source (YOLO / pgvector / OCR)
- ✅ Spatial matching: tag-to-symbol matches
- ⚠️  Learning: manual test via UI approval

### Manual Integration Test

1. **Upload P&ID** via UI (`/documents`)
2. **Run Detection** → Queue processes via Python service
3. **Review Detections** → Check confidence and bbox accuracy
4. **Approve 5-10 Detections** → Triggers learning worker
5. **Verify pgvector Insert**:
   ```sql
   SELECT asset_tag, asset_type, confidence
   FROM asset_training_embeddings
   WHERE is_approved = TRUE
   ORDER BY approved_at DESC LIMIT 10;
   ```
6. **Re-run Detection** → Should find similarity matches with boosted confidence

## Core Modules

### Detection Worker (`detection_worker.py`)

```python
from detection_worker import DetectionWorker

worker = DetectionWorker(yolo_model_path="models/best.pt")
detections = worker.detect(
    image=img_array,
    project_id="proj-001",
    use_pgvector=True,  # Enable similarity boost
    use_ocr=True        # Enable OCR fallback
)
```

**Flow:**
1. YOLO baseline detection
2. For each detection: crop → CLIP embed → pgvector search
3. If similarity > 0.88: use pgvector label + boost confidence
4. OCR fallback for missed regions
5. NMS deduplication

### Spatial Matcher (`spatial_matcher_worker.py`)

```python
from spatial_matcher_worker import SpatialMatcherWorker

matcher = SpatialMatcherWorker(max_distance_threshold=200)
matches = matcher.match_tags_to_symbols(
    symbols=[{id, bbox, label}],
    texts=[{text, bbox}],
    circles=[{center_x, center_y, radius}]  # Optional
)
```

**Strategies:**
- **Inside circle**: Text within instrument bubble radius
- **Nearest neighbor**: KDTree closest text to symbol
- **Line connected**: Check LINE entities connecting symbol-text (optional)

### Learning Worker (`learning_worker.py`)

```python
from learning_worker import LearningWorker

worker = LearningWorker()
embedding_id = worker.process_approved_detection(
    detection_id="det-123",
    project_id="proj-001",
    asset_tag="V-101",
    asset_type="Vessel",
    symbol_category="Equipment",
    bbox_px={x, y, width, height},
    bbox_dxf={x_min, y_min, x_max, y_max},
    image_path="storage/renders/page_1.png",
    confidence_original=0.92
)
```

**Actions:**
1. Crop bbox from image
2. Generate 512-dim CLIP embedding
3. Save crop to `storage/approved/{category}/`
4. Insert into `asset_training_embeddings` table
5. Generate YOLO `.txt` label (optional future retraining)

### DXF Parser (`dxf_parser_worker.py`)

```python
from dxf_parser_worker import DxfParserWorker

parser = DxfParserWorker("path/to/drawing.dxf")
result = parser.parse()
# Returns: {extents, texts, circles, inserts, stats}
```

**Features:**
- **Vertical text grouping**: Merge stacked TEXT entities (LI + 0401 → LI-0401)
- **CIRCLE detection**: Radius 15-115 units (instrument bubbles)
- **Boundary filtering**: Skip title block (X > 85% threshold)
- **Adaptive grouping**: X-distance tolerance = 5% drawing width

### Tiling Worker (`tiling_worker.py`)

```python
from tiling_worker import TilingWorker

tiler = TilingWorker(tile_size=1024, overlap=0.2)
tiles = tiler.tile_image(image_array)
# Each tile: {tile_id, x_offset, y_offset, width, height, image}

# Multi-scale
tiles_by_scale = tiler.multi_scale_tiling(image, scales=[1.0, 1.5, 2.0])
```

SAHI-style tiling for small component detection.

## Configuration (`config.py`)

```python
from config import config

config.DATABASE_URL           # PostgreSQL connection
config.STORAGE_PATH           # Storage root path
config.YOLO_MODEL_PATH        # YOLO .pt model
config.SIMILARITY_THRESHOLD   # 0.88 (pgvector match threshold)
config.NMS_IOU_THRESHOLD      # 0.3 (NMS overlap threshold)
config.LEGENDS_PATH           # storage/legends/
config.APPROVED_PATH          # storage/approved/
```

## Utilities

### Coordinate Mapper (`utils/coord_mapper.py`)

```python
from utils.coord_mapper import CoordinateMapper, DxfExtents, ImageSize

mapper = CoordinateMapper(
    dxf_extents=DxfExtents(x_min=0, y_min=0, x_max=10000, y_max=8000),
    image_size=ImageSize(width=2400, height=1920)
)

# DXF → Pixel (Y-axis flip)
x_px, y_px = mapper.dxf_to_pixel(5000, 4000)

# Pixel → DXF
x_dxf, y_dxf = mapper.pixel_to_dxf(1200, 960)
```

### Embedding Generator (`utils/embedding.py`)

```python
from utils.embedding import EmbeddingGenerator

gen = EmbeddingGenerator(device="cpu")
embedding = gen.generate_embedding(crop_image)  # 512-dim numpy array
```

Uses OpenAI CLIP ViT-B/32 via `open-clip-torch`.

### pgvector Client (`utils/pgvector_client.py`)

```python
from utils.pgvector_client import PgVectorClient

with PgVectorClient(database_url) as client:
    # Search similar
    results = client.search_similar_symbols(
        query_embedding=emb_array,
        project_id="proj-001",
        threshold=0.85,
        limit=5
    )
    
    # Insert training
    client.insert_training_embedding(
        project_id="proj-001",
        detection_id="det-123",
        asset_tag="V-101",
        asset_type="Vessel",
        symbol_category="Equipment",
        crop_path="storage/approved/equipment/V-101_abc123.png",
        embedding=emb_array,
        bbox_dxf={...},
        bbox_px={...},
        confidence_original=0.92
    )
```

### OCR Engine (`utils/ocr_utils.py`)

```python
from utils.ocr_utils import OCREngine

ocr = OCREngine()
tags = ocr.extract_tags_only(image)  # Regex filter: [A-Z]{1,6}-\d{2,6}
```

Tesseract wrapper with P&ID-optimized preprocessing.

### NMS (`utils/nms.py`)

```python
from utils.nms import nms, merge_multi_source_detections

# Standard NMS
kept_indices = nms(boxes, iou_threshold=0.5)

# Multi-source priority (Legend > YOLO > OpenCV > OCR)
merged = merge_multi_source_detections(all_detections, iou_threshold=0.5)
```

## Storage Structure

```text
storage/
├── legends/symbols/           # Legend crops
├── approved/                  # Continuous learning crops
│   ├── equipment/
│   ├── instrument/
│   ├── valve/
│   └── fitting/
├── renders/                   # Page renders
│   └── tiles/                 # SAHI tiles (optional)
├── dataset/                   # YOLO training dataset (future)
│   ├── images/
│   └── labels/
└── test/                      # Test files
    ├── sample_pid.png
    └── sample_pid.dxf
```

## Troubleshooting

### Python Service Won't Start

**Error:** `ModuleNotFoundError: No module named 'clip'`

**Fix:** Requirements.txt uses `open-clip-torch`, not `clip-by-openai`:
```bash
pip uninstall clip-by-openai
pip install open-clip-torch>=2.20.0
```

### YOLO Model Not Found

**Error:** `FileNotFoundError: models/best.pt`

**Fix:**
```bash
mkdir -p models
# Download or copy your trained model
cp /path/to/best.pt models/best.pt
```

### pgvector Extension Not Installed

**Error:** `extension "vector" does not exist`

**Fix:**
```bash
# Install pgvector extension (Ubuntu/Debian)
sudo apt install postgresql-15-pgvector

# Or from source
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# Then run migration
npm run migrate
```

### Port 8765 Already in Use

**Fix:**
```bash
# Find process
lsof -i :8765
# Kill process
kill -9 <PID>
# Or change port in api_service.py
```

## Performance Tuning

### Detection Speed

- **GPU inference**: Set `use_cuda=True` in `DetectionWorker` (requires CUDA-compatible GPU)
- **Batch processing**: Use `generate_batch()` for embeddings
- **Tile size**: Reduce to 512×512 for faster inference (lower accuracy)
- **Multi-scale**: Disable scales=[1.0] only for speed

### pgvector Search

```sql
-- Rebuild index with more lists (better recall, slower build)
DROP INDEX IF EXISTS idx_training_embeddings_vector;
CREATE INDEX idx_training_embeddings_vector 
ON asset_training_embeddings 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 200);  -- Default: 100
```

### Database Connection Pool

Edit `utils/pgvector_client.py`:
```python
# Use connection pooling for high concurrency
from psycopg2 import pool
connection_pool = pool.SimpleConnectionPool(1, 20, database_url)
```

## Roadmap

- [ ] **Task 16:** Batch detection optimization
- [ ] **Task 17:** Multi-GPU support
- [ ] **Task 18:** Active learning UI (suggest detections for approval)
- [ ] **Task 19:** YOLO fine-tuning pipeline (use approved dataset)
- [ ] **Task 20:** DXF geometry matching (LINE/ARC patterns)

---

**Status:** ✅ Core infrastructure complete (Tasks 1-15)

**Contributors:** AI Agent + Human Review

**License:** Proprietary (TagFlow Enterprise)
