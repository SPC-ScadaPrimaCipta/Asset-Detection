# Risk Mapping Clone Plan

**Source:** `C:\Users\SrydenID\Documents\GitHub\promia-web-sb`
**Target:** `C:\Users\SrydenID\Documents\GitHub\Asset-Detection`

---

## 1. Audit Summary

### Frontend (2 pages, 10 modals, 4 libs)
- **Pages:** List view (1426 ln) + Viewer (326 KB)
- **Components:** Modals (upload/edit/batch), panels (jobs)
- **State:** Local only, no Redux
- **Pollers:** 3s when jobs PENDING/RUNNING
- **Canvas:** 5 resolution tiers, 3-tier collision avoidance
- **API Calls:** 18 endpoints

### Backend (31 endpoints, 9 tables, worker)
- **Endpoints:** PFD CRUD (10), Tagging (5), Risk (3), Auto-detect (1), Jobs (3), Files (4), Photos (3), Export (2)
- **Tables:** All `rbi_pfd_*` specific + 6+ global RBI refs
- **Worker:** TEXT_INDEX (PDF text extract), AUTO_DETECT (asset name match)
- **Jobs:** PENDING→RUNNING→DONE/ERROR state machine
- **Queries:** 5 concurrent with recursive CTEs (depth 20)

### Hard Dependencies (CANNOT extract)
| Dependency | Reason |
|------------|--------|
| `lib/db.ts` | MSSQL pool, shared across all modules |
| `lib/auth.ts`, `lib/authz.ts` | NextAuth session, login required |
| `lib/storageAdapter.ts` | Local/SharePoint/S3 abstraction |
| `rbi_asset` (no PK) | Global asset registry, no logical FK possible |
| `rbi_risk`, `RBI_Model`, `rbi_matrix_*` | Global risk domain |
| `rbi_inspection_plan`, `CIG_HEADING`, `TIG_DEGRADATION_MECHANIS` | Global RBI tables |

---

## 2. Extractable Components

### Database (9 tables, idempotent migration)
```sql
rbi_pfd_document           -- PFD root
rbi_pfd_version            -- Versions
rbi_pfd_asset_map          -- Tag coordinates
rbi_pfd_tag_attribute_def  -- Configurable attrs
rbi_pfd_label_layout       -- Label positions
rbi_pfd_page_text          -- Extracted text
rbi_asset_photo            -- Asset photos
rbi_bg_job                 -- Job queue
rbi_service_heartbeat      -- Worker health
```

Foreign keys: ALL physical FK within extracted set. Logical FK to global tables (app-level).

### API Endpoints (31)
```
/api/risk-mapping/pfd*                 [10 endpoints]
/api/risk-mapping/map*                 [5 endpoints]
/api/risk-mapping/asset-tag-info       [1 endpoint]
/api/risk-mapping/label-layout         [2 endpoints]
/api/risk-mapping/auto-detect          [1 endpoint]
/api/risk-mapping/jobs*                [3 endpoints]
/api/risk-mapping/pfd-*                [4 endpoints: file, page, text, search]
/api/risk-mapping/asset-photos         [3 endpoints]
/api/risk-mapping/export-pdf           [2 endpoints]
```

Authentication: `getServerSession()` + `isRiskMappingEditor()` gate all writes.

### Worker & Jobs
```
workers/jobWorker.ts           -- Main job loop (poll 3s, claim atomic)
lib/jobQueue.ts                -- Job state machine (PENDING→RUNNING→DONE/ERROR)
```

Job types:
- `TEXT_INDEX` — Extract PDF text → rbi_pfd_page_text → detect default page
- `AUTO_DETECT` — Asset name substring match → auto-tag

### Core Libraries
```
lib/pfdStorage.ts              -- Save/read/render PDF, cached PNG
lib/pfdAutoTag.ts             -- Auto-detect logic (substring search)
lib/pfdTitleBlock.ts          -- Parse title block (doc#, rev, title, etc)
lib/riskAttributes.ts         -- Risk data aggregation (7 concurrent SQL + rollup)
lib/pdfRender.ts              -- PDF→PNG + text extraction
lib/riskMappingApiError.ts    -- Error handler
```

