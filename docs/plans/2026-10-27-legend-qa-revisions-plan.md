# Legend QA Revisions Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Implement keyboard shortcut delete (`Del` / `Backspace`) for bounding boxes, fix reparse foreign key constraint violations and optimize parsing speed with a confirmation modal, and enforce a strict 1-page validation limit on legend uploads.

**Architecture:** Add global keydown event listeners in Legend Review and Detection pages; wrap reparse in an atomic PostgreSQL transaction with adaptive region extraction and parallel image cropping; and enforce 1-page limits on both client (pdf.js) and server (mupdf buffer analysis).

**Tech Stack:** Next.js (App Router), React, TypeScript, PostgreSQL (`pg`), Sharp, mupdf / pdfjs-dist, Gemini Vision.

---

### Task 1: Legend Upload 1-Page Validation (Server & Client)

**Files:**
- Modify: `app/api/legends/upload/route.ts:25-45`
- Modify: `app/legends/new/page.tsx:280-318`

**Step 1: Write test/validation logic for server-side upload limit**
In `app/api/legends/upload/route.ts`, immediately inspect `pageCount` after buffer extraction:
```ts
const pageCount = await getPdfPageCountFromBuffer(buf);
if (pageCount !== 1) {
  return NextResponse.json(
    {
      error: `Dokumen Legend harus tepat 1 halaman. File yang diunggah memiliki ${pageCount} halaman. Harap pisahkan halaman legend terlebih dahulu sebelum diunggah.`,
    },
    { status: 400 }
  );
}
```

**Step 2: Add client-side validation in `app/legends/new/page.tsx`**
In the PDF file selection handler, inspect `numPages` using `pdfjsLib`:
```tsx
const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0] ?? null;
  setUploadFile(file);
  setUploadError('');
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    if (pdf.numPages > 1) {
      setUploadError(`File Legend hanya boleh terdiri dari 1 halaman. File yang Anda pilih memiliki ${pdf.numPages} halaman.`);
    }
  } catch (err: any) {
    console.warn('PDF page count check failed:', err);
  }
};
```
And disable the upload button if `uploadError` is present.

**Step 3: Verify with curl/browser**
- Upload a multi-page PDF: verify response is 400 Bad Request with error message.
- Upload a single-page PDF: verify it proceeds to extraction.

**Step 4: Commit**
```bash
git add app/api/legends/upload/route.ts app/legends/new/page.tsx
git commit -m "feat(legend): enforce strict 1-page validation on legend upload"
```

---

### Task 2: Keyboard Shortcut Delete (`Del` / `Backspace`) for Bounding Boxes

**Files:**
- Modify: `app/legends/[id]/review/page.tsx`
- Modify: `app/detection/page.tsx`

**Step 1: Implement global keydown listener in `app/legends/[id]/review/page.tsx`**
Add event listener inside a `useEffect` that listens for `Delete` and `Backspace`:
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    if (isEditing || editingId || addModalOpen || confirmDeleteId || confirmReparse) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      handleDeleteSymbol(selectedId);
      setSuccessMsg('Simbol dihapus (Del)');
      setTimeout(() => setSuccessMsg(''), 2000);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedId, editingId, addModalOpen, confirmDeleteId, confirmReparse]);
```

**Step 2: Implement keydown listener in `app/detection/page.tsx`**
In `DetectionContent`, add keydown handler for `selectedItem`:
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    if (isEditing || editingItem) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItem) {
      e.preventDefault();
      handleReject(selectedItem.id);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedItem, editingItem]);
```

**Step 3: Verify shortcut behavior**
- In Legend Review: click symbol bbox, press `Del` -> symbol removed.
- In text search input: press `Del` / `Backspace` -> text edited, no symbol deleted.
- In Detection: click asset bbox, press `Del` -> status changes to REJECTED.

**Step 4: Commit**
```bash
git add app/legends/[id]/review/page.tsx app/detection/page.tsx
git commit -m "feat(ui): add Delete/Backspace keyboard shortcut to remove selected bbox"
```

---

### Task 3: Re-parse Confirmation Modal & Transactional Foreign Key Fix

**Files:**
- Modify: `app/legends/[id]/review/page.tsx`
- Modify: `app/api/legends/[id]/reparse/route.ts`

