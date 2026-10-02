# Setup — Asset Detection

Panduan setup lokal untuk Windows / Linux / macOS.

## Prasyarat

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | 20+ | `node --version` |
| PostgreSQL | 12+ | Default `localhost:5432` |
| Redis | 6+ | Default `localhost:6379` |
| Gemini API key | — | [Google AI Studio](https://aistudio.google.com) |

> **Tidak perlu menjalankan service Python/OpenCV.** Detection 100% Gemini Vision:
> tidak ada OCR, tidak ada CV service, tidak ada model lokal. Cukup PostgreSQL + Redis.

---

## 1. Install dependencies

```bash
npm install
```

---

## 2. Konfigurasi environment

```bash
cp .env.example .env.local     # Windows PowerShell: copy .env.example .env.local
```

Nilai minimum yang wajib diisi di `.env.local`:

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5432/asset_db
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your_gemini_key_here
AI_PROVIDER=gemini
STORAGE_PATH=./storage
```

> **Nama database bebas.** `DATABASE_URL` di atas hanya contoh — yang penting
> konsisten antara `.env.local` dan database yang benar-benar kamu buat (langkah 3).
> Pastikan `createdb` dan `psql` memakai nama yang sama.

`API key` **tidak wajib** ada di `.env.local` — bisa diatur lewat halaman
**Settings**, yang menang atas env.Yyey env tetap dipakai sebagai fallback saat app
start pertama kali.

> **Set model yang benar-benar ada.** `GEMINI_MODEL` punya default yang bisa sudah
> usang dan app **sengaja tidak** menulis ulang nilai itu diam-diam. Model yang
> mengabaikan `responseMimeType: application/json` dilewati otomatis, dan model
> lain yang tidak tersedia jatuh ke `GEMINI_PREFERRED_MODELS`. Cek dengan
> **Settings → Scan Models** melihat key kamu menjangkau model apa saja.

---

## 3. Inisialisasi database

Buat database (pilih satu nama, konsisten dengan `DATABASE_URL`):

```bash
# PostgreSQL
createdb asset_db

# atau lewat pgAdmin / SQL shell:
#   CREATE DATABASE asset_db;
```

Lalu terapkan schema + migrasi:

```bash
npm run migrate
```

`npm run migrate` idempoten (aman diulang) dan membaca `DATABASE_URL` dari
`.env.local`. Database baru juga bisa diinisialisasi langsung dengan:

```bash
psql -d asset_db -f sql/init.sql
```

Untuk database lama, `npm run migrate` sudah mencakup semua `sql/migrate-*.sql`.

---

## 4. Jalankan PostgreSQL & Redis

### Windows

```bash
# PostgreSQL (disesuaikan dengan lokasi instalasi)
pg_ctl -D "C:\Program Files\PostgreSQL\16\data" start

# Redis
redis-server.exe
```

Atau pakai file helper di root repo:

```bash
start-services.bat          # Windows
setup-redis-autostart.ps1   # autostart Redis saat boot
```

### Docker

```bash
docker-compose up -d
```

### Linux / macOS

```bash
sudo systemctl start postgresql
sudo systemctl start redis-server      # macOS: brew services start redis
```

---

## 5. Jalankan aplikasi (2 terminal)

```bash
# Terminal 1 — Next.js dev server
npm run dev
→ http://localhost:3000
```

```bash
# Terminal 2 — BullMQ detection worker
npm run worker
```

Worker wajib berjalan kalau Anda memakai **Run Detection** — job antrian hanya
diproses oleh worker, bukan oleh dev server.

> Untuk menjalankan worker di PM2 (produksi), gunakan `ecosystem.config.cjs`:
> `npx pm2 start ecosystem.config.cjs`

---

## 6. Alur uji coba

| Langkah | URL | Aksi |
|---|---|---|
| 1. Buat project | `/projects` | New Project |
| 2. Upload legend | `/legends/new` | Upload PDF legend → Gemini ekstraksi simbol |
| 3. Review simbol | `/legends/[id]/review` | Re-crop / Reject yang salah, lalu **Validate All** |
| 4. Finalize legend | `/legends/[id]/review` | **Finalize & Activate** |
| 5. Upload P&ID | `/documents` | Upload PDF P&ID |
| 6. Run detection | `/detection` | Pilih project + dokumen + legend → Run Detection |
| 7. Review deteksi | `/review` | Confirm / Edit / Reject |
| 8. Export | `/asset-register` | Export Asset Register (.xlsx) |

> **Langkah 3 wajib.** Legend harus punya simbol ber-`quality_status = 'validated'`
> dan crop terbaca agar bisa dipakai matcher, dan **Finalize & Activate** ditolak
> selama masih ada simbol DRAFT / belum di-assess / ber-status `review`.
> **Approve All saja tidak cukup** — ia hanya mengubah `status`, bukan `quality_status`.

---

## Troubleshooting setup

| Gejala | Penyebab & solusi |
|---|---|
| `[env] Validation failed: DATABASE_URL` | `.env.local` tidak ada atau `DATABASE_URL` kosong |
| Worker diam, job stuck `PENDING` | Worker tidak jalan (Terminal 2) atau `REDIS_URL` salah |
| `relation "settings" does not exist` | `npm run migrate` belum dijalankan |
| Halaman Settings tidak ada bagian tuning | Migrasi `sql/migrate-009-settings-tuning.sql` belum applied — jalankan `npm run migrate` |
| Legend 0 simbol | Lihat [RUNNING.md](RUNNING.md) → Troubleshooting |
| 503 / "All models failed" | Biasanya sisi provider (bukan config). Lihat [RUNNING.md](RUNNING.md) |

Seluruh troubleshooting ada di **[RUNNING.md](RUNNING.md)**.