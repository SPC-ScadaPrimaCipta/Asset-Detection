# Dokumen Perubahan Arsitektur & Fitur: Versi 2.0 ke Versi 3.5

**Platform:** TagFlow — Automatic Asset Detection  
**Target Rilis:** v3.5 (Enterprise Edition)  
**Dokumen Referensi:** `README.md`, `docs/PRD.md`, `docs/DETECTION_V2_ARCHITECTURE.md`

---

## 1. Ringkasan Eksekutif

Versi 2.0 dibangun sebagai prototipe *Gemini-First Vision* untuk membuktikan kelayakan ekstraksi simbol dan tag dari dokumen P&ID tanpa OCR tradisional. Walaupun engine vision berhasil mendeteksi aset dasar, versi 2.0 masih memiliki keterbatasan operasional:
- Tidak memiliki autentikasi atau proteksi data antar-pengguna.
- Mengalami *concurrency clash* ketika beberapa pengguna menjalankan deteksi bersamaan.
- Proses onboarding legend lambat dan bergantung pada form manual.
- Belum ada mekanisme untuk mengatasi deteksi tumpang tindih (*region boundary duplication*).
- Belum mendukung standar data industri seperti Material Data Origin (MDO).

**Versi 3.5 (TagFlow)** menyelesaikan seluruh keterbatasan tersebut dan mematangkan sistem menjadi platform kolaboratif enterprise dengan manajemen antrean multi-user, isolasi project, audit trail, standar MDO PT Accenture, serta kontrol kualitas interaktif di canvas P&ID.

---

## 2. Tabel Komparasi Fitur Utama

| Area Fungsional | Versi 2.0 (Desain Awal) | Versi 3.5 (TagFlow Saat Ini) |
|---|---|---|
| **Identitas Produk** | Prototipe "Neuro." generik | **TagFlow.** resmi dengan logo Target Valve (ISA-5.1) dan palet Royal Blue (`#3053D2`) |
| **Keamanan & Autentikasi** | Publik tanpa login; semua endpoint terbuka | **JWT HttpOnly Cookies + Middleware Guard** dengan peran `SUPERADMIN` dan `USER` |
| **Manajemen Pengguna** | Tidak tersedia | Halaman **User Management (`/users`)** eksklusif Superadmin (tambah, edit, reset sandi, status aktif) |
| **Isolasi Project** | Project global bercampur untuk semua orang | **Private vs Public Projects**, kode bergabung 8-karakter (**Share Code**), dan **Clone Project** |
| **Antrean Background** | Worker BullMQ pasif tanpa feedback status ke pengguna lain | **Multi-User Detection Queue** live di Dashboard & Detection page, posisi antrean (`#1`, `#2`), dan self-cancel |
| **Onboarding Legend** | Halaman form manual bertahap (`/legends/new`) | **Upload Legend Modal** langsung dari katalog, validasi ketat 1-halaman PDF, dan re-parse transaksi atomik |
| **QA Simbol Legend** | Klik satu per satu untuk approve/validate | Shortcut keyboard (`Delete`/`Backspace`), grid AI 2x2 yang dipercepat, dan batch validation otomatis |
| **Deteksi Ganda (Duplikasi)** | Deteksi terpotong garis region sering terduplikasi | **Deduplication Engine (NMS)** dengan modal preview interaktif dan tombol one-click deduplikasi di toolbar |
| **Aset Manual** | Tidak ada cara menambah aset yang terlewat AI | **Interactive Manual Asset Drawing Tool** langsung di canvas viewer (`POST /api/detections/manual`) |
| **Standar Ekspor** | Asset Register spreadsheet 5 sheet standar | **MDO PT Accenture 9-Kolom (`/mdo`)** terintegrasi + Asset Register Excel lengkap |
| **Penyedia AI** | Terbatas pada pemanggilan Google Gemini | **Multi-Provider AI** (Gemini, DeepSeek, Anthropic, OpenAI) dengan live model scanning di Settings |
| **Dokumentasi Pengguna** | File markdown statis di repositori | **In-App User Guide (`/guide`)** interaktif dengan sticky Table of Contents |

