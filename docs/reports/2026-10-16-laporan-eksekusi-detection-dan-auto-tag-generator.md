# Laporan Eksekusi: Peningkatan Detection & Automatic Fallback Tag Generator Berbasis Legend & Project

**Tanggal:** 16 Oktober 2026  
**Status:** Sukses Diimplementasikan & Terverifikasi (All Tests Passed)  
**Lingkup Pekerjaan:**
1. **Opsi 1 — Peningkatan Asosiasi Tag & OCR (Adaptive Crop + Fallback Template Matching)**
2. **Fitur Baru — Automatic Fallback Tag Generator dengan Project-Level Uniqueness & Legend Customization**

---

## 1. Latar Belakang & Masalah yang Diselesaikan

Dalam analisis pipeline deteksi gambar P&ID/PFD sebelumnya, ditemukan beberapa tantangan penting dalam alur kerja industri:
1. **Banyak Simbol Tanpa Tag Fisik (No Physical Tag on Drawing):**
   - Pada standar gambar teknik P&ID, banyak simbol pipa/fitting (misal Gate Valve, Check Valve, Reducer, Flange) tidak memiliki label tag teks fisik di gambar.
   - Tanpa tag, aset tersebut berstatus `no tag` dan menyulitkan identifikasi pada *Asset Register* maupun pembuatan Purchase Order / Maintenance Tracking.
2. **Kebutuhan Format Prefix Kustom per Simbol Legenda:**
   - Standar penamaan berbeda di tiap pabrik. Contoh: *Gate Valve* ada yang menggunakan `GTV-###`, `GV-###`, atau `VLV-####`.
   - Pengguna membutuhkan fleksibilitas konfigurasi di tingkat Legenda per simbol aset, bukan di-hardcode secara global.
3. **Syarat Kritis: Project-Level Tag Uniqueness:**
   - Dalam satu proyek pabrik (`project_id`), seluruh aset harus memiliki nomor tag yang tunggal/unik (tidak boleh ada dua aset dengan tag yang sama dalam satu proyek, meskipun berada di lembar dokumen P&ID yang berbeda).
   - Penomoran otomatis harus melanjutkan nomor urut tertinggi yang belum terpakai pada proyek tersebut (`max + 1`).
4. **Bantuan Otomatis (Auto-Suggest):**
   - Legenda bisa memiliki puluhan hingga ratusan simbol. Pengguna tidak boleh dibebani mengetik singkatan satu per satu secara manual. Dibutuhkan tombol bantuan pintar yang mengisi singkatan baku industri (ISA 5.1 / PIP P&ID) secara instan.
5. **Crop OCR Terlalu Sempit (+8px) & 0 Kandidat BBox:**
   - Teks tag sering berada di atas/bawah/samping simbol. Margin 8px sering memotong teks tag.
   - Jika YOLO menghasilkan 0 kandidat, deteksi langsung gagal tanpa jaring pengaman.

---

## 2. Rincian Implementasi

### A. Opsi 1 — Peningkatan Asosiasi Tag & OCR
1. **Adaptive Tag Region Crop (`lib/ocr-engine.ts`):**
   - Mengimplementasikan `calculateAdaptiveTagBBox` dengan ekspansi vertikal **+90px** dan horizontal **+70px** dari batas bounding box simbol.
   - Mengimplementasikan `cropAdaptiveTagRegionFromBuffer` dan fungsi pembersih teks `extractBestTagFromText`.
2. **Dual-Crop Architecture & Stage 1.5 Template Matching (`lib/detection/hybrid-pipeline.ts`):**
   - Pemisahan crop: crop ketat 8px tetap dipakai untuk identitas visual, visual hash, dan verifikasi Gemini, sedangkan crop adaptif dikhususkan untuk engine OCR.
   - Menyisipkan Stage 1.5 Fallback Template Matching: jika YOLO menghasilkan 0 kandidat pada gambar uji, OpenCV template matching otomatis dipicu sebagai pengaman.
