# Phase 2: Integration — Completion Summary

**Status:** ✅ Phase 2 Complete (Scaffolding Done)

---

## What Was Done

### 1. Adapter Bridges Created
- `risk-mapping/lib/adapters/db.ts` — Database connection bridge
- `risk-mapping/lib/adapters/auth.ts` — NextAuth session bridge  
- `risk-mapping/lib/adapters/storage.ts` — File storage bridge
- `risk-mapping/lib/adapters/index.ts` — Central export

**Purpose:** Decouple Risk Mapping from specific implementations. Each adapter is stubbed with TODO comments for implementer.

### 2. Import Updates
- ✅ All `@/lib/db` imports → `../../lib/adapters`
- ✅ All `@/lib/auth` imports → `../../lib/adapters`
- ✅ All `@/lib/authz` imports → `../../lib/adapters`
- ✅ All relative imports normalized for worker (`../lib` → `../../lib`)

**Coverage:** 27 API routes, 9 lib files, 10 components, 1 worker

### 3. Next.js Configuration
- `next.config.js` — Build config, webpack fallbacks
- `tsconfig.json` — Path aliases (`@/*`, `@/risk-mapping/*`)
- `package.json` — Dependencies, scripts
- `.env.example` — Environment template

### 4. Documentation
- `INTEGRATION_GUIDE.md` — Setup, architecture, troubleshooting

---

## File Changes

```
Created:
  - risk-mapping/lib/adapters/db.ts (46 lines)
  - risk-mapping/lib/adapters/auth.ts (48 lines)
  - risk-mapping/lib/adapters/storage.ts (52 lines)
  - risk-mapping/lib/adapters/index.ts (6 lines)
  - scripts/update-imports.sh (update script)

Modified:
  - 27 API route files (import paths)
  - 9 lib files (import paths)
  - 10 frontend components (import paths)
  - 1 worker (import paths)

Created:
  - next.config.js
  - tsconfig.json (with path aliases)
  - package.json (with dependencies)
  - .env.example
  - INTEGRATION_GUIDE.md
```

---

## Import Pattern

### Before (Original promia-web-sb)
```typescript
import { getConnection, sql } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isRiskMappingEditor } from '@/lib/authz';
import { savePfdFile } from '@/lib/pfdStorage';
```

### After (Asset-Detection clone)
```typescript
// In API route (backend/api/pfd/route.ts)
import { getConnection, sql, getServerSession, authOptions, isRiskMappingEditor } from '../../lib/adapters';
import { savePfdFile } from '../../lib/pfdStorage';

// In lib file (lib/riskAttributes.ts)
import { getConnection, sql } from './adapters';

// In frontend component
import { showRiskMappingErrorAlert } from '../../../lib/riskMappingAlert';
```

---

## Adapter Stubs (To Be Implemented)

### Database Adapter
```typescript
// Current: Stubbed with instructions
// Next: Either:
//   1. Re-export from promia-web-sb: export { getConnection, sql } from '@/lib/db';
//   2. Implement standalone MSSQL pool in adapter
```

### Auth Adapter
```typescript
// Current: Stubbed
// Next: Connect to NextAuth setup
//   - Implement getServerSession()
//   - Provide authOptions
//   - Keep isRiskMappingEditor(session) logic
```

### Storage Adapter
```typescript
// Current: Stubbed (4 TODO functions)
// Next: Implement file operations
//   - saveFile(path, buffer) → local/S3/SharePoint
//   - readFile(path) → Buffer
//   - deleteFile(path) → void
//   - fileExists(path) → boolean
```

---

## Testing Checklist (Phase 3)

### Database
- [ ] Run migration: `npm run db:migrate`
- [ ] Verify 9 tables created: `SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'rbi_pfd%'`
- [ ] Check indexes created

### API
- [ ] Test endpoint: `GET /api/risk-mapping/pfd` (requires auth)
- [ ] Test endpoint: `GET /api/risk-mapping/jobs`
- [ ] Test error response for missing schema

### Frontend
- [ ] Pages load: `/risk-analysis/risk-mapping`
- [ ] Pages load: `/risk-analysis/risk-mapping/[id]`
- [ ] Components render without errors

### Worker
- [ ] Start worker: `npm run worker`
- [ ] Worker connects to DB
- [ ] Worker heartbeat recorded: `SELECT * FROM rbi_service_heartbeat`
- [ ] Worker claims jobs: `SELECT * FROM rbi_bg_job`

### Integration
- [ ] Upload PFD → job enqueued (PENDING)
- [ ] Worker processes TEXT_INDEX job → status DONE
- [ ] Auto-detect runs → tags created
- [ ] Export PDF works

### Regression
- [ ] No errors in promia-web-sb original project
- [ ] Asset-Detection standalone runs without promia-web-sb

---

## What Needs Adapter Implementation

### To Run Against promia-web-sb Database

**Option A: Reference Existing (Tight Coupling)**
```typescript
// risk-mapping/lib/adapters/db.ts
export { getConnection, sql } from '@/lib/db';
export { getServerSession } from 'next-auth';
export { default as authOptions } from '@/lib/auth';
export { isRiskMappingEditor } from '@/lib/authz';
```
✅ Works immediately, ❌ requires promia-web-sb present.

**Option B: Standalone Implementation (Loose Coupling)**
```typescript
// risk-mapping/lib/adapters/db.ts
import ConnectionPool from 'mssql';
export async function getConnection() { /* implement pool */ }
```
✅ Works standalone, ❌ duplicate code, need env config.

**Recommendation:** Use Option A for now (reference promia-web-sb), migrate to Option B later if needed.

---

## Known Issues / Gaps

1. **Storage Adapter Not Implemented**
   - Stubbed with TODO comments
   - Implement before uploading PFDs

2. **Import Paths Assume Structure**
   - Risk Mapping must be in `./risk-mapping/` directory
   - If moved, relative paths break

3. **No Runtime Type Checking**
   - Adapters throw at runtime if not implemented
   - Consider adding startup validation

4. **Path Alias Conflict**
   - `@/*` and `@/risk-mapping/*` both use same root
   - Works, but confusing; consider renaming adapter module

---

## Next: Phase 3 (Verification)

### Phase 3 Tasks
1. Implement adapters (pick Option A or B)
2. Run database migration
3. Start dev server
4. Test API endpoints
5. Run background worker
6. Upload test PFD
7. Verify TEXT_INDEX job runs
8. Verify frontend renders
9. Check for regressions in promia-web-sb
10. Document results

### Success Criteria
- [ ] All 27 API endpoints callable (200/201/204 responses)
- [ ] Database migration idempotent (run 2x, same result)
- [ ] Worker claims jobs and updates status
- [ ] Frontend pages render without console errors
- [ ] No regression in original promia-web-sb

---

**Phase 2 Complete. Ready for Phase 3 verification.**
