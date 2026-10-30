# Design System — TagFlow Platform (v3.5)

Dokumen ini mendeskripsikan sistem desain dan identitas visual resmi untuk platform **TagFlow — Automatic Asset Detection** (v3.5). Mendukung **Light Mode** dan **Dark Mode** dengan identitas utama **Royal Blue (#3053D2)**.

---

## 1. Identitas Brand & Lockup Resmi

Identitas TagFlow dirancang untuk merepresentasikan presisi teknik industri (P&ID) dan kecerdasan buatan (*AI Multimodal*).

### 1.1 Stand-alone Icon
- **File Aset:** [`public/logo.svg`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/public/logo.svg) (dan favicon di `app/layout.tsx`).
- **Anatomi Visual:**
  - **Tile Squircle:** Sudut membulat besar (`rx="54"`), gradien *Ice Blue* halus (`#B2ECFD` ke `#F0FAFF`).
  - **AI Bounding Box Corner Brackets:** 4 sudut siku biru tua (`#2F50C6`) melambangkan deteksi objek bervisi komputer.
  - **Process Pipeline & Valve Body:** Pipa horizontal 10px dan sepasang segitiga *Bowtie Valve*.
  - **ISA-5.1 Actuator Balloon:** Lingkaran tag instrumen dengan pembagi garis cyan (`#00A3FF`) dan titik tengah.

### 1.2 In-Context Lockup (Royal Blue #3053D2)
Digunakan sebagai header identitas utama pada Sidebar ([`app/sidebar-nav.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/sidebar-nav.tsx)) dan banner resmi:
- **Background:** Warna solid **Royal Blue (`#3053D2`)**.
- **Kiri:** Stand-alone Icon (ukuran 42×42 px, border-radius 10 px, shadow halus).
- **Kanan (Teks):**
  - **Nama Brand:** `TagFlow.` (Plus Jakarta Sans Bold 21–22 px, warna putih `#FFFFFF`, berakhiran titik).
  - **Deskriptor Resmi (2 Baris):**
    ```text
    AI Asset Detection
    Intelligence
    ```
    (Ukuran 10.5 px, Medium 500, warna `#DCE3FF`, opacity 0.85, line-height 1.25).

---

## 2. Prinsip Desain

- **Industrial & Technical Precision**: Mengutamakan kejelasan data teknik (tag instrumen, tipe peralatan, nomor pipa, koordinat bounding box).
- **Bersih & Lapang**: Banyak whitespace, kartu putih dengan sudut membulat 20px, kontras tinggi yang nyaman di mata.
- **Satu Warna Dominan**: Royal Blue (`#3053D2`) sebagai identitas sidebar dan tombol aksi utama.
- **Konsistensi Hierarki**: Card header seragam, breadcrumb terpetakan otomatis, dan status badge dengan semantic color.

---

## 3. Color Tokens

### 3.1 Brand & Semantic

| Token | Light Mode | Dark Mode | Penggunaan |
|---|---|---|---|
| `--primary` | `#3053D2` / `#3451D1` | `#5B7BFF` | Sidebar, tombol utama, CTA, garis grafik |
| `--primary-hover` | `#2543B5` | `#7391FF` | State hover tombol utama |
| `--primary-soft` | `#E8ECFC` | `#222A5C` | Background item aktif, pill selection |
| `--accent` | `#6CC8F2` | `#4FB4E6` | Tombol sekunder, progress indicator |
| `--success` | `#2FB584` | `#45D6A0` | Status VALID / CONFIRMED / APPROVED |
| `--success-soft` | `#E4F7EF` | `#12332A` | Background chip sukses |
| `--danger` | `#E5677B` | `#FF7F93` | Status REJECTED, aksi hapus |
| `--danger-soft` | `#FCEBEE` | `#3A1E26` | Background chip error / rejected |
| `--warning` | `#F5B942` | `#FBD368` | Status NEEDS_REVIEW / PENDING |
| `--warning-soft` | `#FEF7E6` | `#382A12` | Background chip warning |
| `--info` | `#3B8FE8` | `#5AA5F5` | Info banner, kuota status |

### 3.2 Neutral & Surface

| Token | Light Mode | Dark Mode | Penggunaan |
|---|---|---|---|
| `--bg-app` | `#F3F5FC` | `#0F1325` | Background container utama aplikasi |
| `--surface` | `#FFFFFF` | `#181D35` | Background kartu, modal dialog |
| `--surface-2` | `#F6F8FD` | `#1F2542` | Input search, table zebra hover |
| `--border` | `#E6E9F4` | `#2A3158` | Garis batas kartu, pemisah tabel |
| `--foreground` | `#1E2347` | `#F1F3FC` | Teks utama, judul halaman |
| `--foreground-muted` | `#6E7597` | `#A3AACB` | Subjudul, deskripsi panduan |
| `--foreground-subtle`| `#9AA0BC` | `#6F7699` | Placeholder input, timestamp |

### 3.3 Sidebar Tokens

| Token | Light Mode | Dark Mode |
|---|---|---|
| `--sidebar-bg` | `#3053D2` | `#1B2466` |
| `--sidebar-item-text` | `#DCE3FF` | `#B9C3F5` |
| `--sidebar-item-active-bg` | `#FFFFFF` | `#2B3786` |
| `--sidebar-item-active-text` | `#1E2347` | `#FFFFFF` |
| `--sidebar-support-bg` | `#4263DF` | `#26307F` |

---

## 4. Tipografi

**Font Utama:** `Plus Jakarta Sans`  
**Alternatif / Fallback:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

| Skala | Ukuran / Line Height | Bobot | Penggunaan |
|---|---|---|---|
| **Display / Metric** | 32–36 px / 40 px | 700 Bold | Angka statistik KPI pada Dashboard |
| **Page Title** | 22–24 px / 30 px | 700 Bold | Judul halaman dan modal dialog |
| **Section Header** | 16–18 px / 24 px | 600 SemiBold | Header kartu, tab navigasi |
| **Body Regular** | 13–14 px / 20 px | 400 Regular | Teks tabel aset, deskripsi instrumen |
| **Body Medium** | 13–14 px / 20 px | 500 Medium | Form input, menu sidebar item |
| **Caption / Badge** | 11–12 px / 16 px | 600 SemiBold | Status badge (CONFIRMED, VALIDATED) |
| **Micro** | 10 px / 14 px | 500 Medium | Label sub-header, posisi antrean (#1) |

---

## 5. Spacing, Radius & Elevation

| Token Radius | Nilai | Komponen Sasaran |
|---|---|---|
| `--radius-sidebar` | 24 px | Floating container sidebar |
| `--radius-card` | 20 px | Kartu dashboard, container viewer |
| `--radius-modal` | 16 px | Dialog upload legend, dedup modal |
| `--radius-button` | 10 px | Tombol aksi primer, sekunder, dan icon button |
| `--radius-badge` | 6–8 px | Chip status dan tag indikator |

**Elevation & Shadow:**
- Kartu: `box-shadow: 0 8px 24px rgba(48, 83, 210, 0.08)` (Light) / `0 8px 24px rgba(0, 0, 0, 0.35)` (Dark).
- Frame Kontainer: `box-shadow: 0 24px 60px rgba(48, 83, 210, 0.12)`.
- Sidebar Logo: `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12)`.

---

## 6. Pola Komponen Utama v3.5

1. **Floating Sidebar Navigation ([`app/sidebar-nav.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/sidebar-nav.tsx))**
   - Menempel pada sisi kiri (`sticky`, `top: 16px`, `height: calc(100vh - 32px)`).
   - Brand lockup di atas, navigasi utama di tengah, dan status sesi pengguna + tombol keluar di bawah.
2. **Top Header & Breadcrumbs Bar ([`components/Header.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/components/Header.tsx))**
   - Auto-mapped Breadcrumbs dengan navigasi dinamis per level rute.
   - Dynamic user greeting di Dashboard (`Selamat datang kembali, [Nama]`).
   - Quick action: Switch Dark/Light Mode dan profil pengguna.
3. **Queue Status Widget ([`components/dashboard/DetectionQueueStatus.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/components/dashboard/DetectionQueueStatus.tsx))**
   - Kartu aktif dengan progress bar animasi hijau/biru.
   - List antrean dengan nomor urut (`#1`, `#2`), nama dokumen, dan pembuat antrean.
4. **Interactive P&ID Viewer ([`app/detection/page.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/detection/page.tsx))**
   - Canvas beresolusi tinggi dengan kemampuan zoom, pan, hover highlight bounding box, dan drawing tool penambahan aset manual.
5. **Interactive Dedup Modal ([`components/detection/DedupModal.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/components/detection/DedupModal.tsx))**
   - Visualisasi kartu perbandingan kandidat duplikat dengan NMS confidence score.
6. **MDO 9-Column Table View ([`app/mdo/page.tsx`](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/mdo/page.tsx))**
   - Format tabel standar industri PT Accenture dengan filter sheet, ekspor Excel langsung, dan status sinkronisasi otomatis.

---
TagFlow Design System v3.5 — Standar Identitas Visual Teknik.