### Frontend (pages, components, libs)
```
app/(defaults)/risk-analysis/risk-mapping/
├── page.tsx                            -- List view (PFD table)
├── loading.tsx                         -- Skeleton
└── [id]/
    ├── page.tsx                        -- Viewer (canvas + tagging)
    └── loading.tsx

components/risk-mapping/
├── AutoDetectReviewModal.tsx           -- Auto-detect matches review
├── AutoTagConfirmModal.tsx             -- Pre-scan confirmation
├── BatchExportModal.tsx                -- Batch PDF export
├── BatchUploadModal.tsx                -- Multi-file upload (4 concurrent)
├── EditDrawingModal.tsx                -- Metadata editor
├── JobsPanel.tsx                       -- Job monitor (polling)
├── RiskMappingViewerSkeleton.tsx       -- Loading UI
├── StorageDestinationBanner.tsx        -- Backend indicator
├── UploadDrawingModal.tsx              -- Single upload
└── UploadRevisionModal.tsx             -- Revision upload

lib/
├── riskMappingPrefs.ts                 -- localStorage (lastModelId)
├── riskMappingAlert.ts                 -- Alert UI (sweetalert2)
├── riskAttributes.ts                   -- Data layer (queries)
└── riskMappingApiError.ts              -- Error response handler
```

---

## 3. Clone Boundary

### Include in Clone
- ✅ `sql/001_risk_mapping_schema.sql` + migrations
- ✅ All `app/api/risk-mapping/*` routes
- ✅ `workers/jobWorker.ts`
- ✅ `lib/pfd*.ts`, `lib/jobQueue.ts`
- ✅ `app/(defaults)/risk-analysis/risk-mapping/*` pages
- ✅ `components/risk-mapping/*` modals
- ✅ `lib/riskMapping*.ts` utils

### Adapter/Wrapper (minimum bridge)
- ⚠️ `lib/db.ts` — Use as-is (SQL pool is shared resource)
- ⚠️ `lib/auth.ts`, `lib/authz.ts` — Use as-is (auth is global)
- ⚠️ `lib/storageAdapter.ts` — Use as-is (storage is global)

### External Dependency (global RBI)
- ❌ `rbi_asset`, `rbi_risk`, `RBI_Model`, `rbi_matrix_*`
- ❌ `rbi_inspection_plan`, `CIG_HEADING`, `TIG_DEGRADATION_MECHANIS`

**Strategy:** Treat as read-only global context. Clone works with them but doesn't own them.

---

## 4. Clone Structure

