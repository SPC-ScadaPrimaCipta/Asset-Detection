# Manual Asset Addition in Detection & Asset Register Removal Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Menghapus halaman Asset Register dari aplikasi dan navigasi, menambahkan fitur seleksi bounding box manual pada PDF Viewer di halaman Detection, serta mengintegrasikan asset manual tersebut secara langsung ke dalam alur proses MDO Flow.

**Architecture:** Bounding box interaktif digambar langsung di atas layer SVG koordinat (0–1000) pada PDF Viewer di halaman Detection. Data asset yang diinput pengguna disimpan ke tabel PostgreSQL `detections` melalui endpoint `POST /api/detections/manual` dengan status `MANUAL` & `APPROVED`. Generator MDO kemudian secara otomatis menyertakan asset ini ketika memproses alur proses dan merakit deskripsi MDO.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript, PostgreSQL (`pg`), Phosphor Icons, Tailwind CSS / Vanilla CSS tokens.

---

### Task 1: Hapus Halaman Asset Register dan Bersihkan Navigasi

**Files:**
- Delete: `app/assets/page.tsx`
- Delete: `app/asset-register/page.tsx`
- Modify: `app/sidebar-nav.tsx:26`
- Modify: `components/Header.tsx:25`
- Modify: `components/dashboard/VerificationStatusCard.tsx:128`

**Step 1: Hapus folder dan halaman `/assets` dan `/asset-register`**
Hapus file `app/assets/page.tsx` dan `app/asset-register/page.tsx` beserta foldernya.

**Step 2: Perbarui menu navigasi di `app/sidebar-nav.tsx`**
Hapus item `{ href: '/assets', label: 'Asset Register', icon: Layers }` dari `MENU_ITEMS`.

**Step 3: Arahkan pencarian header dan link verifikasi dashboard ke Detection**
- Di `components/Header.tsx`, ubah rute submit search dari `/assets?q=...` menjadi `/detection?q=...`.
- Di `components/dashboard/VerificationStatusCard.tsx`, ubah tautan tombol review dari `/assets` menjadi `/detection`.

**Step 4: Jalankan verifikasi lint dan build**
Run: `npm run lint`
Expected: Tidak ada error import atau link mati.

**Step 5: Commit**
```bash
git add -A
git commit -m "feat(nav): remove asset register pages and update navigation to detection"
```

---

### Task 2: Buat Endpoint Backend `POST /api/detections/manual`

**Files:**
- Create: `app/api/detections/manual/route.ts`

