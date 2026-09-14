# Risk Mapping Integration Guide

## Quick Start

### 1. Setup Environment

```bash
cp .env.example .env.local
# Edit .env.local with your database and storage credentials
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Verify Database

```bash
npm run db:migrate
```

### 4. Start Development

Terminal 1 - Next.js dev server:
```bash
npm run dev
```

Terminal 2 - Background job worker:
```bash
npm run worker
```

Visit: http://localhost:3003/risk-analysis/risk-mapping

---

## Architecture

### Directory Structure

```
asset-detection/
├── risk-mapping/                 Risk Mapping module (standalone)
│   ├── backend/api/              27 API routes
│   ├── backend/workers/          Job processor
│   ├── frontend/                 Pages & components
│   ├── lib/                      Core utilities + adapters
│   └── database/                 Migrations
│
├── app/                          Next.js pages (if this is Next.js app)
├── lib/                          Shared utilities (auth, db, storage)
├── public/                       Static assets
└── tsconfig.json                 Path aliases
```

### Integration Points

1. **Database (`risk-mapping/lib/adapters/db.ts`)**
   - Currently stubbed
   - Implement connection pool or re-export from your project's `lib/db.ts`

2. **Authentication (`risk-mapping/lib/adapters/auth.ts`)**
   - Requires NextAuth setup
   - Must provide `getServerSession()` and `authOptions`
   - Risk Mapping uses `group === '0'` for editor check

3. **Storage (`risk-mapping/lib/adapters/storage.ts`)**
   - Implement: `saveFile()`, `readFile()`, `deleteFile()`, `fileExists()`
   - Support: local paths, S3 (s3:bucket/key), SharePoint (sp:site/drive/path)

---

## API Endpoints

All endpoints under `/api/risk-mapping/`:

- **PFD Management**
  - `GET /pfd` — List drawings
  - `POST /pfd` — Upload drawing
  - `GET /pfd/[id]` — Get details
  - `PATCH /pfd/[id]` — Update metadata
  - `DELETE /pfd/[id]` — Soft delete

- **Tagging**
  - `GET /map` — List tags
  - `POST /map` — Create tag
  - `PATCH /map/[id]` — Update tag
  - `DELETE /map/[id]` — Delete tag

- **Risk Data**
  - `GET /asset-tag-info?asset_id=&rbim_id=` — Risk attributes

- **Auto-detect**
  - `POST /auto-detect` — Scan for assets

- **Export**
  - `POST /export-pdf` — Export annotated PDF
  - `POST /batch-export` — Batch export

- **Jobs**
  - `GET /jobs` — List jobs + worker status
  - `POST /jobs/[jobId]/retry` — Retry job
  - `POST /jobs/retry-all` — Retry all

---

## Database Schema

Migration: `risk-mapping/database/migrations/001_risk_mapping_schema.sql`

**9 Risk-Mapping-Specific Tables:**
- `rbi_pfd_document` — PFD documents
- `rbi_pfd_version` — Versions
- `rbi_pfd_asset_map` — Tag coordinates
- `rbi_pfd_tag_attribute_def` — Tag attributes config
- `rbi_pfd_label_layout` — Label positions
- `rbi_pfd_page_text` — Extracted text
- `rbi_asset_photo` — Asset photos
- `rbi_bg_job` — Job queue
- `rbi_service_heartbeat` — Worker health

**Global Dependencies (read-only):**
- `rbi_asset` — Asset registry
- `rbi_risk` — Risk data
- `RBI_Model`, `rbi_matrix_*` — Risk matrices
- `rbi_inspection_plan`, `CIG_HEADING`, `TIG_DEGRADATION_MECHANIS` — RBI domain

---

## Job System

### Background Jobs

Two job types run in worker process:

1. **TEXT_INDEX**
   - Triggered: On PDF upload
   - Action: Extract text layer per page → detect drawing sheet
   - Progress: 10% (locate) → 20% (read) → 35% (extract) → 80% (save) → 100% (done)

2. **AUTO_DETECT**
   - Triggered: User clicks "Auto-Tag"
   - Action: Match asset names in PDF → create tags
   - Progress: Similar phases

### Worker Process

```bash
npm run worker
```

- Polls every 3s (configurable `WORKER_POLL_INTERVAL`)
- Atomic claim (SQL UPDLOCK + READPAST)
- Heartbeat to `rbi_service_heartbeat`
- Graceful shutdown (SIGINT/SIGTERM)

### State Machine

```
PENDING → RUNNING → DONE
       → PENDING → ERROR (retryable)
