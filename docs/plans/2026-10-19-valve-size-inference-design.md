# Technical Design Document: Valve Size Inference from Piping Lines & Excel Asset Register Alignment

**Date:** 19 Oktober 2026  
**Status:** Approved by User  
**Target File / Plan:** `docs/plans/2026-10-19-valve-size-inference-design.md`  

---

## 1. Problem Statement & Business Objective

Pada gambar teknik industri (P&ID / PFD / CAD DXF), komponen **Valve** (Gate Valve, Ball Valve, Check Valve, Globe Valve, Control Valve, dll.) terpasang segaris pada jalur perpipaan (*piping line*). 

Dalam template Asset Register industri pengguna, kolom **Size** (ukuran nominal pipa/valve) merupakan atribut wajib yang selama ini sering kosong atau harus diketik manual satu per satu. 

Tujuan dari fitur ini adalah:
1. **Otomasi Inferensi Ukuran Valve:** Secara cerdas mendeteksi ukuran nominal pipa dari teks spesifikasi pipa di dekat valve (contoh: `2”-WS-B-007` $\rightarrow$ Valve size: `2"`, `4”-NG-B3CS2F-01-004` $\rightarrow$ Valve size: `4"`), baik pada garis horizontal maupun vertikal (rotasi 90°).
2. **Penyelarasan Format Excel Asset Register:** Menyesuaikan output [lib/excel-export.ts](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/lib/excel-export.ts) agar kolom `Size`, `From`, `To`, `Of`, `At` menjadi kolom independen dengan tata letak visual (header hijau, teks merah/hitam) persis seperti template bisnis riil pengguna.

---

## 2. Karakteristik Notasi Pipa & Aturan Inferensi (Inference Rules)

Berdasarkan sampel gambar riil yang diberikan:
1. **Format Teks Nomor Pipa:**
   - Contoh 1 (Horizontal): `2” - WS - B - 007` $\rightarrow$ Size = `2"`, Service = `WS`, Spec = `B-007`.
   - Contoh 2 (Horizontal): `4” - NG - B3CS2F - 01 - 004` $\rightarrow$ Size = `4"`, Service = `NG`, Spec = `B3CS2F-01-004`.
   - Contoh 3 (Vertikal - Rotasi 90°): `4” - NG - B8CS2F - A1 - 008` $\rightarrow$ Size = `4"`, Service = `NG`, Spec = `B8CS2F-A1-008`.
2. **Karakter Petik & Tanda Hubung:**
   - Mendukung petik lurus (`"`), petik ganda lengkung kanan (`”` / `\u201d`), dan petik ganda lengkung kiri (`“` / `\u201c`).
   - Mendukung tanda hubung biasa (`-`), en-dash (`–` / `\u2013`), em-dash (`—` / `\u2014`).
   - Mendukung format metrik (`DN15` s/d `DN1000`) dan pecahan imperial (`1/2"`, `3/4"`, `1-1/2"`).
