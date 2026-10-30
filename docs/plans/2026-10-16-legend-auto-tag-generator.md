# Legend-Driven Auto-Tag Generator with Project-Level Uniqueness Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Mengotomatiskan pemberian asset tag untuk simbol yang tidak memiliki tag pada gambar P&ID dengan prefix yang dapat dikustomisasi di Legend, dilengkapi smart suggestion singkatan standar, serta jaminan keunikan tag per proyek.

**Architecture:** Modul helper penyingkat cerdas dan alokator nomor urut anti-duplikat tingkat proyek, modal manajemen pola tag di UI Legenda dengan auto-suggest, API batch update, integrasi alokasi tag di worker deteksi, dan badge visual di UI review.

**Tech Stack:** TypeScript, Next.js App Router, React, PostgreSQL, BullMQ, Jest.

---

### Task 1: Smart Abbreviation & Project-Level Tag Allocator (`lib/tag-generator.ts`)

**Files:**
- Create: `lib/tag-generator.ts`
- Test: `__tests__/tag-generator.test.ts`

**Step 1: Write the failing test**
Create `__tests__/tag-generator.test.ts` testing:
- Suggesting standard abbreviations (e.g. `Gate Valve` -> `GTV`, `Centrifugal Pump` -> `P`).
- Acronym fallback for custom names (e.g. `High Pressure Separator` -> `HPS`).
- Format tag pattern (`GTV`, `3` -> `GTV-###`).
- Parsing and calculating next project incremental tag (`GTV`, `['GTV-001', 'GTV-002']` -> `GTV-003`).
- Project uniqueness ensuring no duplicate tags.

**Step 2: Run test to verify it fails**
Run: `npm test -- __tests__/tag-generator.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement `lib/tag-generator.ts`**
Export `suggestAbbreviation`, `formatTagPattern`, `extractPrefixAndDigitsFromPattern`, and `allocateNextProjectTag`.

**Step 4: Run test to verify it passes**
Run: `npm test -- __tests__/tag-generator.test.ts`
Expected: PASS

---

### Task 2: Batch Symbol Tag Pattern Update API

**Files:**
- Create: `app/api/legends/[id]/symbols/batch/route.ts`
- Test: `__tests__/legend-symbols-batch.test.ts`

**Step 1: Write API test**
Create `__tests__/legend-symbols-batch.test.ts` verifying batch updating of `tag_pattern` for legend symbols.

**Step 2: Run test to verify it fails**
Run: `npm test -- __tests__/legend-symbols-batch.test.ts`

**Step 3: Implement batch update route**
In `app/api/legends/[id]/symbols/batch/route.ts`, implement PUT handler to update multiple `legend_symbols.tag_pattern` in a transaction.

**Step 4: Run test to verify it passes**
Run: `npm test -- __tests__/legend-symbols-batch.test.ts`
Expected: PASS

---

### Task 3: Modal "Tag Pattern & Prefix Manager" in Legend UI

**Files:**
- Modify: `app/legends/[id]/page.tsx`

**Step 1: Build TagPatternManagerModal component**
- Table of all legend symbols.
- Quick action button: "⚡ Auto-Suggest Standard Prefixes".
- Individual editable prefix/pattern input.
- Batch save handler invoking `/api/legends/[id]/symbols/batch`.

**Step 2: Mount button and modal in Legend Detail Page**
Add "🏷️ Manage Tag Patterns" button in the legend action toolbar.

---

### Task 4: In-Pipeline Project-Level Auto-Tagging in Detection Pipeline

**Files:**
- Modify: `workers/detection-worker.ts`
- Modify: `lib/detection/hybrid-pipeline.ts`
- Test: `__tests__/auto-tag-pipeline.test.ts`

**Step 1: Write integration test**
Verify that untagged detections automatically receive incremental tags unique to the project.

**Step 2: Implement auto-tagging step in `detection-worker.ts` / `hybrid-pipeline.ts`**
- Query existing project tags from database (`WHERE doc.project_id = $1`).
- For untagged detections, match symbol's `tag_pattern` (or standard fallback).
- Assign next unique incremental tag.
- Append evidence and set `tag_source = 'AUTO_GENERATED'`.

**Step 3: Run tests**
Run: `npm test -- __tests__/auto-tag-pipeline.test.ts`
Expected: PASS

---

### Task 5: UI Review Badge in Detection Page

**Files:**
- Modify: `app/detection/page.tsx`

**Step 1: Render `Auto` badge in asset table**
If detection has `tag_source === 'AUTO_GENERATED'` or auto-generated evidence, render a neat badge `[Auto]` next to the asset tag.

---

### Task 6: Final Verification & Comprehensive Report Generation

**Step 1: Run all test suites**
Run: `npm test -- --testPathPattern="tag-generator|adaptive|hybrid|symbols"`

**Step 2: Generate comprehensive markdown report/resume for user**