```

---

## Frontend

### Pages

- **List View** (`/risk-analysis/risk-mapping`)
  - Table of PFDs
  - Search & filter
  - Upload, batch upload, batch export
  - Job monitor

- **Viewer** (`/risk-analysis/risk-mapping/[id]`)
  - Canvas PDF rendering
  - Manual tagging (drag to place, position labels)
  - Auto-detect review
  - Tag search
  - Risk overlay (color-coded)
  - Export single PDF

### Components

**Modals:**
- `UploadDrawingModal` — Single file upload
- `BatchUploadModal` — Multi-file upload (4 concurrent)
- `EditDrawingModal` — Metadata editor
- `UploadRevisionModal` — Version upload
- `BatchExportModal` — Granular PDF export
- `AutoDetectReviewModal` — Match review + cleanup
- `AutoTagConfirmModal` — Pre-scan confirmation

**Panels:**
- `JobsPanel` — Job monitor (polling)
- `StorageDestinationBanner` — Storage backend indicator

---

## Customization

### Extend Risk Mapping

Future features can hook into extension points:

```
risk-mapping/frontend/pages/risk-mapping/future/
  ├── risk-treatment/              [Add mitigation tracking]
  ├── risk-register/               [Add centralized log]
  └── risk-dashboard/              [Add analytics]
```

Do NOT implement now. Structure exists for guidance.

### Modify Risk Calculation

Risk attributes are aggregated in `lib/riskAttributes.ts`:

```typescript
export async function getTagAttributes(assetId, rbimId) {
  // Fetches: risk_level, risk_rank, risk_color, damage_mechanisms, next_inspection_year
  // Queries 7 concurrent SQL + recursive CTE rollup
}
```

To customize:
1. Edit SQL in `getTagAttributes()`
2. Update return type if adding fields
3. Update frontend components to display new fields

---

## Troubleshooting

### "Database Schema Missing"
```
npm run db:migrate
```
Then refresh browser.

### "Could not connect to S3"
Ensure `docker run -d -p 9000:9000 minio/minio` is running (or point to your S3 endpoint).

### "Authentication required"
Ensure NextAuth is configured and user is logged in. Check `authOptions` in adapter.

### Jobs not processing
- Verify worker is running: `npm run worker`
- Check `rbi_service_heartbeat` for worker status
- Verify `rbi_bg_job` has PENDING jobs

---

## Known Limitations

1. **Auth Required** — Must be in authenticated session
2. **Cannot Create Assets** — Asset registry is global (read-only)
3. **Cannot Create Models** — Risk models are global (read-only)
4. **No Physical FK to rbi_asset** — rbi_asset has no PK; use logical FK only

These are boundaries, not bugs. Risk Mapping consumes RBI domain, doesn't produce it.

---

## Next Steps

1. **Implement Adapters**
   - Edit `risk-mapping/lib/adapters/db.ts` → connect to your MSSQL
   - Edit `risk-mapping/lib/adapters/auth.ts` → connect to your NextAuth
   - Edit `risk-mapping/lib/adapters/storage.ts` → implement file save/read

2. **Test Integration**
   - Run `npm run db:migrate` → verify tables created
   - Run `npm run dev` → verify pages load
   - Run `npm run worker` → verify job claims

3. **Deploy**
   - Update environment variables for production
   - Run database migration on target DB
   - Start worker process separately from web server

---

**Status:** Phase 2 integration scaffolding complete. Ready for adapter implementation.
