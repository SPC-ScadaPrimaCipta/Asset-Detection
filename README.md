# TagFlow — Automatic Asset Detection (v3.5)

Platform kecerdasan buatan (AI) industri untuk deteksi simbol, peralatan (_equipment_), dan tag instrumen secara otomatis dari dokumen P&ID / PFD teknis, menghasilkan **Asset Register** dan **Material Data Origin (MDO)** standar enterprise.

> **Identitas Brand:** TagFlow menggunakan tema _In-Context Lockup Royal Blue_ (`#3053D2`), ikon visual _Target Valve & Actuator Tag (ISA-5.1)_, tipografi modern Plus Jakarta Sans, serta antarmuka terintegrasi yang responsif dalam mode terang (_Light Mode_) dan gelap (_Dark Mode_).

---

## 🚀 Ringkasan Perubahan: Dari v2.0 ke v3.5

Versi 3.5 menandai lompatan besar dari arsitektur eksperimental v2.0 menjadi platform siap produksi (_enterprise-ready_). Berikut perbandingan evolusinya:

| Dimensi                    | Versi 2.0 (Baseline Awal)                                   | Versi 3.5 (Rilis Saat Ini)                                                                                                |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Branding & Identitas**   | Placeholder generik ("Neuro.") tanpa identitas visual resmi | **TagFlow.** resmi dengan logo SVG Stand-alone Icon & In-Context Lockup (Royal Blue `#3053D2`)                            |
| **Keamanan & Autentikasi** | Tanpa autentikasi (semua route publik dan terbuka)          | **JWT HttpOnly Cookies + Middleware** proteksi rute, RBAC (`SUPERADMIN` vs `USER`)                                        |
| **Manajemen Pengguna**     | Tidak ada entitas pengguna                                  | **Superadmin User Management (`/users`)** dengan CRUD user, reset password, dan status aktif                              |
| **Kolaborasi Project**     | Project global tanpa kepemilikan                            | **Private vs Public Projects**, kode berbagi unik 8-karakter (_Share Code_), dan fitur **Clone Project**                  |
| **Manajemen Antrean**      | Background worker pasif tanpa visibilitas UI                | **Multi-User Detection Queue** di Dashboard & Detection page, progress live, dan fitur batalkan antrean sendiri           |
| **Legend Onboarding**      | Form manual rumit & lambat                                  | **Direct Upload Legend Modal** 1-halaman instan, re-parse atomik dengan konfirmasi aman, dan shortcut keyboard (`Delete`) |
| **Koreksi Deteksi**        | Hanya review konfirmasi/tolak standar                       | **Manual Asset Drawing** di canvas viewer + **Deduplication Engine (NMS)** untuk bersihkan deteksi tumpang tindih         |
| **Ekspor Enterprise**      | Hanya Asset Register Excel 5 sheet                          | **Integrasi Standar MDO PT Accenture 9-Kolom (`/mdo`)** + Asset Register Excel lengkap                                    |
| **AI Multi-Provider**      | Terbatas pada skrip Gemini mentah                           | Tabbed Provider Config (Google Gemini, DeepSeek, Anthropic, OpenAI), scan model dinamis, circuit breaker, & live tuning   |
| **Dokumentasi Pengguna**   | Dokumen teks teknis terpisah                                | **In-App User Guide (`/guide`)** interaktif dengan sticky Table of Contents                                               |

---

## Alur Kerja Aplikasi (Workflow v3.5)

```text
1. Login Sesi (Superadmin / Engineer)
       ↓
2. Buat / Gandakan Project (Private / Public / Share Code)
       ↓
3. Upload Legend 1-Halaman via Modal Instan
       ↓
4. QA Visual Legend (Re-crop / Shortcut Delete / Validate All)
       ↓
5. Upload Dokumen P&ID / PFD
       ↓
6. Jalankan Deteksi → Masuk ke Antrean Multi-User (Detection Queue)
       ↓
7. Worker AI Menganalisis Halaman (Gemini / DeepSeek / Claude / GPT)
       ↓
8. Workspace Deteksi:
   - Verifikasi Bounding Box & Label
   - Gambar Simbol Manual jika Terlewat
   - Bersihkan Deteksi Ganda via Deduplicate (NMS)
       ↓
9. Konfirmasi Deteksi (Approved / Confirmed)
       ↓
10. Hasil Final:
   ├── Export Asset Register (.xlsx 5-Sheet)
   └── MDO Dashboard PT Accenture 9-Kolom & Export Excel
```

---

## Tech Stack