```
risk-mapping/
├── frontend/
│   ├── pages/
│   │   ├── risk-mapping/
│   │   │   ├── page.tsx                [list view]
│   │   │   ├── loading.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx            [viewer]
│   │   │       └── loading.tsx
│   ├── components/
│   │   ├── modals/
│   │   │   ├── AutoDetectReviewModal.tsx
│   │   │   ├── AutoTagConfirmModal.tsx
│   │   │   ├── BatchExportModal.tsx
│   │   │   ├── BatchUploadModal.tsx
│   │   │   ├── EditDrawingModal.tsx
│   │   │   └── UploadDrawingModal.tsx
│   │   ├── panels/
│   │   │   ├── JobsPanel.tsx
│   │   │   └── StorageDestinationBanner.tsx
│   │   └── skeletons/
│   │       ├── RiskMappingViewerSkeleton.tsx
│   │       └── UploadRevisionModal.tsx
│   ├── hooks/
│   │   └── useStorageInfo.ts           [extract if used]
│   ├── services/
│   │   └── riskMappingApi.ts           [centralize API calls]
│   └── utils/
│       ├── riskMappingPrefs.ts
│       ├── riskMappingAlert.ts
│       ├── riskAttributes.ts
│       └── riskMappingApiError.ts
│
├── backend/
│   ├── api/
│   │   ├── pfd/
│   │   │   ├── list.ts                 [GET /pfd]
│   │   │   ├── create.ts               [POST /pfd]
│   │   │   ├── get.ts                  [GET /pfd/[id]]
│   │   │   ├── update.ts               [PATCH /pfd/[id]]
│   │   │   └── delete.ts               [DELETE /pfd/[id]]
│   │   ├── map/
│   │   │   ├── list.ts, create.ts, get.ts, update.ts, delete.ts
│   │   ├── jobs/
│   │   │   ├── list.ts, retry.ts, retryAll.ts
│   │   ├── auto-detect.ts
│   │   ├── asset-tag-info.ts
│   │   ├── export.ts
│   │   └── ... [other endpoints]
│   ├── services/
│   │   ├── pfdService.ts               [PFD CRUD logic]
│   │   ├── mapService.ts               [Tag mapping logic]
│   │   ├── jobService.ts               [Job queue logic]
│   │   └── riskService.ts              [Risk aggregation]
│   ├── repository/
│   │   ├── pfdRepository.ts            [DB queries]
│   │   ├── mapRepository.ts
│   │   └── jobRepository.ts
│   └── workers/
│       └── jobWorker.ts                [Background job loop]
│
├── database/
│   ├── migrations/
│   │   └── 001_risk_mapping_schema.sql
│   ├── queries/
│   │   ├── pfdQueries.sql              [Extracted queries]
│   │   ├── mapQueries.sql
│   │   └── riskQueries.sql
│   └── seeds/
│       └── tag_attribute_defaults.sql  [Initial rbi_pfd_tag_attribute_def]
│
├── lib/
│   ├── pfdStorage.ts                   [Save/read/render PDF]
│   ├── pfdAutoTag.ts                   [Auto-detect]
│   ├── pfdTitleBlock.ts                [Title parsing]
│   ├── pdfRender.ts                    [PDF→PNG + text]
│   ├── jobQueue.ts                     [Job state machine]
│   └── adapters/
│       ├── dbAdapter.ts                [Bridge to lib/db.ts]
│       ├── authAdapter.ts              [Bridge to lib/auth.ts]
│       └── storageAdapter.ts           [Bridge to lib/storageAdapter.ts]
│
├── tests/
│   ├── unit/
│   │   ├── riskAttributes.test.ts
│   │   ├── pfdAutoTag.test.ts
│   │   └── jobQueue.test.ts
│   ├── e2e/
│   │   ├── pfd-upload.spec.ts
│   │   ├── tag-create.spec.ts
│   │   └── export-pdf.spec.ts
│   └── fixtures/
│       └── sample.pdf                  [Test PDF]
│
├── docs/
│   ├── RISK_MAPPING_ARCHITECTURE.md    [Architecture overview]
│   ├── API.md                          [Endpoint specs]
│   ├── DATABASE.md                     [Schema + queries]
│   ├── JOBS.md                         [Job system]
│   └── EXTENSION_POINTS.md             [Future feature hooks]
│
├── .env.example
├── package.json                        [Sub-package? or integrated]
└── README.md                           [Clone overview]
```

---

## 5. Original → Clone Mapping

| Original Path | Clone Path | Type | Notes |
|---------------|-----------|------|-------|
| `sql/001_risk_mapping_schema.sql` | `database/migrations/001_risk_mapping_schema.sql` | Copy exact | Idempotent |
| `app/api/risk-mapping/pfd/route.ts` | `backend/api/pfd/list.ts` + `create.ts` | Extract | Split endpoints per file |
| `app/api/risk-mapping/map/route.ts` | `backend/api/map/list.ts` + `create.ts` | Extract | Split endpoints |
| `workers/jobWorker.ts` | `backend/workers/jobWorker.ts` | Copy | Minimal modifications |
| `lib/pfdStorage.ts` | `lib/pfdStorage.ts` | Copy | No changes |
| `lib/pfdAutoTag.ts` | `lib/pfdAutoTag.ts` | Copy | No changes |
| `lib/pdfRender.ts` | `lib/pdfRender.ts` | Copy | No changes |
| `lib/riskAttributes.ts` | `lib/riskAttributes.ts` | Copy | No changes |
| `lib/jobQueue.ts` | `lib/jobQueue.ts` | Copy | No changes |
| `app/(defaults)/risk-analysis/risk-mapping/page.tsx` | `frontend/pages/risk-mapping/page.tsx` | Copy | Update imports |
| `app/(defaults)/risk-analysis/risk-mapping/[id]/page.tsx` | `frontend/pages/risk-mapping/[id]/page.tsx` | Copy | Update imports |
| `components/risk-mapping/*` | `frontend/components/*` | Copy | Update imports |

