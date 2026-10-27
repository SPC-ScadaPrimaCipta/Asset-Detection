# Design Document: Legend QA Revisions (Shortcut Delete, Reparse Optimization & Upload Validation)

**Date:** 2026-10-27  
**Status:** Approved  
**Branch:** `raden-ihsan/dev-v3.5`  
**Target:** Phase 3.5 Legend Detection & QA Revisions  

---

## 1. Problem Statement & Objectives

During QA testing of the Legend Detection and Review workflows, three critical issues and enhancement requests were identified:

1. **Delete Shortcut for Bounding Boxes (`Del` / `Backspace`):**
   Reviewers have to navigate back and forth between the canvas/viewer and the side cards to delete or reject false positives (labels, title blocks, decorative lines). A fast-action shortcut is required: selecting a bounding box (or card) and pressing the `Delete` or `Backspace` key must delete/reject that symbol/asset immediately.

2. **Fix Reparse & Optimize Parsing Speed:**
   - **Bug:** Triggering "Re-parse" causes a PostgreSQL foreign key constraint violation:
     `insert or update on table "legend_symbols" violates foreign key constraint "legend_symbols_legend_id_fkey"`.
   - **UX Danger:** The "Re-parse" button triggers destructive re-extraction immediately without any confirmation modal.
   - **Performance:** Parsing and reparsing is excessively slow (**2–3+ minutes per single page**) because it slices landscape legends into 24 regions ($6 \times 4$ grid) plus a catchup pass, making 25 sequential Gemini Vision requests bounded by a 15 RPM rate gate, followed by serial image cropping.

3. **Strict 1-Page Limit & Validation for Legend Upload:**
   Users can upload multi-page PDFs to the Legend Library. Multi-page legends degrade symbol matching accuracy, produce noisy symbols from cover/revision pages, and take minutes to process. Upload must be strictly restricted and validated to **exactly 1 page** on both client and server sides.

---

## 2. Technical Architecture & Component Design

### 2.1 Component 1: Shortcut Delete (`Del` / `Backspace`)

#### A. Legend Review Workspace (`app/legends/[id]/review/page.tsx`)
- Attach a global `keydown` event listener to `window`.
- Guard conditions:
  - Ignore if `document.activeElement` is an `HTMLInputElement`, `HTMLTextAreaElement`, or `isContentEditable`.
  - Ignore if modals are open (`editingId !== null`, `addModalOpen`, `confirmDeleteId !== null`, `confirmReparse`).
  - Active only when `selectedId !== null`.
- Action:
  - Call existing `handleDeleteSymbol(selectedId)`.
  - Trigger toast feedback: `"Simbol berhasil dihapus (Del)"`.
  - Clear `selectedId`.

#### B. Detection Workspace (`app/detection/page.tsx`)
- Attach a global `keydown` event listener for `selectedItem` / `selectedId`.
- Guard conditions:
  - Ignore if active element is input/textarea or edit modal is open.
- Action:
  - If selected item is a manual asset: delete it via `DELETE /api/assets/[id]`.
  - If selected item is an AI detection: call `handleReject(selectedItem.id)`.
  - Clear selection and show status notification.

---

### 2.2 Component 2: Fix Reparse, Confirmation Modal & Performance Optimization

#### A. Confirmation Modal for Re-parse
- Add state `confirmReparse: boolean` in `app/legends/[id]/review/page.tsx`.
- Clicking "Re-parse" opens a danger-level confirmation dialog with warning:
  - Warning that re-parse will permanently delete all current symbols (including manual edits) and re-extract from the original PDF.
  - Buttons: "Batal" (Cancel) and "Ya, Jalankan Re-parse" (Confirm & Proceed).

#### B. Database Transaction & Foreign Key Fix (`app/api/legends/[id]/reparse/route.ts`)
- Use a dedicated client from `db.connect()`.
- Wrap the deletion and insertion inside an explicit transaction:
  ```ts
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const leg = await client.query('SELECT id FROM legends WHERE id = $1 FOR UPDATE', [id]);
    if (leg.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Legend not found' }, { status: 404 });
    }
    await client.query('DELETE FROM legend_symbols WHERE legend_id = $1', [id]);
    for (const s of symbols) {
      await client.query(
        `INSERT INTO legend_symbols (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases, status, bbox_x, bbox_y, bbox_w, bbox_h, pid_page, reference_image_url, reference_crop_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14)`,
        [uuidv4(), id, s.asset_type.slice(0, 120), s.symbol_name, s.tag_pattern, s.description, s.aliases ?? [], s.bbox_x, s.bbox_y, s.bbox_w, s.bbox_h, page, s.refUrl, s.refHash]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  ```

