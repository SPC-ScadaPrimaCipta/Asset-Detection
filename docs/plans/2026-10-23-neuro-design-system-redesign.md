# DESIGN SPECIFICATION: NEURO DESIGN SYSTEM TRANSFORMATION
## Automatic Asset Detection Platform

**Date:** 2026-10-23  
**Status:** Approved by User (Brainstorming Phase Complete)  
**Reference:** [Design.md](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/Design.md)  
**Strict Scope Guardrail:** Visual, layout, styling, and UI component upgrade ONLY. Zero modification to business logic, API endpoints, database schema, AI detection models, or worker pipelines.

---

## 1. Executive Summary & Principles

Aplikasi **Automatic Asset Detection** diubah tampilannya agar sepenuhnya mengadopsi **Neuro Design System** yang terdokumentasi di [Design.md](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/Design.md). 

Prinsip desain:
1. **Bersih & Lapang**: Spasi basis 4px (`4, 8, 12, 16, 20, 24, 32, 40`), radius besar (`--radius-card: 20px`, `--radius-frame: 28px`), bayangan lembut.
2. **Identitas Warna**: Royal Blue (`#3451D1` di Light Mode, `#5B7BFF` di Dark Mode) sebagai warna utama.
3. **Dukungan Penuh Dua Tema**: Light Mode dan Dark Mode dengan transisi halus (200ms ease), tanpa *flash of unstyled theme* (FOUST).
4. **Data Jelas & Terstruktur**: Angka Display 36px dengan `tabular-nums`, tren berwarna hijau/merah dengan sparkline visual.
5. **Aksesibilitas & Anti-Slop**: Kontras teks ≥ 4.5:1 (WCAG AA/AAA), keyboard focus ring yang tegas (`2px solid var(--primary)`), target sentuh ≥ 44×44px, tanpa elemen dekoratif berlebihan.

---

## 2. Token Arsitektur & CSS Variables

File: `app/globals.css`

```css
:root,
[data-theme="light"] {
  --primary: #3451D1;
  --primary-hover: #2B44B8;
  --primary-soft: #E8ECFC;
  --accent: #6CC8F2;
  --success: #2FB584;
  --success-soft: #E4F7EF;
  --danger: #E5677B;
  --danger-soft: #FCEBEE;
  --warning: #F5B942;
  --warning-soft: #FEF7E6;
  --info: #3B8FE8;

  --bg-page: linear-gradient(135deg, #DCE3F7 0%, #EEF1FB 100%);
  --bg-app: #F3F5FC;
  --surface: #FFFFFF;
  --surface-2: #F6F8FD;
  --border: #E6E9F4;
  --border-strong: #D5DBEC;
  --text-primary: #1E2347;
  --text-secondary: #6E7597;
  --text-muted: #9AA0BC;
  --text-on-primary: #FFFFFF;

  --sidebar-bg: #3451D1;
  --sidebar-item-text: #DCE3FF;
  --sidebar-item-active-bg: #FFFFFF;
  --sidebar-item-active-text: #1E2347;
  --sidebar-support-bg: #4A66DE;

  --banner-bg: linear-gradient(135deg, #6FCBF3 0%, #8FDAF7 100%);
  --shadow-card: 0 8px 24px rgba(52, 81, 209, 0.08);
  --shadow-frame: 0 24px 60px rgba(52, 81, 209, 0.15);

  --radius-frame: 28px;
  --radius-card: 20px;
  --radius-sidebar: 24px;
  --radius-button: 10px;
  --radius-input: 10px;
  --radius-icon-box: 6px;
  --radius-thumb: 12px;
  --radius-chip: 6px;
}

[data-theme="dark"] {
  --primary: #5B7BFF;
  --primary-hover: #7391FF;
  --primary-soft: #222A5C;
  --accent: #4FB4E6;
  --success: #45D6A0;
  --success-soft: #12332A;
  --danger: #FF7F93;
  --danger-soft: #3A1E26;
  --warning: #F5C25A;
  --warning-soft: #382A13;
  --info: #5AA5F5;

  --bg-page: linear-gradient(135deg, #0A0D1C 0%, #11152B 100%);
  --bg-app: #0F1325;
  --surface: #181D35;
  --surface-2: #1F2542;
  --border: #2A3158;
  --border-strong: #394273;
  --text-primary: #F1F3FC;
  --text-secondary: #A3AACB;
  --text-muted: #6F7699;
  --text-on-primary: #FFFFFF;

  --sidebar-bg: #1B2466;
  --sidebar-item-text: #B9C3F5;
  --sidebar-item-active-bg: #2B3786;
  --sidebar-item-active-text: #FFFFFF;
  --sidebar-support-bg: #26307F;

  --banner-bg: linear-gradient(135deg, #1E5E86 0%, #2A7FA8 100%);
  --shadow-card: 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-frame: 0 24px 60px rgba(0, 0, 0, 0.5);
}
```

Font: Google Font `Plus Jakarta Sans` dimuat secara global melalui Next.js font loader (`next/font/google`).

---

## 3. Shell Layout & Navigasi

File: `app/layout.tsx`, `app/sidebar-nav.tsx`, `components/Header.tsx`, `components/ThemeToggle.tsx`

