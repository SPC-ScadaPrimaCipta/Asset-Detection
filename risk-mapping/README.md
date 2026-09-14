# Risk Mapping Module

**Extracted from:** promia-web-sb
**Clone Date:** 2026-09-14
**Status:** ⚠️ Phase 1 Complete — Code Extracted, Integration Pending

---

## Overview

Risk Mapping module: PFD (Process Flow Diagram) upload → text extraction → asset tagging → risk visualization.

**Capabilities:**
- Upload PDF drawings (single or batch)
- Auto-detect assets via text matching
- Manual tag positioning with collision avoidance
- Risk data overlay (color-coded by model)
- Export annotated PDFs
- Background job queue (TEXT_INDEX, AUTO_DETECT)
- Storage abstraction (local/SharePoint/S3)

---

## Directory Structure

```
risk-mapping/
├── backend/
│   ├── api/                    27 API routes
│   │   ├── pfd/               10 endpoints (CRUD, versions)
│   │   ├── map/                2 endpoints (tag CRUD)
│   │   ├── jobs/               3 endpoints (list, retry)
│   │   ├── asset-photos/       2 endpoints
│   │   ├── asset-tag-info/     1 endpoint (risk data)
│   │   ├── auto-detect/        1 endpoint
│   │   ├── export-pdf/         1 endpoint
│   │   ├── batch-export/       1 endpoint
│   │   ├── label-layout/       1 endpoint
│   │   ├── pfd-batch/          1 endpoint
│   │   ├── pfd-file/           1 endpoint
│   │   ├── pfd-page/           1 endpoint
│   │   ├── pfd-search/         1 endpoint
│   │   └── pfd-text/           1 endpoint
│   └── workers/
│       └── jobWorker.ts        Background job processor
│
├── frontend/
│   ├── pages/risk-mapping/
│   │   ├── page.tsx            List view (PFD table)
│   │   ├── loading.tsx
│   │   └── [id]/
│   │       ├── page.tsx        Viewer (canvas + tagging)
│   │       └── loading.tsx
│   └── components/
│       ├── modals/             10 modal components
│       └── panels/
│
├── lib/                        9 core utilities
│   ├── pfdAutoTag.ts          Auto-detect logic
│   ├── pfdStorage.ts          File save/read/render
│   ├── pfdTitleBlock.ts       Title block parser
│   ├── pdfRender.ts           PDF→PNG + text extraction
│   ├── riskAttributes.ts      Risk data aggregation
│   ├── jobQueue.ts            Job state machine
│   ├── riskMappingAlert.ts    UI alerts
│   ├── riskMappingApiError.ts Error handling
│   └── riskMappingPrefs.ts    localStorage prefs
│
├── database/
│   └── migrations/
│       └── 001_risk_mapping_schema.sql    9 tables
│
└── docs/
    ├── RISK_MAPPING_CLONE_PLAN.md
    └── (to be added: API.md, DATABASE.md, JOBS.md)
```

---

## Database Tables (9)

### Risk-Mapping Specific
- `rbi_pfd_document` — PFD root (pfd_id, pfd_name, asset_id, current_version_id)
- `rbi_pfd_version` — Versions (version_id, pfd_id, file_path, page_count)
- `rbi_pfd_asset_map` — Tag coordinates (map_id, version_id, asset_id, rect_x/y/width/height)
- `rbi_pfd_tag_attribute_def` — Configurable attributes
- `rbi_pfd_label_layout` — Custom label positions
- `rbi_pfd_page_text` — Extracted text per page
- `rbi_asset_photo` — Asset photos
- `rbi_bg_job` — Job queue (PENDING→RUNNING→DONE/ERROR)
- `rbi_service_heartbeat` — Worker health

### Global Dependencies (read-only)
- `rbi_asset`, `rbi_risk`, `RBI_Model`, `rbi_matrix_*`, `rbi_inspection_plan`, `CIG_HEADING`, `TIG_DEGRADATION_MECHANIS`

---