#### C. Extraction Grid & Concurrency Optimization (`lib/legend-extract.ts`, `lib/tuning.ts`, `lib/env.ts`)
- Adjust landscape grid defaults:
  - Change `LEGEND_REGION_COLS_LANDSCAPE` from `6` to `2` (or adaptive 2-column bands).
  - Change `LEGEND_REGION_ROWS` from `4` to `2`.
  - Grid reduces from 24 regions to **4 regions** (a 6x reduction in LLM calls).
  - At render scale 2.0 (~150-200 DPI), 4 regions preserve high fidelity for small equipment symbols while finishing within **15–25 seconds**.
- Parallelize reference crop generation:
  - Replace serial `for (const s of symbols) await cropAndSaveSymbol(...)` with a chunked `Promise.all` pool of 5 concurrent Sharp processes.

---

### 2.3 Component 3: Strict 1-Page Validation for Legend Upload

#### A. Server-Side Validation (`app/api/legends/upload/route.ts`)
- Immediately after reading PDF buffer:
  ```ts
  const pageCount = await getPdfPageCountFromBuffer(buf);
  if (pageCount !== 1) {
    return NextResponse.json(
      {
        error: `Dokumen Legend harus tepat 1 halaman. File yang Anda unggah memiliki ${pageCount} halaman. Harap pisahkan halaman legend terlebih dahulu.`,
      },
      { status: 400 }
    );
  }
  ```

#### B. Client-Side Validation (`app/legends/new/page.tsx`)
- When a file is chosen in `<input type="file">`:
  - Load the PDF via `pdfjsLib.getDocument({ data: arrayBuffer })`.
  - If `pdf.numPages > 1`:
    - Display alert banner: `"File Legend hanya boleh 1 halaman. File yang dipilih memiliki ${pdf.numPages} halaman."`
    - Disable submit button.
  - If `pdf.numPages === 1`:
    - Clear errors, enable "Analyze PDF" button.

---

## 3. Impacted Files

| File | Nature of Change |
|---|---|
| `app/legends/[id]/review/page.tsx` | Add `keydown` shortcut for `Delete` / `Backspace` + Re-parse confirmation modal |
| `app/detection/page.tsx` | Add `keydown` shortcut for `Delete` / `Backspace` on active detections |
| `app/api/legends/[id]/reparse/route.ts` | Wrap in PostgreSQL transaction (`BEGIN`/`COMMIT`), parallelize symbol crop saving |
| `lib/legend-extract.ts` | Optimize region splitting (2x2 grid / smart column adaptive) |
| `lib/env.ts` & `lib/tuning.ts` | Adjust default `LEGEND_REGION_COLS_LANDSCAPE` and `LEGEND_REGION_ROWS` |
| `app/api/legends/upload/route.ts` | Add strict `pageCount === 1` validation check |
| `app/legends/new/page.tsx` | Add client-side page count inspection & guidance message |

---

## 4. Verification Plan

1. **Delete Shortcut:**
   - In Legend Review, click a symbol bbox and press `Del`. Verify symbol is deleted and canvas updates.
   - Type in the search box or edit form and press `Del`. Verify input text is deleted and no symbol is removed.
   - In Detection Workspace, select a detection and press `Del`. Verify asset is rejected/deleted.
2. **Reparse & Speed:**
   - Click "Re-parse". Confirm the confirmation modal appears.
   - Proceed with re-parse. Ensure no foreign key error occurs.
   - Measure execution time: verify completion within 15–30 seconds.
3. **1-Page Limit:**
   - Attempt to upload a 2-page PDF. Verify immediate client-side block and server 400 rejection.
   - Upload a 1-page PDF. Verify smooth processing and redirection to review.