3. **Hasil Verifikasi Opsi 1:**
   - `__tests__/adaptive-ocr-crop.test.ts` (6 passed).
   - `__tests__/hybrid-template-fallback.test.ts` (2 passed).

---

### B. Fitur Baru — Automatic Fallback Tag Generator

#### 1. Modul Generator Tag Cerdas (`lib/tag-generator.ts`)
- **Kamus Baku Industri ISA 5.1 & PIP P&ID (`suggestAbbreviation`):**
  - Pemetaan instan untuk jenis valve: Gate Valve (`GTV`), Ball Valve (`BV`), Globe Valve (`GLV`), Check Valve (`CV`), Control Valve (`FCV`), Pressure Relief Valve (`PSV`), dll.
  - Peralatan statis & berputar: Centrifugal Pump / Pump (`P`), Compressor (`C`), Heat Exchanger (`E`), Tank (`TK`), Vessel (`V`), Heater (`H`), Motor (`M`), Fan (`B`), Filter (`FLT`).
  - Instrumen & Transmitter: `PT`, `PI`, `TT`, `TI`, `FT`, `LT`, dll.
  - Heuristik akronim otomatis untuk nama alat kustom (contoh: *High Pressure Separator* $\rightarrow$ `HPS`).
- **Project-Level Incremental Tag Allocator (`allocateNextProjectTag`):**
  - Menganalisis seluruh tag proyek yang memiliki prefix serupa.
  - Mengambil nomor urut tertinggi (`maxNum`) dan mengalokasikan nomor berikutnya (`maxNum + 1`), diformat dengan padding digit (misal 3 digit `001` atau 4 digit `0001`).
  - Menjamin pencegahan tabrakan (*collision-free*).
- **Project Tag Registry Loader (`loadProjectExistingTags`):**
  - Membaca seluruh `asset_tag` yang aktif di database pada level `project_id`.
- **Pipeline Auto-Tagging Applicator (`applyProjectAutoTagging`):**
  - Mengiterasi deteksi: jika tag fisik ada dari OCR/teks gambar, tag tersebut dipertahankan dan didaftarkan ke registry.
  - Jika tag kosong/null, sistem mengambil pola `tag_pattern` dari simbol legenda (atau fallback ke saran singkatan), mengalokasikan nomor urut baru, menyematkannya ke deteksi, dan mencatat bukti audit `[Auto-Tag] Generated unique project tag ...`.

#### 2. Batch Update API Simbol Legenda (`app/api/legends/[id]/symbols/batch/route.ts`)
- Endpoint HTTP `PUT` dengan validasi Zod untuk memperbarui `tag_pattern` secara massal.
- Proteksi terhadap *built-in standard legends* dan validasi pola regex (`^[A-Z]{1,6}-[\#\*\d]{1,6}[A-Z]{0,2}$`).
- Pengujian unit: `__tests__/legend-symbols-batch.test.ts` (3 passed).

#### 3. Modal UI "Tag Patterns & Auto-Generate Manager" (`app/legends/[id]/page.tsx`)
- Ditambahkan tombol **`🏷️ Manage Tag Patterns`** pada header halaman detail Legenda.
- Menampilkan modal komprehensif:
  - Header dengan status statistik: jumlah simbol yang sudah terisi pola vs total simbol.
  - Pilihan format digit: **3 Digit (`###`)** atau **4 Digit (`####`)**.
  - Tombol **`⚡ Auto-Suggest Empty`**: mengisi pola simbol yang masih kosong dengan singkatan baku industri hanya dalam 1 klik.
  - Tombol **`🔄 Reset All to Standards`**: menyetel ulang semua simbol ke standar industri.
  - Filter pencarian cepat (*search bar*) berdasarkan tipe aset atau nama simbol.
  - Tabel interaktif dengan pratinjau saran standar, input pola kustom per baris, dan tombol simpan massal.

