# Design Document: Halaman Pedoman Penggunaan Aplikasi (User Guide)

- **Tanggal:** 2026-10-28
- **Rute:** `/guide`
- **Status:** Approved by User

---

## 1. Latar Belakang & Tujuan
Aplikasi Automatic Asset Detection memiliki alur kerja teknis multi-langkah:
`Project Management ➔ Legend Library ➔ Document Upload ➔ AI Detection ➔ Interactive Review ➔ MDO Flow & Export`.

Halaman `/guide` disediakan untuk memandu pengguna baru dan tim operasi agar memahami setiap alur secara menyeluruh (*end-to-end*) tanpa membingungkan mereka dengan hak akses administratif (`/users`) yang tidak relevan bagi pengguna umum.

---

## 2. Arsitektur Tata Letak (Layout)
Format yang digunakan adalah **Dokumentasi Modern dengan Sticky Table of Contents (Dua Kolom Responsif)**:

1. **Kolom Utama (~75% lebar):**
   - Breadcrumbs: `Dashboard > User Guide`
   - Header deskriptif dengan ikon `BookOpenCheck`
   - Konten 8 bab bertahap dengan diagram Mermaid, kartu alur, badge status, tabel panduan, dan callout alerts (`TIP`, `IMPORTANT`, `NOTE`).
2. **Kolom Kanan (~25% lebar, Sticky):**
   - Menempel saat di-scroll ke bawah.
   - Daftar isi 8 bab dengan active link highlight berdasarkan posisi scroll (`IntersectionObserver` atau scroll spy).
   - Tombol cepat *"Kembali ke Atas"*.

---

## 3. Struktur Materi Pedoman (8 Bab)

### Bab 1: Ikhtisar & Prinsip Human-in-the-Loop
- Tujuan sistem: ekstraksi instrumen & peralatan fisik dari gambar teknik P&ID (PDF & DXF).
- Diagram alur data end-to-end.
- Prinsip AI sebagai akselerator, dengan verifikasi akhir oleh engineer manusia.

### Bab 2: Manajemen Project & Kolaborasi Tim
- **Visibilitas Project:** `PRIVATE` (hanya pemilik) vs `PUBLIC` (semua user dapat melihat/meng-clone).
- **Sharing Code:** Menggunakan kode unik 8-karakter (misal `PRJ-9X2K`) untuk membagikan proyek privat kepada rekan kerja via fitur *Join via Code*.
- **Clone Public to Private:** Menyalin proyek publik menjadi salinan *Private Copy* mandiri di workspace user untuk eksplorasi dan modifikasi tanpa mengubah data sumber.

### Bab 3: Menyiapkan Standar Legend Library
- Mengapa Legend krusial: kamus acuan penafsiran simbol & tag spesifik fasilitas.
- Ekstraksi AI dari PDF Legend standar pabrik.
- Konfigurasi pola tag (*Tag Pattern*: `P-###`, `V-###`, `XV-###`, dll.).
- Validasi status crop simbol (`VALIDATED`) untuk *few-shot visual reference crops*.

### Bab 4: Manajemen Dokumen (PDF & AutoCAD DXF)
- Perbedaan penanganan berkas PDF (resolusi tinggi 200–300 DPI, diolah via AI Multimodal Vision ber-tiling) vs berkas AutoCAD DXF (vektor murni via DXF Vector Geometry Engine).
- Mengelompokkan dokumen ke dalam Project.

### Bab 5: Menjalankan Deteksi AI (Run Detection)
- Memilih Dokumen P&ID target dan Legend acuan.
- Arsitektur antrean asinkron latar belakang (*BullMQ & Redis*).
- Status pekerjaan: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`.

### Bab 6: Workspace Review Interaktif (Kanvas P&ID & Tabel)
- P&ID Viewer: Zoom, Pan, dan Bounding Box highlights.
- Sinkronisasi dua arah: klik baris tabel menyorot kanvas; klik kotak di kanvas menyorot baris tabel.
- Arti status: 🟢 `VALID`, 🟡 `NEEDS_REVIEW`, 🔴 `CONFLICT`.
- 4 Aksi Reviewer: **Confirm**, **Edit**, **Reject**, dan **Manual Add**.

### Bab 7: MDO Flow & Export MDO
- Membuka halaman MDO Flow (`/mdo`).
- Pengayaan data otomatis (*MDO Enrichment*): `Equipment`, `Tag No Proposed`, `Size & Dimension`, `From / To / Of / At`, dan `Description Proposed`.
- Peninjauan persetujuan: *Approve*, *Reject*, atau *Approve All*.
- Tombol **Export MDO** untuk mengunduh spreadsheet MDO resmi siap pakai untuk CMMS/ERP. Data berstatus `REJECTED` otomatis dikeluarkan dari ekspor.

### Bab 8: Tips Praktis & Pemecahan Masalah (Troubleshooting)
- Mengatasi tag kecil atau padat melalui *Tiled Region Detection*.
- Menyatukan kotak deteksi ganda menggunakan tombol *Deduplicate*.
- Pengaturan Engine AI (Gemini, OpenAI, Anthropic) di halaman *Settings*.

---

## 4. Rencana File yang Dibuat / Diubah
1. `app/guide/page.tsx`: Halaman utama User Guide dengan layout dua kolom dan 8 bab dokumentasi.
2. `app/sidebar-nav.tsx`: Menambahkan menu `User Guide` dengan ikon `BookOpenCheck`.
3. `components/Breadcrumbs.tsx`: Memastikan rute `/guide` dipetakan dengan label `"User Guide"`.