**Step 1: Add confirmation modal state and UI in `app/legends/[id]/review/page.tsx`**
Add state:
```tsx
const [confirmReparse, setConfirmReparse] = useState(false);
```
Replace direct button trigger:
```tsx
<button onClick={() => setConfirmReparse(true)} disabled={reparsing} ...>
  <ArrowCounterClockwise size={13} />{reparsing ? 'Re-parsing…' : 'Re-parse'}
</button>
```
Render modal dialog before closing tag:
```tsx
{confirmReparse && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ ...cardStyle, padding: 24, width: 420, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px', color: 'var(--foreground)' }}>
        Konfirmasi Re-parse Legend
      </h2>
      <p style={{ fontSize: 13, color: 'var(--foreground-muted)', lineHeight: 1.5, marginBottom: 20 }}>
        Apakah Anda yakin ingin mengekstrak ulang dokumen Legend ini?
        <br /><br />
        <strong style={{ color: 'var(--danger)' }}>Perhatian:</strong> Tindakan ini akan <strong>menghapus seluruh {symbols.length} simbol</strong> (termasuk editan manual) dan menggantikannya dengan hasil analisis AI yang baru.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => setConfirmReparse(false)} style={secondaryButtonStyle}>
          Batal
        </button>
        <button
          onClick={() => { setConfirmReparse(false); handleReparse(); }}
          style={{ ...primaryButtonStyle, background: 'var(--danger)', borderColor: 'var(--danger)' }}
        >
          Ya, Jalankan Re-parse
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 2: Wrap reparse database operations in an explicit PostgreSQL Transaction**
In `app/api/legends/[id]/reparse/route.ts`:
- Acquire client: `const client = await db.connect();`
- `await client.query('BEGIN');`
- Verify legend exists: `const leg = await client.query('SELECT id FROM legends WHERE id = $1 FOR UPDATE', [id]);`
- If not found, rollback and return 404.
- `await client.query('DELETE FROM legend_symbols WHERE legend_id = $1', [id]);`
- Insert newly extracted symbols using `client.query`.
- `await client.query('COMMIT');`
- Catch block: `await client.query('ROLLBACK');`
- Finally: `client.release();`

**Step 3: Commit**
```bash
git add app/legends/[id]/review/page.tsx app/api/legends/[id]/reparse/route.ts
git commit -m "fix(legend): add reparse confirmation modal and wrap in atomic db transaction"
```

---

### Task 4: Parse & Reparse Speed Optimization (Grid Reduction & Parallel Cropping)

**Files:**
- Modify: `lib/env.ts`
- Modify: `lib/tuning.ts`
- Modify: `lib/legend-extract.ts`
- Modify: `app/api/legends/[id]/reparse/route.ts`

**Step 1: Reduce default landscape grid dimensions**
In `lib/env.ts`:
```ts
LEGEND_REGION_COLS_LANDSCAPE: z.coerce.number().int().min(0).max(12).default(2), // was 6
LEGEND_REGION_ROWS: z.coerce.number().int().min(0).max(12).default(2), // was 4
```
This reduces the sequential region calls from 24 to **4 regions** (a 6x drop in calls).

**Step 2: Parallelize image cropping in reparse**
In `app/api/legends/[id]/reparse/route.ts`, process crops with `Promise.all` in chunks of 5 rather than serial iteration:
```ts
// Parallelize reference image cropping in batches of 5
const BATCH_SIZE = 5;
const enrichedSymbols = [];
for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
  const batch = symbols.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(
    batch.map(async (s) => {
      const { refUrl, refHash } = await cropAndSaveSymbol(
        pngBase64,
        { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h },
        pngW, pngH, id, page, 0.05
      );
      return { ...s, refUrl, refHash };
    })
  );
  enrichedSymbols.push(...results);
}
```

**Step 3: Run test script to verify parse & reparse duration**
Execute a test parse script to verify execution finishes in < 25 seconds without timeouts or 429 errors.

**Step 4: Commit**
```bash
git add lib/env.ts lib/tuning.ts lib/legend-extract.ts app/api/legends/[id]/reparse/route.ts
git commit -m "perf(legend): optimize region grid to 2x2 and parallelize symbol crop saving"
```

---

### Task 5: End-to-End Verification & Sanity Check

**Files:**
- All modified files

**Step 1: Run TypeScript compiler and linter check**
Run: `npm run lint` or `npx tsc --noEmit`
Expected: 0 errors.

**Step 2: End-to-end user flow verification**
1. Navigate to `/legends/new` -> try uploading multi-page PDF -> verify blocked.
2. Upload 1-page legend -> verify fast parse (~20s).
3. In `/legends/[id]/review` -> click symbol bbox, press `Del` -> verify immediate removal.
4. Click "Re-parse" -> verify modal appears -> confirm -> verify successful re-parse without FK violation.
5. In `/detection` -> select detection bbox, press `Del` -> verify rejected.

**Step 3: Final Commit & Summary**
```bash
git commit -m "chore: complete legend qa revisions verification"
```