**Step 1: Tulis route handler untuk penambahan deteksi manual**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { documentId, pidPage, assetTag, assetType, description, service, size, bbox } = body;

    if (!documentId || !assetTag || !assetType) {
      return NextResponse.json(
        { error: 'documentId, assetTag, and assetType are required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const x = bbox?.x != null ? Math.round(bbox.x) : 500;
    const y = bbox?.y != null ? Math.round(bbox.y) : 500;
    const w = bbox?.width != null ? Math.round(bbox.width) : 50;
    const h = bbox?.height != null ? Math.round(bbox.height) : 50;
    const pageNum = pidPage ? Number(pidPage) : 1;

    const sql = `
      INSERT INTO detections (
        id, document_id, pid_page, asset_tag, asset_type,
        description, service, size,
        bbox_x, bbox_y, bbox_w, bbox_h,
        confidence, detection_status, review_status,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        1.0, 'MANUAL', 'APPROVED',
        NOW(), NOW()
      )
      RETURNING *;
    `;

    const res = await db.query(sql, [
      id,
      documentId,
      pageNum,
      assetTag.trim().toUpperCase(),
      assetType.trim(),
      description?.trim() || null,
      service?.trim() || null,
      size?.trim() || null,
      x,
      y,
      w,
      h,
    ]);

    return NextResponse.json({ success: true, data: res.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error('[detections/manual POST]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Test endpoint dengan curl / fetch**
Run test request ke server lokal dan pastikan status 201 mengembalikan data deteksi baru.

**Step 3: Commit**
```bash
git add app/api/detections/manual/route.ts
git commit -m "feat(api): add manual detection endpoint POST /api/detections/manual"
```

---

### Task 3: Buat Komponen Modal `AddManualAssetModal`

**Files:**
- Create: `components/detection/AddManualAssetModal.tsx`

**Step 1: Implementasi komponen modal input asset**
Komponen modal dengan styling modern Neuro:
- Header: "Add Asset Manually" dengan indikator nomor halaman dan koordinat BBox.
- Input Fields:
  - Asset Tag (input text kapital otomatis, placeholder contoh: `P-101A`, `V-201`)
  - Asset Type (select / input dengan opsi umum: `Pump`, `Vessel`, `Heat Exchanger`, `Valve`, `Control Valve`, `Tank`, `Compressor`, `Filter`, `Instrument`)
  - Description (input text, contoh: `Crude Oil Booster Pump`)
  - Service (input text, contoh: `Hydrocarbon / Crude Oil`)
  - Size (input text, contoh: `4 inch`, `DN100`)
- Validasi form & tombol Save (loading state saat menyimpan).

**Step 2: Commit**
```bash
git add components/detection/AddManualAssetModal.tsx
git commit -m "feat(ui): create AddManualAssetModal component"
```

---

### Task 4: Integrasikan Mode Drawing & Add Asset Manual ke Viewer Halaman Detection

**Files:**
- Modify: `app/detection/page.tsx`

**Step 1: Tambahkan state drawing dan modal ke `app/detection/page.tsx`**
- State: `isDrawingMode` (boolean), `drawingBox` (koordinat awal & berjalan), `newAssetModalOpen` (boolean), `pendingBbox` (koordinat hasil seleksi).
- Tambahkan tombol `+ Add Asset Manual` di toolbar atas viewer P&ID (sebelah kanan kontrol zoom).

**Step 2: Tambahkan layer interaksi drawing pada Canvas Viewport**
- Saat `isDrawingMode === true`, cursor viewer diubah ke `crosshair` dan pan/drag gambar dinonaktifkan.
- Tangani event mouse pada kontainer gambar:
  - `onMouseDown`: Rekam koordinat awal (dinormalisasi ke 0–1000).
  - `onMouseMove`: Perbarui lebar dan tinggi persegi seleksi secara real-time.
  - `onMouseUp`: Jika ukuran persegi > 10 unit, simpan ke `pendingBbox`, nonaktifkan `isDrawingMode`, dan buka `AddManualAssetModal`.
- Render SVG rectangle semi-transparan dengan aksen biru/hijau dan garis putus-putus (`stroke-dasharray="4"`) selama proses penarikan kotak.

**Step 3: Hubungkan callback penyimpanan asset**
- Saat modal berhasil menyimpan asset via API `POST /api/detections/manual`:
  - Tambahkan item baru ke state `detections`.
  - Pilih asset baru tersebut (`setSelectedId(newItem.id)`).
  - Bounding box langsung ter-render sebagai kotak hijau (`APPROVED`).

**Step 4: Commit**
```bash
git add app/detection/page.tsx
git commit -m "feat(detection): integrate manual asset drawing and submission flow in viewer"
```

---

### Task 5: End-to-End Verification & Build Gate

**Files:**
- Test all related endpoints and pages

**Step 1: Jalankan build Next.js**
Run: `npm run build`
Expected: Build berhasil tanpa error TypeScript atau kompilasi bundler.

**Step 2: Verifikasi Alur Pengguna (Browser / E2E)**
1. Akses halaman `/detection`.
2. Klik tombol `+ Add Asset Manual`.
3. Lakukan drag pada preview P&ID untuk membuat bounding box di atas salah satu simbol.
4. Isi kelengkapan data (Tag, Type, Description).
5. Klik **Save Asset**.
6. Verifikasi asset baru muncul di list samping dan ter-highlight di gambar.
7. Klik tombol **Proceed to MDO** -> Verifikasi asset baru tersebut muncul dalam daftar record MDO saat diperkaya.

**Step 3: Update Task Tracker**
Update `docs/plans/task.md` untuk menandai semua task telah selesai.

**Step 4: Final Commit**
```bash
git add -A
git commit -m "chore: complete manual asset detection and MDO integration"
```
