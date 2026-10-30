# Laporan Pelaksanaan Fitur: Deteksi Ukuran Valve dari Piping Line & Format Excel Asset Register

Tanggal: 19 Oktober 2026  
Branch: `raden-ihsan/dev-v3.5`  
Status: **SELESAI & TERVERIFIKASI (100% PASS)**

---

## 1. Ringkasan Eksekutif

Fitur ini menjawab kebutuhan operasional untuk mendeteksi ukuran fisik valve (katup industri) secara otomatis dari nomor jalur pipa (piping line number) yang terhubung atau berdekatan pada dokumen P&ID / PFD (baik berkas CAD DXF maupun dokumen PDF). 

Selain itu, template ekspor Excel Asset Register (`Asset_Register.xlsx`) telah diselaraskan secara penuh dengan format 29 kolom industri pengguna, di mana kolom **Size** kini menjadi kolom mandiri (Kolom 6) dengan styling header hijau `#70AD47` dan teks merah `#C00000` pada kolom primary teknis.

---

## 2. Arsitektur & Solusi Teknis (*Approach 1: Hybrid Spatial & Line Spec Extractor*)

Solusi dibangun menggunakan pendekatan hibrida deterministik tanpa membebani model AI visi dengan halusinasi token:

```text
                  Dokumen P&ID (DXF / PDF)
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
       CAD (DXF)                          PDF P&ID
  Line Segment Traversal          MuPDF Structured Text Extraction
  + Collinear Vector Angle       + Raycast & Proximity Search (600px)
            │                                 │
            └────────────────┬────────────────┘
                             ▼
                 Piping Spec Parser Engine
                    (`piping-parser.ts`)
         Format Imperial (2", 4", 1 1/2") & Metrik (DN100)
                             │
                             ▼
                    Inferred Valve Size
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   Detection Persistence              Asset Register Export
   (`detections` & `assets`)         (`lib/excel-export.ts`)
   - Drawer View & Edit              - Dedicated Column 6 (Size)
   - Table Sorting & Search          - 29 Kolom Format Standar SAP
```

---

## 3. Rincian Modul & Implementasi

### A. Line Spec & Piping Parser Engine (`lib/piping-parser.ts`)
- **Fungsi:** `parsePipingLineSpec(text: string): ParsedPipingSpec | null` dan `extractPipingSize(text: string): string | null`.
- **Dukungan Format:**
  - Imperial standar dan petik lengkung: `2”-WS-B-007` $\rightarrow$ `2"`, `4"-NG-B3CS2F-01-004` $\rightarrow$ `4"`, `1 1/2"-P` $\rightarrow$ `1 1/2"`, `0.75"-CW` $\rightarrow$ `0.75"`.
  - Format metrik internasional: `DN100-WS-001` $\rightarrow$ `DN100`, `DN 50` $\rightarrow$ `DN50`.
  - Mengabaikan teks non-pipa (seperti nomor tag alat `P-101`, nomor lembar `SHEET-01`, koordinat gambar).

### B. CAD DXF Collinear Association (`lib/dxf-detection.ts`)
- **Logika:** Menginspeksi entitas `LINE`, `LWPOLYLINE`, `TEXT`, dan `MTEXT` pada berkas DXF.
- **Geometri:** Menemukan garis pipa yang melewati atau memotong bounding box valve, lalu menelusuri teks label pipa yang sejajar (collinear projection $\le 450$ unit, orthogonal offset $\le 120$ unit, rotasi sudut $\le 15^\circ$).

### C. PDF Spatial Line Association (`lib/spatial-piping.ts`)
- **Ekstraksi Super Cepat:** Memanfaatkan C++ native binding `page.toStructuredText().asJSON()` dari `mupdf` untuk membaca semua token teks beserta posisi bounding box kanvas secara instan dalam memori tanpa spawn child process atau overhead OCR tambahan.
- **Pencarian Spasial Berarah:** Menghitung jarak Euclidean dan proyeksi horizontal/vertikal (radius $R = 600\text{ px}$ kanvas) dari tengah simbol valve ke label jalur pipa terdekat.