```
┌────────────────────────────────────────────────────────────────────────┐
│ ┌──────────┐  Header (Welcome Back, Operator · Run Det · Search · Bell) │
│ │          │ ┌───────────────────────────────────────────────────────┐  │
│ │ Sidebar  │ │ Main Dashboard Content                                │  │
│ │  240px   │ │                                                       │  │
│ │  Royal   │ │                                                       │  │
│ │  Blue    │ │                                                       │  │
│ │          │ │                                                       │  │
│ └──────────┘ └───────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Outer Page**: Background `--bg-page` gradient, padding responsif.
2. **Dashboard Frame Container**: Lebar acuan 1440px, radius 28px, background `--bg-app`, bayangan `--shadow-frame`.
3. **Sidebar**:
   - Lebar 240px, tinggi penuh, radius 24px, background `--sidebar-bg`.
   - Brand: Icon 3D Cube + wordmark `"Neuro."` putih + label `"Asset Detection"`.
   - Items: Overview (`/`), Projects (`/projects`), Detection (`/detection`), Documents (`/documents`), Legends (`/legends`), Assets (`/assets`), MDO Flow (`/mdo`), Settings (`/settings`).
   - Active state: Background putih dengan teks gelap (Light) / Background `#2B3786` dengan teks putih (Dark).
   - Bottom Box: AI System Status Box (menampilkan provider aktif Gemini/DeepSeek & status queue worker).
4. **Header**:
   - Greeting operator: `"Welcome Back,"` + Nama Operator.
   - Action Button: `"Run Detection"` (Primary Royal Blue).
   - Search Bar: Rounded input dengan icon pencarian.
   - Notification Bell: Icon button dengan badge notifikasi bulat.
   - Theme Switcher: Tombol toggle Light/Dark/System.

---

## 4. Main Dashboard Grid Architecture

File: `app/page.tsx`

Sesuai grid 12 kolom Neuro:
* **Area Kiri (8 Kolom)**:
  1. **Detection Hub Banner (Tinggi ±200px, Radius 20px, Background `--banner-bg`)**:
     - Judul: `"Automate Your P&ID Asset Extraction"`
     - Deskripsi: Deteksi simbol fisik, identifikasi tag, dan asosiasi Legend otomatis.
     - CTA Button: Secondary white button `"Run New Detection"` mengarah ke `/detection`.
     - Visual Kanan: 3D Render Industrial Equipment / P&ID Hub graphic.
  2. **Stat Card 1 (4 dari 8 kolom) — "Detected Assets"**:
     - Nilai display tabular (misal: `1,134` komponen).
     - Caption tren hijau (`+10% this week`).
     - Smooth SVG sparkline kurva hijau naik.
  3. **Stat Card 2 (4 dari 8 kolom) — "Pending Review"**:
     - Nilai display tabular (misal: `24` aset).
     - Caption tren review queue.
     - Smooth SVG sparkline kurva tren antrean.
  4. **Detection Activity Chart (8 kolom penuh bawah)**:
     - Area chart kurva halus (*monotone*) dengan warna garis `--primary` (2.5px) dan area fill gradien 18% → 0%.
     - Sumbu X: Waktu/Hari; Sumbu Y: Volume deteksi.
     - Active point & interactive tooltip berwarna `--info`.
* **Area Kanan (4 Kolom)**:
  1. **Recent Documents & Projects List**:
     - 5 item dokumen P&ID terbaru.
     - Thumbnail 44×44 dengan latar warna pastel bervariasi (`#E3ECFF`, `#FFE9D6`, `#E3F7EE`, `#FFE4E4`, `#DDF4FA`).
     - Nama P&ID, jumlah tag aset, dan chevron `›`.
  2. **Verification Status & Balances Card**:
     - Dua kolom metrik: **Confirmed** (chip hijau Available) vs **Pending Review** (chip oranye/merah Pending).
     - Full-width primary button: `"Review All Assets"` mengarah ke `/assets` atau `/mdo`.
     - AI Provider Quota info di footer kartu.

---

## 5. UI Component Library Standardization

File: `components/ui/*`
* `card.tsx`: Radius 20px, `--shadow-card`, padding 24px, Neuro header (ikon box 16×16 Royal Blue + H3 + `⋮`).
* `button.tsx`: Varian Primary (Royal Blue 44px, radius 10px), Secondary (Putih/Surface-2), Accent (`#6CC8F2`), Full-width. Focus ring tegas `2px solid var(--primary)`.
* `badge.tsx`: Radius 6px, padding `4px 12px`, warna semantik soft (Success-soft, Danger-soft, Primary-soft).
* `input.tsx`: Radius 10px, tinggi 44px, background `--surface-2`, border `--border`.
* `table.tsx`: Clean data table dengan hover row `--surface-2`, sticky header, dan angka tabular.
* `modal.tsx`: Backdrop blur, container kartu radius 20px.

---

## 6. Functional Integrity & Verification Strategy

1. **Strict Non-Destructive Policy**:
   - Tidak ada perubahan pada skema database atau query SQL.
   - Tidak ada modifikasi pada API routes (`/api/**`).
   - Tidak ada perubahan pada logic worker BullMQ atau AI prompt agent.
2. **Step-by-step Quality Gates**:
   - Typechecking: `npx tsc --noEmit` wajib lolos tanpa error.
   - Next.js build verification: `npm run build` berhasil.
   - Functional test per halaman: Dashboard stats, upload PDF, P&ID viewer zoom/pan/click bounding box, legend CRUD, asset filter & Excel export.