3. **Hirarki Prioritas Penentuan Ukuran (Size Hierarchy):**
   - **Tingkat 1 (Explicit Valve Label):** Jika valve memiliki teks ukuran eksplisit tepat di samping simbol/tag-nya (misal `2"` pada Control Valve di pipa 4"), gunakan ukuran eksplisit tersebut.
   - **Tingkat 2 (Collinear / Nearest Piping Line):** Jika tidak ada ukuran khusus, valve mewarisi ukuran nominal dari label pipa terdekat yang collinear (segaris) dengan simbol valve.
   - **Tingkat 3 (Reviewer Manual Edit):** Jika tidak ada teks pipa yang terdeteksi, kolom `size` bernilai `null` dan dapat diisi/diedit oleh reviewer melalui UI.

---

## 3. Arsitektur Komponen

```
                  P&ID Document (PDF / DXF)
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [DXF Vector Pipeline]             [PDF Vision/OCR Pipeline]
   - Read LINE / LWPOLYLINE          - Render High-Res PNG
   - Match TEXT (0° / 90°)           - OCR line labels (0° & 90°)
   - Find valve intersection         - Spatial bounding box proximity
            │                                 │
            └────────────────┬────────────────┘
                             ▼
                 [lib/piping-parser.ts]
                 - Regex pattern match
                 - Extract size, service, spec
                             │
                             ▼
        [lib/detection/persistence/detection-repository.ts]
        - Save `size` to PostgreSQL (detections & assets)
        - Append audit evidence: `[Line-Size] Inferred 4" from ...`
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [Detection Review UI]             [Asset Register Excel Export]
   - View / Edit Size in drawer      - Dedicated 'Size' Column (#6)
   - Badge indication in table       - Full 29 SAP-compliant columns
```

---

## 4. Rincian Modul yang Diimplementasikan

### 4.1 Parser Nomor & Spesifikasi Pipa (`lib/piping-parser.ts`)
- Fungsi utama: `parseLineSpecText(text: string): ParsedLineSpec | null`
- Fungsi pendukung: `extractPipingSizesFromTokens(tokens: TextToken[]): DetectedPipeLine[]`
- Menangani normalisasi tanda kutip dan tanda hubung ke format standar `N"` atau `DN{N}`.

### 4.2 Asosiasi Spasial Pipa ke Valve (`lib/spatial-piping.ts`)
- **Untuk DXF (`lib/dxf-detection.ts`):**
  - Mengelompokkan entitas `LINE` yang membentuk jaringan pipa.
  - Memetakan teks pipa ke garis pipa terdekat.
  - Mengasosiasikan simbol valve yang titik pertemuannya berada pada garis pipa tersebut.
- **Untuk PDF (`workers/detection-worker.ts` & `lib/detection/hybrid-pipeline.ts`):**
  - Menerima token teks halaman dari OCR / MuPDF.
  - Menghitung jarak orthogonal (horizontal/vertikal) antara bounding box valve dan token line number.
  - Mengalokasikan ukuran pipa terdekat yang valid ke `detection.size`.

### 4.3 Persistensi Data (`lib/detection/persistence/detection-repository.ts`)
- Memperluas antarmuka `PersistableDetection` dengan `size?: string | null`.
- Menuliskan nilai `size` ke kolom `size` pada tabel `detections`.
- Saat deteksi dikonfirmasi (`APPROVED`), nilai `size` otomatis disalin ke tabel `assets`.

### 4.4 Antarmuka Pengguna (UI)
- **Review Detection Page (`app/detection/page.tsx`):**
  - Menampilkan kolom **Size** pada tabel daftar deteksi.
  - Menambahkan input field **Size** pada drawer detail agar pengguna bisa mengoreksi atau memasukkan ukuran secara manual.
- **Asset Register Page (`app/assets/page.tsx`):**
  - Menampilkan kolom **Size** pada tabel master aset.

### 4.5 Penyelarasan Template Excel (`lib/excel-export.ts`)
- Memisahkan kolom gabungan lama `Size / From / To / Of / At` menjadi kolom mandiri sesuai template bisnis pengguna:
  - Kolom 3: `Tag No Proposed`
  - Kolom 4: `Equipment Type`
  - Kolom 5: `For Description`
  - Kolom 6: **`Size`** (berisi ukuran nominal pipa/valve, misal `2"`, `4"`)
  - Kolom 7: `From`
  - Kolom 8: `To`
  - Kolom 9: `Of`
  - Kolom 10: `At`
  - Kolom 11: `Tag Number`
  - dst. hingga 29 kolom lengkap dengan format pewarnaan header (hijau + teks merah/hitam) sesuai contoh pengguna.

---

## 5. Rencana Pengujian (Test Suites)

1. `__tests__/piping-parser.test.ts`:
   - Pengujian pola horizontal: `2” - WS - B - 007` $\rightarrow$ `2"`.
   - Pengujian pola horizontal kompleks: `4” - NG - B3CS2F - 01 - 004` $\rightarrow$ `4"`.
   - Pengujian pola teks vertikal (rotasi 90°): `4” - NG - B8CS2F - A1 - 008` $\rightarrow$ `4"`.
   - Pengujian karakter kutip lengkung (`”`, `“`), en-dash (`–`), dan em-dash (`—`).
   - Pengujian format pecahan (`1/2"`, `1-1/2"`) dan metrik (`DN50`, `DN100`).
2. `__tests__/spatial-piping.test.ts`:
   - Asosiasi spasial valve horizontal dan vertikal ke garis pipa terdekat.
   - Pengujian aturan override (ukuran eksplisit valve mengalahkan ukuran pipa).
3. `__tests__/excel-export-valve-size.test.ts`:
   - Memastikan kolom `Size` (#6) terisi terpisah dan tidak tergabung lagi dengan From/To.
