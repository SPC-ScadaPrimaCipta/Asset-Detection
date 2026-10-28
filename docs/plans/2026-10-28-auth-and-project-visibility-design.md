# Design Document: Auth, Multi-User Projects (Private/Public), Scoped Legends, and Clone/Share Mechanism

**Date:** 2026-10-28  
**Status:** Approved by User (Hybrid Option Selected)  
**Author:** Senior Software Engineer (Antigravity)

---

## 1. Background & Goals

Saat ini, sistem Asset Detection beroperasi secara single-tenant / global:
- Tidak ada autentikasi pengguna; siapa pun yang membuka aplikasi memiliki akses penuh ke seluruh proyek, dokumen, dan legend.
- Seluruh Legend bersifat global dan tidak terikat pada proyek tertentu.
- Tidak ada batasan akses proyek pribadi (Private) versus proyek bersama (Public).

**Tujuan Pengembangan:**
1. Menyediakan fitur autentikasi (Login, Register, Logout) dengan session yang aman dan pragmatis.
2. Mendukung **Private Projects** (khusus pemilik) dan **Public Projects** (dapat dilihat oleh semua pengguna).
3. Mengasosiasikan **Legend** dengan proyeknya masing-masing, sembari tetap mempertahankan Built-in Standard Legends (ISA 5.1 / ISO 10628) secara global.
4. Memigrasikan seluruh data proyek, dokumen, dan legend yang sudah ada menjadi **Public** dengan keterangan pemilik awal ("System / Admin").
5. Menyediakan mekanisme **Hybrid Clone & Share**:
   - Proyek Public bersifat *read-only* bagi pengguna lain.
   - Pengguna dapat meng-klik **"Clone to My Workspace"** untuk menduplikasi proyek (beserta dokumen, legend, dan hasil deteksi) ke ruang kerja privatnya.
   - Berbagi proyek private antar rekan kerja menggunakan **Share Code** unik tanpa harus menjadikannya public ke semua orang.

---

## 2. Architecture & Database Design

### 2.1. Tabel Autentikasi (`users`)

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'USER')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

**Pilihan Teknologi Auth:**
- Password hashing menggunakan Node.js `crypto.scrypt` (native standard library, tidak butuh dependensi native biner seperti bcrypt yang rentan kompilasi di Windows).
- Session disimpan dalam cookie `session_token` (HTTP-only, SameSite=Lax, Secure bila HTTPS).
- Token session diverifikasi di `lib/auth.ts` dengan durasi aktif (misal 7 hari).

### 2.2. Pembaruan Tabel `projects`

```sql
ALTER TABLE projects
  ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  ADD COLUMN share_code TEXT UNIQUE,
  ADD COLUMN cloned_from_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN description TEXT;

CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_visibility ON projects(visibility);
CREATE INDEX idx_projects_share_code ON projects(share_code);
```

### 2.3. Pembaruan Tabel `legends` (Project-Scoped Legends)

```sql
ALTER TABLE legends
  ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE'));

CREATE INDEX idx_legends_project ON legends(project_id);
```

**Aturan Legend:**
- **Built-in Standards (ISA 5.1, ISO 10628, dll.):** `is_builtin = TRUE`, `project_id = NULL`, `visibility = 'PUBLIC'`. Tersedia untuk semua proyek.
- **Project-Specific Legend:** `project_id = <project_id>`. Hanya muncul pada proyek tersebut.
- Saat deteksi dijalankan di suatu proyek, dropdown Legend menyajikan:
  1. Built-in Standards.
  2. Legend spesifik proyek tersebut.

### 2.4. Migrasi Data Eksisting (Backward Compatibility)

Pada file migrasi:
1. Insert satu pengguna default Administrator:
   - Nama: `Admin / System`
   - Email: `admin@assetdetection.local`
2. Update semua row `projects` yang ada:
   - `owner_id` = ID Admin di atas.
   - `visibility` = `'PUBLIC'`.
   - `share_code` = generate kode acak 8 karakter.
3. Update semua row `legends` yang ada:
   - `owner_id` = ID Admin di atas.
   - `visibility` = `'PUBLIC'`.
   - Legend yang bukan built-in dan digunakan oleh detection job suatu project akan dihubungkan ke `project_id` terkait.

