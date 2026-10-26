# MDO 8-Column Accenture Rule & UX Workflow Redesign Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Transform the detection workflow by dedicating `/detection` purely to physical asset detection & visual review, removing the legacy `/review` page completely, and introducing a new dedicated `/mdo` workspace featuring 8-column Accenture Description Rule synthesis, multi-provider AI process flow tracing (*From, To, Of, Size*), full inline customization by users, and final Excel export.

**Architecture:** 
1. Deterministic Rule-Engine in `lib/mdo-description.ts` implementing `[Prefix-] + Eqp + Size + [OF] + [FROM] + [TO]` with strict *clean omission*.
2. Multi-Provider Vision AI Analyzer in `lib/mdo-ai-analyzer.ts` reading high-res P&ID pages to trace process lines & arrowheads.
3. PostgreSQL `detection_mdo_records` updated to 8 standard business columns with inline update API.
4. Clean separation: `/detection` handles visual detection & verification; `/mdo` handles flow relationships, customization, and export.

**Tech Stack:** Next.js App Router (React 19, TypeScript), PostgreSQL, ExcelJS, Tailwind CSS / Vanilla CSS Tokens, Jest.

---

### Task 1: MDO Description Rule Engine & Unit Tests

**Files:**
- Create: `lib/mdo-description.ts`
- Create: `__tests__/mdo-description.test.ts`

**Step 1: Write the failing unit tests**
Include all test cases from PT Accenture Indonesia Slide 21 (Examples 1-5 + User example + omission edge cases).

**Step 2: Run test to verify it fails**
Run: `npm test -- __tests__/mdo-description.test.ts`
Expected: FAIL (cannot find module `lib/mdo-description`)

**Step 3: Implement `lib/mdo-description.ts`**
Implement `assembleMdoDescription(params: AssembleDescriptionParams): string` with clean value normalization and omission rules.

**Step 4: Run test to verify it passes**
Run: `npm test -- __tests__/mdo-description.test.ts`
Expected: PASS (all cases pass)

---

### Task 2: Database Migration for 8 Accenture MDO Columns

**Files:**
- Create: `sql/migrate-mdo-accenture-8cols.sql`
- Modify: `scripts/migrate.cjs`

**Step 1: Write migration SQL**
Add columns:
- `location_prefix TEXT`
- `equipment_type_short TEXT`
- `equipment_name TEXT`
- `description TEXT`
Keep: `tag_no_proposed`, `size`, `from_value`, `to_value`, `of_value`, `approval_status`, `rejection_reason`.

**Step 2: Run migration**
Run: `node scripts/migrate.cjs`
Expected: Successfully applied migration.

---

### Task 3: Vision AI Process Flow & Enrichment Integration

**Files:**
- Modify/Create: `lib/mdo-ai-analyzer.ts`
- Modify: `lib/mdo-enrichment.ts`
- Test: `__tests__/mdo-enrichment.test.ts`

**Step 1: Update AI Analyzer prompt**
Ensure prompt extracts `from`, `to`, `of`, `size`, and `direction` per asset tag on P&ID.

**Step 2: Connect `buildPdfMdoRecord` and `buildMdoRecord`**
Map `shortType` from `suggestTagPrefix` (or legend symbol), `equipmentName`, and automatically call `assembleMdoDescription`.

**Step 3: Run unit tests**
Run: `npm test -- __tests__/mdo-enrichment.test.ts`
Expected: PASS

---

### Task 4: API Routes for MDO Management & 8-Column Excel Export

**Files:**
- Modify: `app/api/documents/[id]/mdo/route.ts`
- Modify: `app/api/documents/[id]/mdo/export/route.ts`
- Modify: `app/api/mdo/[id]/route.ts`
- Test: `__tests__/mdo-route.test.ts`

**Step 1: Update `app/api/documents/[id]/mdo/route.ts`**
Support `locationPrefix` from request body and upsert 8 columns.

**Step 2: Update `app/api/mdo/[id]/route.ts` (PATCH)**
Support inline customization of any of the 8 columns by the user, with automatic description recalculation.

**Step 3: Update `app/api/documents/[id]/mdo/export/route.ts`**
Export exactly the 8 standard columns with professional formatting.

**Step 4: Run unit test**
Run: `npm test -- __tests__/mdo-route.test.ts`
Expected: PASS

---

### Task 5: Remove Legacy Review Page & Update Navigation

**Files:**
- Delete: `app/review/page.tsx`
- Delete: `app/review/`
- Modify: `app/sidebar-nav.tsx`
- Modify: `app/page.tsx`

**Step 1: Remove legacy `app/review/` directory**
Remove all traces of the legacy review page.

**Step 2: Update `app/sidebar-nav.tsx`**
Replace `/review` item with `{ href: '/mdo', label: 'MDO Flow', icon: ... }`.

**Step 3: Update `app/page.tsx`**
Update quick action link from `/review` to `/detection` and `/mdo`.

---

### Task 6: Build New Dedicated MDO Workspace Page (`app/mdo/page.tsx`)

**Files:**
- Create: `app/mdo/page.tsx`

**Features to implement:**
1. Document header with document selector, total assets count, approved/pending/rejected badges.
2. Input **Location Prefix** (e.g. `GRS`, `MTR`).
3. Action buttons: **"Run AI Process Flow Analysis / Build MDO"**, **"Approve All"**, and **"Export Asset Register (MDO Excel)"**.
4. 8-Column Data Table:
   - Tag, Short Type, Equipment Name, Size, From, To, Of, Description.
   - Inline edit or quick edit drawer for full user customization.
   - Live recalculation of Description when editing attributes.
   - Quick status actions: Approve / Reject.
5. Search & Filter: Filter by equipment type, approval status, and search keyword.

---

### Task 7: Streamline & Focus Detection Page (`app/detection/page.tsx`)

**Files:**
- Modify: `app/detection/page.tsx`

**Changes to implement:**
1. Remove MDO buttons, MDO status drawer, and MDO building overlay from the detection page.
2. Focus the page entirely on:
   - Document & Legend selection.
   - Running AI / YOLO / DXF detection.
   - Visual P&ID / DXF Viewer with bounding boxes & filters.
   - Detection results list.
3. Add a prominent next-step action button:
   ```tsx
   <Link href={`/mdo?document_id=${documentId}`} className="btn-primary">
     Proceed to MDO & Process Flow ➔
   </Link>
   ```

---

### Task 8: Verification & End-to-End Validation

**Steps:**
1. Run all Jest tests: `npm test`
2. Test `/detection` flow: Verify visual bounding boxes and navigation to `/mdo`.
3. Test `/mdo` flow:
   - Run AI process flow analysis with Vision AI.
   - Verify 8 columns populated.
   - Test full customization: edit From/To/Size and verify Description updates reactively.
   - Test "Export Asset Register (MDO Excel)" to confirm spreadsheet outputs the 8 columns accurately.
