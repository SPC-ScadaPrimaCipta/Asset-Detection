# User Guide Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Membangun halaman Pedoman Penggunaan Aplikasi (User Guide) di `/guide` dengan layout dua kolom (konten utama + sticky table of contents) yang mencakup 8 bab operasional end-to-end, termasuk panduan Project Management (Sharing Code & Clone) dan MDO Flow & Export.

**Architecture:** Halaman client-rendered di App Router Next.js (`app/guide/page.tsx`) dengan integrasi navigasi sidebar (`app/sidebar-nav.tsx`) dan breadcrumbs (`components/Breadcrumbs.tsx`). Halaman dibagi menjadi dua kolom: konten utama berisi 8 bab terstruktur dengan kartu visual dan callouts, serta kolom samping sticky table of contents dengan scroll-spy aktif.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Lucide Icons, CSS Variable tokens (Promia/Asset-Detection design system).

---

### Task 1: Navigasi & Breadcrumbs Integration

**Files:**
- Modify: `app/sidebar-nav.tsx`
- Modify: `components/Breadcrumbs.tsx`

**Step 1: Modifikasi sidebar-nav.tsx**
Tambahkan item menu `User Guide` dengan ikon `BookOpenCheck` dari `lucide-react` ke dalam array `MENU_ITEMS`. Posisikan setelah `MDO Flow` / `Documents`, sebelum `Settings`.

**Step 2: Modifikasi Breadcrumbs.tsx**
Pastikan mapping segment `'guide'` memiliki label yang rapi: `'User Guide'`.

**Step 3: Verifikasi Navigasi**
Jalankan pemeriksaan sintaks TypeScript via `npx tsc --noEmit` untuk memastikan tidak ada kesalahan tipe data.

---

### Task 2: Pembangunan Halaman User Guide (`app/guide/page.tsx`)

**Files:**
- Create: `app/guide/page.tsx`

**Step 1: Susun Layout Dua Kolom**
- Grid container: Kolom kiri (lebar ~75%) untuk artikel dokumentasi, kolom kanan (lebar ~25%, `position: sticky`, `top: 24px`) untuk daftar isi.
- Gunakan CSS design system token yang sudah ada (`cardStyle`, `var(--surface)`, `var(--primary)`, `var(--border)`, dll.).

**Step 2: Implementasi Sticky Table of Contents & Scroll Spy**
- Daftar 8 item navigasi bertaut ke anchor id:
  1. `#overview` (Bab 1: Ikhtisar & Prinsip Human-in-the-Loop)
  2. `#project-management` (Bab 2: Manajemen Project & Kolaborasi)
  3. `#legend-library` (Bab 3: Standar Legend Library)
  4. `#document-management` (Bab 4: Manajemen Dokumen PDF/DXF)
  5. `#ai-detection` (Bab 5: Menjalankan Deteksi AI)
  6. `#interactive-review` (Bab 6: Workspace Review Interaktif)
  7. `#mdo-flow` (Bab 7: MDO Flow & Export MDO)
  8. `#troubleshooting` (Bab 8: Tips Praktis & Troubleshooting)
- Gunakan event listener scroll atau `IntersectionObserver` ringan untuk memperbarui active state TOC saat user membaca.
- Tambahkan tombol pintas *"Kembali ke Atas"*.

**Step 3: Tulis Konten Lengkap 8 Bab**
Sajikan materi detail sesuai dokumen desain yang disetujui:
- Visual flowchart alur kerja.
- Panduan Sharing Code, Join via Code, dan Clone Public to Private.
- Panduan ekstraksi Legend, Tag Patterns, dan Validated crops.
- Perbedaan PDF vs DXF.
- Background worker & status deteksi.
- P&ID Viewer, Bounding box, dan arti status `VALID`/`NEEDS_REVIEW`/`CONFLICT`.
- MDO Enrichment, Approval, dan Export MDO.
- Tips praktis (tag rapat, deduplikasi).

---

### Task 3: Verifikasi Build & Ponytail Review

**Step 1: Production Build Verification**
Jalankan: `npm run build`
Ekspektasi: Build berhasil 100% dengan rute baru `/guide` terdaftar sebagai static/prerendered route tanpa error TypeScript.

**Step 2: Review Kualitas Kode (Ponytail Review)**
Periksa diff kode, pastikan tidak ada dependensi eksternal baru atau bloatware yang tidak diperlukan.

**Step 3: Commit Git**
Jalankan commit bersih ke branch kerja:
`git commit -m "feat(guide): add comprehensive user guide page with sticky TOC and MDO workflow"`