---

## 3. Mekanisme Hybrid: Clone & Share Code

### 3.1. Alur Clone dari Public ke Private

```
[Public Project] ──(Klik "Clone to My Workspace")──► [Backend /api/projects/:id/clone]
                                                            │
                                  ┌─────────────────────────┴─────────────────────────┐
                                  ▼                                                   ▼
                         Duplikasi Record DB                                   Storage File Fisik
                      - Project baru (PRIVATE)                                (PDF & Gambar P&ID)
                      - Owner: Current User                                    TIDAK diduplikasi.
                      - Cloned from: Public ID                                Merujuk file_path sama.
                      - Duplikasi Document Pages & Detections
                      - Duplikasi Custom Project Legends
```

**Keunggulan Zero Storage Bloat:**
- File PDF dan potongan gambar di `./storage` diakses via pointer nama file/hash.
- Meng-clone project dengan 50 halaman PDF tidak memakan ruang harddisk tambahan satu bita pun, dan selesai dalam waktu kurang dari 500 milidetik.

### 3.2. Alur Berbagi via Share Code

- Setiap project private memiliki opsi: **"Generate Share Code"** (misal: `PRJ-X8K2`).
- Pengguna A membagikan kode `PRJ-X8K2` kepada Pengguna B.
- Pengguna B membuka menu **"Join / Import Project"**, memasukkan kode tersebut.
- Sistem meng-clone project tersebut ke workspace Pengguna B, sehingga Pengguna B dapat menganalisis dan mereview tanpa merusak atau mengubah data milik Pengguna A.
- Pemilik asli bisa me-regenerate atau menonaktifkan share code kapan saja.

### 3.3. Alur Publish ke Public

- Pemilik project private dapat meng-klik **"Publish to Public"**.
- Dialog konfirmasi memberikan opsi:
  - Mengubah visibilitas project menjadi `PUBLIC` secara langsung, ATAU
  - Membuat duplikat salinan project sebagai versi Public (sehingga versi aslinya tetap aman di Private).

---

## 4. Rincian Antarmuka (UI/UX)

1. **Halaman Autentikasi (`/login` & `/register`):**
   - Clean, technical/industrial theme yang konsisten dengan tema aplikasi.
   - Validasi input, feedback error yang jelas.
2. **Sidebar Navigation (`app/sidebar-nav.tsx`):**
   - Bagian bawah sidebar menampilkan avatar/nama pengguna yang sedang login.
   - Tombol cepat ke profil / Logout.
3. **Halaman Proyek (`/projects`):**
   - Tab pemilih:
     - **"My Private Projects"** (hanya proyek milik user yang login).
     - **"Public Projects"** (semua proyek yang diset public).
   - Tombol **"Join via Code"** di header halaman.
   - Kartu proyek menampilkan:
     - Badge visibilitas: `[🔒 Private]` atau `[🌐 Public]`.
     - Keterangan pembuat: `Created by <Name>` + tanggal.
     - Aksi: Tombol **"Clone"**, **"Share"**, **"Edit/Delete"** (hanya untuk pemilik).
4. **Halaman Legend (`/legends`):**
   - Menampilkan tab: **"Standard Legends"** (Built-in) dan **"Project Legends"** (dikelompokkan berdasarkan proyek).
5. **Halaman Detection (`/detection`):**
   - Pilihan dokumen dan legend otomatis tersaring sesuai proyek yang sedang aktif.

---

## 5. Security & Access Control

- **API Guard:**
  Helper `getCurrentUser(req)` pada route API membaca cookie session.
  - Jika project bersifat `PRIVATE` dan `owner_id !== user.id`, tolak dengan status `403 Forbidden` (kecuali diakses via valid `share_code`).
  - Jika project bersifat `PUBLIC`, semua user terautentikasi memiliki akses `READ`, namun modifikasi (PUT/DELETE) dibatasi hanya untuk pemilik / admin.
- **Data Integrity:**
  Operasi clone dijalankan dalam transaksi PostgreSQL (`BEGIN ... COMMIT`) sehingga jika salah satu step gagal, database tidak meninggalkan record setengah jadi.