| Komponen                   | Spesifikasi & Teknologi                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Frontend**               | Next.js 16.3.5 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind CSS 4         |
| **Desain & Ikon**          | Plus Jakarta Sans, Phosphor Icons (`@phosphor-icons/react`), Royal Blue Theme (`#3053D2`)  |
| **Backend**                | Next.js Route Handlers (Node.js runtime)                                                   |
| **Database**               | PostgreSQL 15+ (pg 8) dengan 20+ tabel relasional dan migrasi idempoten                    |
| **Antrian Pemrosesan**     | BullMQ 6 + Redis (ioredis), `WORKER_CONCURRENCY=1` (aman kuota free-tier/enterprise)       |
| **Mesin AI Vision**        | Google Gemini Vision (`@google/generative-ai`), DeepSeek, Anthropic Claude, OpenAI SDK     |
| **Pemrosesan PDF & Citra** | MuPDF C++ binding (server rendering), PDF.js (client viewer), Sharp (cropping & filtering) |
| **Ekspor & Spreadsheet**   | ExcelJS 4 (multi-sheet styling, freeze panes, format tabel teknik)                         |

---

## Struktur Halaman (App Router v3.5)

| Rute URL               | Nama Modul          | Fungsi Utama                                                                              |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `/login`               | Autentikasi         | Halaman masuk sesi aman TagFlow dengan proteksi redirect otomatis                         |
| `/`                    | Dashboard           | Statistik global, banner pekerjaan aktif, antrean pengguna lain, grafik confidence        |
| `/projects`            | Project Hub         | Manajemen project dengan tab _My Projects_ dan _Public_, Join via Share Code, Clone       |
| `/documents`           | Documents           | Upload PDF/DXF dokumen P&ID, thumbnail preview, hapus dokumen per project                 |
| `/legends`             | Legend Library      | Katalog legend industri dengan modal upload instan 1-halaman                              |
| `/legends/[id]/review` | Legend Review       | Workspace visual QA simbol, pemotongan ulang (re-crop), shortcut delete, batch validate   |
| `/detection`           | Detection Workspace | P&ID canvas viewer interaktif, tag-matching, manual asset drawing, deduplikasi            |
| `/mdo`                 | MDO Standard        | Material Data Origin tabel 9-kolom standar PT Accenture untuk aset yang telah di-approve  |
| `/users`               | User Management     | Dashboard khusus Superadmin untuk menambah, mengedit, reset sandi, dan menonaktifkan user |
| `/guide`               | Panduan Pengguna    | Dokumentasi interaktif in-app dengan sticky navigation & panduan langkah-demi-langkah     |
| `/settings`            | Konfigurasi AI      | Pengaturan multi-provider AI, live scan model API, dan tuning parameter tanpa restart     |

---

## Daftar Endpoint REST API

```text
# Autentikasi & Sesi
POST   /api/auth/login                   Login email/password, issue JWT cookie
POST   /api/auth/logout                  Hapus cookie sesi
GET    /api/auth/me                      Ambil data profil pengguna yang sedang login

# Manajemen Pengguna (Superadmin Only)
GET    /api/admin/users                  Daftar seluruh pengguna sistem
POST   /api/admin/users                  Buat pengguna baru
PUT    /api/admin/users/[id]             Perbarui nama, email, role, atau reset password
DELETE /api/admin/users/[id]             Nonaktifkan pengguna

# Projects & Kolaborasi
GET    /api/projects                     List project (filter: private/public/owner)
POST   /api/projects                     Buat project baru
GET    /api/projects/[id]                Detail project
DELETE /api/projects/[id]                Hapus project dan seluruh aset di dalamnya
POST   /api/projects/[id]/clone          Gandakan project beserta seluruh dokumennya
GET    /api/projects/[id]/share-code     Ambil atau buat 8-karakter Share Code
POST   /api/projects/join-code           Bergabung ke private project via Share Code

# Dokumen P&ID
GET    /api/documents                    List dokumen per project
POST   /api/documents                    Upload file PDF P&ID
GET    /api/documents/[id]               Metadata detail dokumen
DELETE /api/documents/[id]               Hapus file dan data halaman
GET    /api/documents/[id]/pages/[page]/image  Render bitmap halaman resolusi tinggi

# Legend & Simbol
GET    /api/legends                      Katalog legend
POST   /api/legends/upload               Upload PDF 1-halaman → Ekstraksi AI otomatis
GET    /api/legends/[id]                 Detail status legend
DELETE /api/legends/[id]                 Hapus legend
POST   /api/legends/[id]/reparse         Re-ekstraksi penuh dengan transaksi atomik aman
GET    /api/legends/[id]/symbols         Daftar simbol tersimpan
POST   /api/legends/[id]/symbols/bulk-validate   Tandai seluruh simbol valid siap-deteksi
POST   /api/legends/[id]/symbols/[id]/recrop     Potong ulang koordinat simbol

# Antrean & Eksekusi Deteksi
GET    /api/detection/queue              Status real-time job berjalan dan daftar antrean user
POST   /api/detection/jobs               Submit job deteksi baru ke antrean BullMQ
GET    /api/detection/jobs/[id]          Progress persentase dan log tahapan job
POST   /api/detection/jobs/[id]/cancel   Batalkan job yang sedang mengantri/berjalan

# Review & Koreksi Deteksi
GET    /api/detections                   Ambil hasil deteksi (filter: dokumen, status, confidence)
POST   /api/detections/[id]/confirm      Setujui aset (VALIDATED / APPROVED)
POST   /api/detections/[id]/reject       Tolak deteksi (REJECTED)
POST   /api/detections/manual            Tambah aset manual langsung dari canvas
POST   /api/detections/deduplicate       Analisis & eliminasi deteksi tumpang tindih (NMS)

# MDO & Pelaporan
GET    /api/documents/[id]/mdo           Data MDO 9-kolom Accenture aset terkonfirmasi
GET    /api/documents/[id]/mdo/export    Download MDO Excel spreadsheet
GET    /api/export/assets                Download Asset_Register.xlsx resmi (5 sheet)

# Pengaturan & Mesin AI
GET    /api/settings                     Ambil konfigurasi aktif provider & tuning
PUT    /api/settings                     Simpan perubahan konfigurasi
POST   /api/settings/scan-models         Uji API key dan deteksi model yang kompatibel
GET    /api/quota                        Monitor kuota request AI per menit
GET    /api/health                       Status kesehatan database, redis, dan worker
```

