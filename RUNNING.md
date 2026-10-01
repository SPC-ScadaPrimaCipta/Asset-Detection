# Asset Detection - Running the Project

## Prerequisites

1. **PostgreSQL** (v12+)
   - Default: `postgresql://localhost:5432`
   - Windows: PostgreSQL installer or WSL

2. **Redis** (v6+)
   - Default: `redis://localhost:6379`
   - Windows: Use WSL or native Redis build

3. **Gemini API Key** or DeepSeek API Key
   - Get from https://ai.google.dev (Gemini)

## Setup (5 minutes)

### 1. Configure Environment
```bash
cp .env.example .env.local
```

`.env.example` documents every available knob. The minimum you must set:

```
DATABASE_URL=postgresql://user:password@localhost:5432/asset_detection
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=a_model_your_key_actually_offers
AI_PROVIDER=gemini
STORAGE_PATH=./storage
```

> **Set a real model.** `GEMINI_MODEL` ships with a deprecated default that the
> app deliberately does not rewrite for you. Models that ignore
> `responseMimeType=application/json` are skipped automatically, and any other
> unavailable model falls through to `GEMINI_PREFERRED_MODELS`. Use
> **Settings → Scan Models** to see exactly what your key can reach.

> Detection is 100% Gemini Vision: each PDF page is rendered to a PNG and sent
> to Gemini together with the selected Legend. There is no OCR, no OpenCV/CV
> service, and no local model to start. DeepSeek is text-only, so it cannot be
> used for Run Detection — pick Gemini in Settings.

### 2. Initialize Database
```bash
# Create database
createdb asset_detection

# Run schema
psql -d asset_detection -f sql/init.sql
```

### 2b. Apply Migrations (existing databases only)

A fresh `init.sql` is enough for a new database. To bring an older one up to
date, run the migration files in order. The one that matters for tuning is
`sql/migrate-009-settings-tuning.sql`, which adds the `settings.tuning` column
used by the Settings UI. Without it the app still runs — tuning simply falls
back to `.env` and code defaults, and the tuning section of the Settings page is
hidden.

```bash
psql -d asset_detection -f sql/migrate-009-settings-tuning.sql
```

### 3. Install Dependencies
```bash
npm install
```

## Running

### Terminal 1: Next.js Dev Server
```bash
npm run dev
```
→ http://localhost:3000

### Terminal 2: Detection Worker
```bash
# Windows
scripts\start-worker.bat

# Linux/Mac
bash scripts/start-worker.sh
```

## Test Workflow

### 1. Create Project
- Go to `/projects`
- Click "New Project"
- Enter name

### 2. Upload Legend PDF
- Go to `/legends/new`
- Tab: "Upload PDF"
- Select legend PDF
- Click upload
- Gemini auto-extracts symbols
- Review page shows results
- Approve/reject symbols
- Click "Finalize & Activate"

### 3. Upload P&ID Document
- Go to `/documents`
- Upload P&ID PDF
- System extracts page count

### 4. Run Detection
- Go to `/detection`
- Select project, document, legend
- Click "Run Detection"
- Worker processes job asynchronously
- View progress/results
- Review detections (confirm/edit/reject)

### 5. Export Asset Register
- Go to `/assets` or `/asset-register`
- Filter assets as needed
- Click "Export Asset Register (.xlsx)"
- Download Excel file

## Architecture

```
Frontend (Next.js)
    ↓
API Routes (Node.js)
    ↓
Database (PostgreSQL)
    ↑
Detection Worker (BullMQ + Redis)
    ↑
AI Provider (Gemini/DeepSeek)
```

**Flow:**
1. User uploads P&ID → stored in `storage/`
2. Detection job queued to Redis
3. Worker picks up job, calls AI
4. AI returns detections (structured JSON)
5. Results stored in `detections` table
6. UI polls job status, shows results
7. User reviews (confirm/reject)
8. Confirmed assets exported to Excel

## Logs & Debugging

**Detection Worker Logs** (Terminal 2):
```
[detection] job=<job-id> start
[detection] page 1/12 detections=5
[detection] page 2/12 detections=3
...
```

**Legend Parser Logs** (Terminal 1):
```
[parseLegendPdf] Analyzing legend PDF, size: 45000 bytes
[parseLegendPdf] Gemini response length: 2000
[parseLegendPdf] Parsed from code block
[parseLegendPdf] Extracted 8 valid symbols
```

**Database Check:**
```sql
SELECT * FROM legends;
SELECT * FROM legend_symbols WHERE legend_id = 'xxx';
SELECT * FROM detection_jobs ORDER BY created_at DESC;
SELECT * FROM detections WHERE job_id = 'xxx';
```

## Troubleshooting

### "No symbols on this page"
- Legend PDF uploaded but Gemini failed to parse
- Check console logs: `[parseLegendPdf] Failed: ...`
- Verify Gemini API key is valid
- Re-upload legend PDF

### "Detection job stuck in PENDING"
- Worker not running (Terminal 2)
- Redis not accessible (`REDIS_URL`)
- Check worker console for errors

### "PDF viewer shows empty canvas"
- PDF file not stored correctly
- Check `storage/` directory
- Verify `STORAGE_PATH` in .env.local

### "401 Unauthorized from Gemini"
- API key invalid or expired
- Regenerate from https://ai.google.dev
- Update `.env.local` (or the Settings page, which takes precedence)

### "All Gemini models exhausted"
- Every candidate model failed. Check the log for the per-model reason.
- The most common cause is a `GEMINI_MODEL` that no longer exists. Set a model
  your key actually offers (Settings → Scan Models) and confirm
  `GEMINI_PREFERRED_MODELS` lists live models too.
- A 503 on every model is a provider-side outage, not a config problem; retry
  later. `GEMINI_RETRY_MAX_ATTEMPTS` controls how hard it retries.

### "429 / quota exceeded" during detection
- Too many requests per minute. Region mode issues one call per region, so a
  3×2 grid is 6 calls per page plus the catch-up pass.
- Raise `DETECTION_REGION_DELAY_MS`, shrink the grid with
  `DETECTION_REGION_COLS` / `DETECTION_REGION_ROWS`, or switch to
  `DETECTION_REGION_MODE=page`.
- Also check that `ENABLE_SYMBOL_FEATURE_EXTRACTION` and
  `ENABLE_SYMBOL_EMBEDDING` are `false`; each adds a call per detection.

### A page takes longer than 120 seconds
- Expected ceiling per the PRD. If it is routinely exceeded, the cause is almost
  always the region grid plus optional per-detection enrichment. Turn the
  enrichment flags off first, then reduce the grid.

### Detection finds few or no symbols on a dense sheet
- Confirm `DETECTION_REGION_MODE=regions` (the default). Single-page mode
  compresses a dense A3 sheet until 6pt tags are unreadable.
- Try raising `DETECTION_REGION_COLS`/`ROWS` for a denser split.
- Verify the Legend has ACTIVE symbols with reference crops.

### A change in Settings does not take effect
- Tuning is cached for 30 seconds, so allow a moment and retry.
- If the tuning section is missing from the page, migration
  `sql/migrate-009-settings-tuning.sql` has not been applied.

## Next Steps

- **Phase 6:** P&ID viewer with pan/zoom (already in detection page)
- **Phase 7:** Bulk confirmation/rejection UI
- **Phase 9:** Excel formatting improvements
- **Phase 10:** Production hardening (rate limits, error recovery)