---

## 6. Dependency Integration Points

### Database (`lib/dbAdapter.ts`)
```typescript
// Original: lib/db.ts (MSSQL pool)
// Clone bridge:
export async function getConnection() {
  return await require('@/lib/db').getConnection();
}

export const sql = require('@/lib/db').sql;
```

### Authentication (`lib/authAdapter.ts`)
```typescript
// Original: lib/auth.ts, lib/authz.ts
// Clone bridge:
export { getServerSession } from '@/lib/auth';
export { isRiskMappingEditor } from '@/lib/authz';
```

### Storage (`lib/storageAdapter.ts` — use as-is)
```typescript
// Original: lib/storageAdapter.ts
// Clone: Re-export directly
export * from '@/lib/storageAdapter';
```

---

## 7. Known Limitations (by design)

| Limitation | Why | Workaround |
|-----------|-----|-----------|
| No Risk Mapping without auth | Auth is global | Must be in authenticated session |
| Cannot create asset | Asset is global domain | Use existing asset IDs only |
| Cannot create risk models | RBI domain is global | Use existing models only |
| Cannot modify inspection plans | Global state | Use as read-only for tagging |

**Strategy:** These are NOT bugs. They're boundaries. Clone is **consumer**, not producer, of RBI domain.

---

## 8. Testing Strategy

### Unit Tests
- `riskAttributes.test.ts` — SQL aggregation logic
- `pfdAutoTag.test.ts` — Substring matching variants
- `jobQueue.test.ts` — State machine (PENDING→RUNNING→DONE)

### E2E Tests
- Upload PFD → TEXT_INDEX job → verify text stored
- Auto-detect asset → verify maps created
- Tag retrieval → verify risk inheritance logic
- Export PDF → verify overlay rendering

### Fixtures
- Sample PDF (multiple pages, text layer, title block)
- Test assets (system + equipment)
- Risk models (2-3 test matrices)

---

## 9. Extension Points (reserved for future)

```
frontend/pages/risk-mapping/
  └── future/
      ├── risk-treatment/        [Risk mitigation tracking]
      ├── risk-register/         [Centralized risk log]
      └── risk-dashboard/        [Analytics + summaries]

backend/api/
  └── future/
      ├── treatment.ts           [Treatment CRUD]
      ├── register.ts            [Register queries]
      └── analytics.ts           [Dashboard data]

lib/
  └── future/
      ├── riskTreatment.ts       [Treatment logic]
      └── riskAnalytics.ts       [Aggregation]
```

**Do NOT implement** these now. Structure exists to guide future work.

---

## 10. Acceptance Criteria

- [x] Audit complete (frontend + backend)
- [x] Dependency mapping documented
- [ ] Code extracted to clone location
- [ ] All imports updated (bridges to lib/db, lib/auth, lib/storageAdapter)
- [ ] Database migration runs successfully
- [ ] 31 API endpoints functional
- [ ] Worker job queue operational
- [ ] Frontend pages load without errors
- [ ] List view shows PFDs
- [ ] Viewer page renders PDF + tags
- [ ] Upload modal works
- [ ] Export PDF works
- [ ] AUTO-TAG job completes successfully
- [ ] TEXT-INDEX job completes successfully
- [ ] Risk data retrieved correctly
- [ ] No regression in promia-web-sb existing features
- [ ] Documentation complete (arch, API, DB, jobs, extensions)
- [ ] Tests pass (unit + e2e)

---

## 11. Next Steps

**Phase 1: Code Extraction**
1. Create directory structure
2. Copy database migration (exact)
3. Copy backend endpoints (refactor into service/repo layers)
4. Copy worker + job queue
5. Copy libs (pfd*, jobQueue, riskAttributes)

**Phase 2: Frontend Integration**
1. Copy pages + components
2. Update imports (point to clone APIs)
3. Update dependency paths (lib/db, lib/auth, lib/storageAdapter)

**Phase 3: Verification**
1. Database migration runs
2. API endpoints callable
3. Worker starts + claims jobs
4. Frontend pages render
5. E2E tests pass

**Phase 4: Documentation**
1. Architecture diagram
2. API reference
3. Database schema docs
4. Job system flow
5. Extension guide

---

**Status:** Ready for extraction phase.