#### 4. Integrasi Pipeline Deteksi (`workers/detection-worker.ts`)
- Saat job deteksi dijalankan, worker membaca registry tag yang sudah terpakai di level proyek:
  `const existingProjectTags = await loadProjectExistingTags(db, effectiveProjectId);`
- Sebelum persistensi ke database:
  - Pada jalur **DXF**: `applyProjectAutoTagging` mengalokasikan tag unik untuk blok/entitas yang tidak memiliki atribut tag.
  - Pada jalur **PDF** (baik YOLO Hybrid maupun Gemini Vision): `applyProjectAutoTagging` mengalokasikan tag unik untuk deteksi tanpa tag OCR.
  - Memori `existingProjectTags` diperbarui secara real-time antar lembar halaman dokumen sehingga nomor urut di halaman 2, 3, dst. selalu melanjutkan nomor urut sebelumnya tanpa tabrakan.

#### 5. Visual Indicator di Detection Review UI (`app/detection/page.tsx`)
- Helper `isAutoGeneratedTag` membaca jejak audit evidence.
- Pada **Tabel Deteksi Review**, tag yang dihasilkan otomatis diberi visual badge biru kecil: **`[Auto]`** dengan tooltip informatif.
- Pada **Detail Drawer**, header menampilkan indikator status **`Auto Tag`**.

---

## 3. Matriks Hasil Pengujian (Test Suites)

| Test Suite File | Uraian Skenario | Status |
|---|---|---|
| `__tests__/adaptive-ocr-crop.test.ts` | BBox adaptif (+70px horizontal, +90px vertikal), OCR crop buffer, ekstraksi tag regex | **PASS (6/6)** |
| `__tests__/hybrid-template-fallback.test.ts` | OpenCV template matching fallback saat 0 kandidat YOLO | **PASS (2/2)** |
| `__tests__/tag-generator.test.ts` | ISA 5.1/PIP abbreviation, acronym heuristic, formatting, incremental allocation, case-insensitivity, auto-tagging | **PASS (14/14)** |
| `__tests__/legend-symbols-batch.test.ts` | Batch API update `tag_pattern`, 404 legend not found, 403 built-in guard, regex validation | **PASS (3/3)** |
| `__tests__/auto-tag-pipeline.test.ts` | Integrasi pipeline: load project tags dari DB, pencegahan tabrakan multi-halaman/multi-dokumen, pelestarian tag OCR | **PASS (3/3)** |

---

## 4. Panduan Penggunaan untuk Pengguna

1. **Mengatur Format Awalan Tag di Legenda:**
   - Buka menu **Legends** $\rightarrow$ pilih Legenda pabrik yang diinginkan.
   - Klik tombol **`🏷️ Manage Tag Patterns`** di kanan atas.
   - Klik tombol **`⚡ Auto-Suggest Empty`** untuk mengisi otomatis semua simbol dengan singkatan baku industri (misal Gate Valve $\rightarrow$ `GTV-###`, Centrifugal Pump $\rightarrow$ `P-###`).
   - Ubah huruf awalan atau pilih format 4 digit (`####`) jika diperlukan.
   - Klik **Simpan Pola Tag**.
2. **Menjalankan Deteksi P&ID:**
   - Unggah dokumen P&ID pada Proyek dan jalankan deteksi (*Run Detection*).
   - Simbol yang memiliki tag teks fisik di gambar akan menggunakan tag OCR asli (misal `P-101A`).
   - Simbol yang tidak memiliki tag fisik akan otomatis dibuatkan tag unik berurutan berdasarkan pola legenda (misal `GTV-001`, `GTV-002`, dst.) dan dijamin tidak akan pernah duplikat dengan dokumen lain di proyek tersebut.
3. **Review Hasil Deteksi:**
   - Pada halaman **Detection Review**, tag otomatis akan ditandai dengan badge biru **`[Auto]`** untuk memudahkan verifikasi engineer sebelum diekspor ke Asset Register Excel.