---

## 3. Rincian Pilar Pembaruan v3.5

### 3.1. Rebranding ke TagFlow & Sistem Desain Terpadu
- **Logo & Lockup:** Logo resmi SVG (`public/logo.svg`) menggabungkan siluet *Control Valve*, garis pipa proses, dan *ISA-5.1 Instrument Actuator Tag Balloon* di dalam squircle gradien *ice blue* dengan 4 *corner brackets* AI bounding box.
- **In-Context Lockup:** Digunakan di header sidebar dengan latar belakang **Royal Blue (`#3053D2`)**, teks brand `TagFlow.` dan deskriptor resmi 2 baris `AI Asset Detection Intelligence`.
- **Favicon & Metadata:** Diperbarui global di `app/layout.tsx`.
- **Navigasi Dinamis:** Greeting personal di header (`Selamat datang kembali, [Nama]`) dan *Auto-mapped Breadcrumbs* di seluruh sub-halaman.

### 3.2. Autentikasi, Keamanan & User Management
- **Token Keamanan:** Menggunakan JWT yang disimpan dalam cookie `httpOnly` dengan masa berlaku 7 hari.
- **Middleware Proteksi (`middleware.ts`):** Mengarahkan semua akses unauthenticated langsung ke `/login`.
- **Role-Based Access Control (RBAC):**
  - `SUPERADMIN`: Akses penuh ke konfigurasi AI, monitoring antrean global, dan menu **User Management** (`/users`).
  - `USER`: Akses ke project yang dimiliki, project publik, atau project yang diikuti via Share Code.
- **Manajemen Akun:** Pendaftaran publik dinonaktifkan demi integritas organisasi; Superadmin dapat membuat akun baru, mengganti kata sandi, dan menonaktifkan pengguna yang keluar.

### 3.3. Kolaborasi Project, Share Code & Cloning
- **Visibilitas Project:** Setiap project kini memiliki status `PRIVATE` (hanya owner & member) atau `PUBLIC` (read-only untuk engineer lain).
- **Share Code:** Pemilik project private dapat men-generate kode unik 8 karakter (misal: `TF-8A9B2C`) untuk mengundang anggota tim tanpa perlu bantuan admin.
- **Project Cloning:** Fitur 1-klik untuk menduplikasi struktur project, seluruh dokumen P&ID yang sudah diunggah, dan pengaturan legend terkait.

### 3.4. Sistem Antrean Deteksi Multi-Pengguna (Detection Queue)
- Karena analisis visual dokumen P&ID beresolusi tinggi membutuhkan daya komputasi AI intensif, worker dibatasi pada konkurensi terkontrol (`WORKER_CONCURRENCY=1`).
- **Live Active Job Banner:** Menampilkan pekerjaan yang sedang aktif diproses (nama dokumen, persentase progress, nomor halaman, dan nama engineer yang menjalankan).
- **Waiting Queue Card:** Menampilkan daftar dokumen yang sedang antri beserta urutan posisi (`#1`, `#2`) dan nama pengantri (tanpa mengekspos email demi privasi).
- **Self-Cancellation:** Pengguna dapat membatalkan pekerjaan mereka sendiri dari antrean sebelum giliran pemrosesan dimulai.

### 3.5. Pembaruan Workspace Deteksi & Deduplikasi Aset
- **Toolbar Deduplicate:** Menambahkan tombol *Deduplicate* di header workspace deteksi.
- **Interactive Dedup Preview Modal:** Menganalisis aset tumpang tindih menggunakan algoritma Non-Maximum Suppression (NMS) berbasis IoU dan kesamaan tipe simbol. Menampilkan kartu perbandingan aset mana yang dipertahankan dan aset mana yang aman dibersihkan.
- **Manual Asset Drawing:** Pengguna dapat mengklik tombol "Tambah Aset Manual", menggambar bounding box langsung di atas dokumen P&ID, memilih jenis peralatan, memasukkan tag, dan menyimpannya langsung ke database (`status = MANUAL`).