### D. Persistence Repository & API Synchronization
- **File:** `lib/detection/persistence/detection-repository.ts`, `app/api/detections/[id]/route.ts`, `app/api/detections/[id]/confirm/route.ts`, `app/api/detections/bulk/route.ts`, `app/api/assets/[id]/route.ts`, dan `app/api/assets/route.ts`.
- Menyimpan nilai ukuran ke kolom `size` di tabel `detections` dan menyalinnya secara konsisten ke tabel `assets` saat user melakukan konfirmasi (`confirm` maupun `bulk confirm`).
- Mengizinkan pengeditan manual ukuran melalui API PUT.

### E. Excel Asset Register Alignment (`lib/excel-export.ts`)
- **Struktur Kolom (29 Kolom):**
  1. `#`
  2. `Equipment` (Kode SAP default `EQ-000001` jika kosong)
  3. `Tag No Proposed`
  4. `Equipment Type`
  5. `For Description`
  6. **`Size` (Kolom Mandiri)**
  7. `From`
  8. `To`
  9. `Of`
  10. `At`
  11. `Tag Number`
  12. `Alternative Description by ACN (OLD)`
  13. `Alternative Description by ACN`
  14. `Description Proposed`
  15. `Description`
  16. `Len`
  17. `Class`
  18. `Object Type`
  19. `Type`
  20. `Weight`
  21. `UOM`
  22. `Inventory No.`
  23. `Size/Dimension`
  24. `Start-up Date`
  25. `Acquisition Value`
  26. `Currency`
  27. `Acquisition Date`
  28. `Location`
  29. `Manufacture Drawing No.`
- **Styling:**
  - Row 1: Kode SAP (Background kuning `#FFFFF2CC`, Font bold).
  - Row 2: Batas panjang karakter SAP (Background kuning `#FFFFF2CC`).
  - Row 3: Header kolom (Background hijau `#70AD47`, Teks merah `#C00000` pada kolom teknis utama).

### F. Antarmuka Pengguna (UI) Review & Asset Register
- **Detection Review (`app/detection/page.tsx`):**
  - Kolom `Size` pada tabel deteksi dengan styling badge monospace.
  - Sorting berdasarkan ukuran (`SortHeader col="size"`).
  - Filter pencarian cepat `q` yang mengenali ukuran (contoh: mengetik `2"` atau `DN100`).
  - Field `Size` pada detail drawer dan input form mode edit deteksi.
- **Asset Register (`app/assets/page.tsx`):**
  - Kolom `Size` pada tabel master register aset.
  - Tampilan field `Size` pada panel detail samping.
  - Input `Size` pada modal edit aset register.

---

## 4. Hasil Verifikasi Pengujian (TDD)

Seluruh rangkaian pengujian unit dan integrasi dijalankan dan diverifikasi:

| Test Suite | Fokus Pengujian | Status |
|---|---|---|
| `__tests__/piping-parser.test.ts` | Parsing nomor pipa imperial, pecahan, desimal, petik lengkung, metrik | **PASS (5/5)** |
| `__tests__/detection-repository-size.test.ts` | Persistensi kolom `size` pada query SQL INSERT/UPDATE | **PASS (1/1)** |
| `__tests__/dxf-piping-size.test.ts` | Deteksi ukuran valve dari garis pipa CAD DXF collinear | **PASS (3/3)** |
| `__tests__/spatial-piping.test.ts` | Asosiasi spasial ukuran pipa PDF ke valve | **PASS (4/4)** |
| `__tests__/excel-export-valve-size.test.ts` | Pembuatan file Excel 29 kolom dengan kolom 6 Size mandiri | **PASS (1/1)** |
| `__tests__/yolo-geo2-minimal-suite.test.ts` | Integritas pipeline ekspor, deteksi, dan tidak ada halusinasi | **PASS (12/12)** |

**Total:** 26/26 tests spesifik lulus (100% PASS), dan 689 tests pada keseluruhan test suite proyek lulus dengan sukses.
TypeScript type check (`npx tsc --noEmit`) pada seluruh folder aplikasi utama (`app/`, `lib/`, `workers/`) dinyatakan **0 error**.