---

## Skema Database Utama

```text
users (id, email, password_hash, name, role [SUPERADMIN|USER], is_active)
  │
  ├── projects (id, name, owner_id, visibility [PRIVATE|PUBLIC], share_code)
  │     │
  │     ├── documents (id, project_id, filename, file_path, page_count)
  │     │     ├── document_pages (id, document_id, page_number, width, height)
  │     │     └── detection_jobs (id, document_id, user_id, status, progress)
  │     │           ├── detections (id, job_id, asset_tag, asset_type, bbox, confidence)
  │     │           └── assets (id, detection_id, tag, type, service, is_confirmed)
  │     │
  │     └── scoped_legends (project-scoped access)
  │
  └── legends (id, name, plant_name, page_count, status)
        └── legend_symbols (id, legend_id, symbol_name, asset_type, bbox, crop_path, quality_status)

settings (id=1 singleton: provider, api_keys, active_models, tuning_json)
detection_queue_audit (tracking antrean multi-user)
```

Migrasi dijalankan secara otomatis dan idempoten melalui:

```bash
npm run migrate
```

---

## Panduan Instalasi & Menjalankan

### Prasyarat

- **Node.js** v20.x atau lebih baru
- **PostgreSQL** v14+ aktif
- **Redis** server aktif (port default `6379`)

### 1. Kloning & Persiapan Dependensi

```bash
git clone https://github.com/RadenRizky26/Asset-Detection.git
cd Asset-Detection
npm install
```

### 2. Konfigurasi Lingkungan (.env.local)

Salin berkas contoh konfigurasi:

```bash
cp .env.example .env.local
```

Pastikan variabel kunci terkonfigurasi dengan benar:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/asset_detection"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="kunci-rahasia-sesi-jwt-anda-minimal-32-karakter"
GEMINI_API_KEY="AIzaSy..."
```

### 3. Migrasi Database & Seeding Superadmin Awal

```bash
npm run migrate
```

_Script migrasi secara otomatis membuat akun Superadmin bawaan jika tabel pengguna masih kosong:_

- **Email:** `admin@tagflow.ai`
- **Password:** `SuperAdmin123!`

### 4. Menjalankan Aplikasi

Buka 2 terminal terpisah:

**Terminal 1 — Web Server (Next.js):**

```bash
npm run dev
# Atau untuk mode produksi:
npm run build
npm run start
```

Akses platform melalui peramban di `http://localhost:3000`.

**Terminal 2 — Detection Background Worker:**

```bash
npm run worker
```

---

## Arsitektur Ketahanan AI & Rate-Limiting

1. **Process-Wide Request Gate (`lib/gemini-request-gate.ts`):** Mengatur alokasi panggilan API secara adil antara ekstraksi legend dan pekerjaan deteksi dokumen (default batas aman: `15 RPM`).
2. **Circuit Breaker Per-Model (`lib/ai-circuit-breaker.ts`):** Mengisolasi model yang mengalami error berulang (429 kuota habis atau 503 overload) selama waktu _cooldown_ tertentu tanpa menghentikan worker.
3. **Dynamic Model Resolver (`lib/model-resolver.ts`):** Menemukan model aktif yang tersedia pada runtime dan memicu fallback otomatis ke kandidat model cadangan.
4. **Live Zero-Restart Tuning (`lib/tuning.ts`):** Semua ambang batas (_threshold_ confidence, NMS IoU, delay antar region) dapat diubah langsung melalui antarmuka **Settings** tanpa perlu me-restart server.

---

## Lisensi & Kontribusi

TagFlow dikembangkan sebagai solusi industri independen untuk otomasi teknik perminyakan, gas, dan petrokimia.
Hak Cipta © 2026 Tim Pengembang TagFlow.
"# Asset-Detection" 
