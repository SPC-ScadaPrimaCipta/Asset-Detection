# Technical Design Document
# Legend-Driven Auto-Tag Generator with Smart Abbreviation & Project-Level Uniqueness

**Tanggal:** 2026-10-16  
**Status:** Approved  
**Modul:** 
- Legend Management (`app/legends/[id]/page.tsx`, `lib/tag-generator.ts`, `app/api/legends/[id]/symbols/batch/route.ts`)
- Detection Engine (`lib/detection/hybrid-pipeline.ts`, `workers/detection-worker.ts`)
- Detection UI Review (`app/detection/page.tsx`)

---

## 1. Latar Belakang & Tujuan

Pada pembacaan diagram P&ID industri:
1. Tidak semua simbol peralatan memiliki teks tag fisik pada gambar (misal valve manual kecil atau instrumen inline).
2. Ketika tag fisik tidak ada, sistem harus secara otomatis men-generate tag standar dengan format `<Prefix>-<Number>` (misal `GTV-001`, `P-001`).
3. Format huruf/prefix ini harus dapat dikonfigurasi oleh pengguna pada **Legend** dokumen tersebut.
4. Agar pengguna tidak perlu mengetik satu per satu untuk puluhan simbol, disediakan **Smart Abbreviation Helper** di UI Legend yang otomatis menyarankan singkatan baku industri (seperti *Gate Valve* $\rightarrow$ `GTV` atau `GV`, *Centrifugal Pump* $\rightarrow$ `P`, *Storage Tank* $\rightarrow$ `TK`) dalam 1 klik.
5. **Jaminan Keunikan Tingkat Proyek (Project-Level Uniqueness)**: Dalam satu proyek, tidak boleh ada 2 aset yang memiliki tag yang sama. Penomoran incremental otomatis melanjutkan nomor urut tertinggi yang belum terpakai di seluruh dokumen pada proyek tersebut.

---

## 2. Arsitektur & Komponen

### 2.1. Smart Abbreviation Helper (`lib/tag-generator.ts`)
- Berisi kamus standar ISA 5.1 / PIP P&ID:
  - `gate_valve`: `GTV` (fallback `GV`)
  - `ball_valve`: `BV`
  - `globe_valve`: `GLV`
  - `check_valve`: `CV`
  - `control_valve`: `FCV` / `CV`
  - `pump`: `P`
  - `vessel`: `V`
  - `tank`: `TK`
  - `compressor`: `C`
  - `heat_exchanger`: `E`
  - `instrument`: `INST` (atau `PT`, `TT`, `FT`, `LT`)
- Algoritma akronim heuristik untuk simbol kustom (mengambil huruf kapital awal dari tiap kata).
- Fungsi format pola: `formatTagPattern(prefix, digits)` (default: `3` digit $\rightarrow$ `PREFIX-###`).
- Fungsi parser nomor: `extractNextIncrementalNumber(prefix, existingProjectTags, digits)`:
  - Memindai semua tag di proyek dengan format `<PREFIX>-<DIGITS>`.
  - Mengambil nomor tertinggi `max` dan mengembalikan format padded `<PREFIX>-<padded(max + 1)>`.

### 2.2. Modal "Tag Pattern & Prefix Manager" di Halaman Legend (`app/legends/[id]/page.tsx`)
- Tombol: **🏷️ "Manage Tag Patterns"** di header halaman legend.
- Modal yang menampilkan seluruh simbol dalam legenda tersebut.
- Tombol aksi cepat: **⚡ "Auto-Suggest Standard Prefixes"** untuk mengisi semua yang kosong secara instan.
- Input editable per baris untuk kustomisasi huruf depan / digit.
- Tombol simpan massal yang memanggil endpoint API batch update `PUT /api/legends/[id]/symbols/batch`.

### 2.3. Endpoint API Batch Update (`app/api/legends/[id]/symbols/batch/route.ts`)
- Menerima array `{ id, tag_pattern }[]` dan memperbarui `legend_symbols` dalam satu transaksi PostgreSQL.

### 2.4. Project-Level Unique Auto-Tagging di Detection Pipeline (`lib/detection/tag-allocator.ts` & `workers/detection-worker.ts`)
- Sebelum menyimpan deteksi, untuk setiap aset yang `assetTag === null`:
  - Dapatkan `tag_pattern` dari simbol legenda (atau fallback kamus ISA).
  - Ekstrak prefix dan digit format.
  - Periksa `existingProjectTags` (query tag yang sudah ada di seluruh dokumen di proyek tersebut).
  - Alokasikan tag urut unik berikutnya.
  - Tambahkan tag ke set `existingProjectTags` memori agar simbol berikutnya dalam batch yang sama tidak bentrok.
  - Set `tag_source = 'AUTO_GENERATED'` dan tambahkan bukti ke array `evidence`.

### 2.5. Tampilan Visual di Review UI (`app/detection/page.tsx`)
- Menampilkan tag dengan badge abu-abu kecil `Auto` jika tag tersebut digenerate otomatis.