## API Endpoints (27)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/risk-mapping/pfd` | GET, POST | List, create PFD |
| `/api/risk-mapping/pfd/[id]` | GET, PATCH, DELETE | Single PFD CRUD |
| `/api/risk-mapping/pfd/[id]/version` | POST | Upload revision |
| `/api/risk-mapping/pfd/[id]/rescan-title-block` | POST | Re-extract title |
| `/api/risk-mapping/map` | GET, POST, DELETE | Tag list, create |
| `/api/risk-mapping/map/[id]` | GET, PATCH, DELETE | Single tag CRUD |
| `/api/risk-mapping/asset-tag-info` | GET | Risk attributes (hover/click) |
| `/api/risk-mapping/auto-detect` | POST | Trigger auto-tag |
| `/api/risk-mapping/jobs` | GET | List jobs + worker status |
| `/api/risk-mapping/jobs/[jobId]/retry` | POST | Retry failed job |
| `/api/risk-mapping/jobs/retry-all` | POST | Retry all failed |
| `/api/risk-mapping/pfd-file/[versionId]` | GET | Download PDF |
| `/api/risk-mapping/pfd-page/[versionId]` | GET | Render page PNG |
| `/api/risk-mapping/pfd-text/[versionId]` | GET | Get extracted text |
| `/api/risk-mapping/pfd-search` | GET | Full-text search |
| `/api/risk-mapping/export-pdf` | POST | Export annotated PDF |
| `/api/risk-mapping/batch-export` | POST | Batch export |
| `/api/risk-mapping/asset-photos` | GET, POST, DELETE | Photo CRUD |
| `/api/risk-mapping/label-layout` | GET, POST | Custom label position |

---

## Job System

### Worker
- `workers/jobWorker.ts` — Poll every 3s, atomic claim (UPDLOCK + READPAST)
- Heartbeat to `rbi_service_heartbeat`
- Graceful shutdown (SIGINT/SIGTERM)

### Job Types
1. **TEXT_INDEX** — Extract text from PDF → detect default page
2. **AUTO_DETECT** — Substring match asset names → create tags

### State Machine
```
PENDING → RUNNING → DONE
                  → ERROR (retryable)
```

---

## Dependencies

### Hard Dependencies (CANNOT remove)
- `lib/db.ts` — MSSQL connection pool
- `lib/auth.ts`, `lib/authz.ts` — NextAuth session
- `lib/storageAdapter.ts` — Local/SP/S3 abstraction
- Global RBI tables (`rbi_asset`, `rbi_risk`, etc.)

### Bridge Pattern
```typescript
// lib/adapters/ (to be created)
import { getConnection, sql } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
import { isRiskMappingEditor } from '@/lib/authz';
```

---

## Known Limitations

| Limitation | Reason | Workaround |
|-----------|--------|-----------|
| Auth required | Global session | Must be logged in |
| Cannot create assets | Asset is global domain | Use existing asset IDs |
| Cannot create models | RBI domain is global | Use existing models |
| No physical FK to rbi_asset | rbi_asset has no PK | Logical FK only |

**These are boundaries, not bugs.** Risk Mapping is consumer, not producer, of RBI domain.

---

## Next Steps

### Phase 2: Integration (NOT DONE)
- [ ] Create `lib/adapters/` bridges (db, auth, storage)
- [ ] Update all imports in copied files
- [ ] Test database migration
- [ ] Test API endpoints
- [ ] Test worker job claims
- [ ] Test frontend pages render

### Phase 3: Verification
- [ ] Unit tests (riskAttributes, pfdAutoTag, jobQueue)
- [ ] E2E tests (upload, tag, export)
- [ ] Regression check (promia-web-sb still works)

### Phase 4: Documentation
- [ ] API reference
- [ ] Database schema docs
- [ ] Job system flow
- [ ] Extension guide

---

## Running Risk Mapping

⚠️ **NOT READY YET** — Integration phase incomplete.

Once integrated:

```bash
# 1. Database migration
npm run db:migrate

# 2. Start worker (separate terminal)
npm run worker

# 3. Start Next.js
npm run dev

# 4. Access
http://localhost:3003/risk-analysis/risk-mapping
```

---

## File Count
- API Routes: 27
- Lib Files: 9
- Frontend Components: 10+
- Frontend Pages: 4
- Workers: 1
- Migrations: 1

**Total Extracted:** ~50 files

---

**Status:** Phase 1 complete. Code extracted. Integration pending.