### 3.6. Rekayasa Ulang Modul Legend
- **Upload Modal Instan (`UploadLegendModal.tsx`):** Menghapus form manual yang membingungkan. Pengguna cukup mengklik *New Legend* di `/legends` dan modal upload 1-halaman langsung muncul.
- **Validasi 1-Halaman Ketat:** Menghentikan upload dokumen multi-halaman yang sering membuat ekstraksi AI timeout.
- **Reparse Atomik:** Proses re-ekstraksi dijalankan di dalam PostgreSQL transaction block; jika gagal, data simbol sebelumnya tidak hilang.
- **Shortcut Keyboard QA:** Selama me-review simbol, pengguna cukup menekan tombol `Delete` atau `Backspace` untuk menghapus bounding box yang salah potong.

### 3.7. Standar MDO (Material Data Origin) PT Accenture
- Halaman baru `/mdo` menyajikan data peralatan dalam skema 9-kolom standar industri:
  1. No
  2. Tag Number
  3. Equipment Description
  4. Equipment Class / Type
  5. P&ID Number
  6. Drawing Sheet / Page
  7. Service Description
  8. Line Number / Piping Spec
  9. Approval Status
- **Quality Gate:** Hanya aset yang berstatus `CONFIRMED` atau `APPROVED` yang diizinkan masuk ke tabel MDO dan diekspor ke format Excel MDO.

### 3.8. Dukungan Multi-Provider AI & Live Tuning
- Antarmuka `/settings` didesain ulang dengan tab penyedia: **Google Gemini**, **DeepSeek**, **Anthropic**, dan **OpenAI**.
- Fitur **Scan Models** secara dinamis menanyakan API provider untuk menemukan model mana saja yang aktif dan mendukung JSON structured outputs.
- Semua nilai operasional (rate limits, circuit breaker, confidence threshold) terpusat di `lib/tuning.ts` dan dapat diubah tanpa restart server.

---

## 4. Riwayat Migrasi Skema Database (v2.0 → v3.5)

| Migrasi File | Deskripsi Perubahan Skema |
|---|---|
| `sql/migrate-auth.ts` | Membuat tabel `users`, kolom `owner_id`, `visibility`, dan `share_code` pada tabel `projects` |
| `sql/migrate-superadmin.sql` | Menambahkan role `SUPERADMIN` dan seeding akun superadmin awal |
| `sql/migrate-detection-jobs-user.sql` | Menambahkan foreign key `user_id` pada tabel `detection_jobs` untuk pelacakan antrean |
| `sql/migrate-007-legend-quality-classes.sql` | Menambahkan status `quality_status`, `quality_reasons`, dan `pipeline_version` pada `legend_symbols` |
| `sql/migrate-008-legend-review.sql` | Menambahkan kolom riwayat keputusan review manusia pada simbol |
| `sql/migrate-012-multi-provider-ai.sql` | Memperluas tabel `settings` untuk menyimpan API key & model Anthropic, DeepSeek, dan OpenAI |

---

## 5. Panduan Migrasi untuk Developer

1. **Terapkan Migrasi Database:**
   ```bash
   npm run migrate
   ```
2. **Perbarui Variabel Lingkungan (.env.local):**
   Pastikan menambahkan `JWT_SECRET` untuk sesi autentikasi pengguna baru:
   ```env
   JWT_SECRET="kunci-rahasia-jwt-minimal-32-karakter-acak"
   ```
3. **Login Pertama Kali:**
   Gunakan kredensial bawaan:
   - URL: `http://localhost:3000/login`
   - Email: `admin@tagflow.ai`
   - Sandi: `SuperAdmin123!`
   *(Segera ubah kata sandi melalui menu User Management setelah berhasil masuk).*

---
TagFlow v3.5 — Engineering Automation Platform.

