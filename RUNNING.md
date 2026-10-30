# TagFlow — Menjalankan Proyek (v3.5)

Untuk setup dari nol, mulai dari **[SETUP.md](SETUP.md)**. Dokumen ini fokus pada
menjalankan, konfigurasi, dan troubleshooting.

## Prasyarat

1. **PostgreSQL** (v12+) — default `postgresql://localhost:5432`
2. **Redis** (v6+) — default `redis://localhost:6379`
3. **Gemini API key** — <https://ai.google.dev>

> **DeepSeek tidak bisa dipakai untuk Run Detection.** Provider ini text-only dan
> tidak bisa menganalisis gambar/PDF. Scan Legend dan Run Detection keduanya
> butuh Gemini — pilih Gemini di Settings.

---

## Konfigurasi environment

`.env.example` mendokumentasikan seluruh knob yang tersedia (128 variabel).
Minimum:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/asset_db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_min_32_chars
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=a_model_your_key_actually_offers
AI_PROVIDER=gemini
STORAGE_PATH=./storage
```

> **Set model yang nyata.** `GEMINI_MODEL` punya default yang bisa sudah deprecated
> dan app **sengaja tidak** menulis ulang nilai itu untuk Anda. Model yang mengabaikan
> `responseMimeType=application/json` dilewati otomatis, dan model lain yang tidak
> tersedia jatuh ke `GEMINI_PREFERRED_MODELS`. Gunakan **Settings → Scan Models**
> untuk melihat persis apa yang bisa dijangkau key Anda.

### Precedence

Semua nilai operasional dibaca lewat **satu** jalur (`lib/tuning.ts`), dari atas:

```
settings.tuning  (DB, diedit dari UI Settings)
      ↓
process.env     (.env.local / .env)
      ↓
default di kode (lib/env.ts)
```

Tidak ada kode lain yang membaca `process.env` langsung untuk nilai tuning. Cache
30 detik, jadi perubahan Settings berlaku hampir seketika tanpa restart.

---

## Database

```bash
npm run migrate        # idempoten, aman diulang
```

Untuk database baru, `sql/init.sql` sudah cukup. Untuk database lama, jalankan
`npm run migrate` — migrasi tersebut mencakup `sql/migrate-009-settings-tuning.sql`
yang menambah kolom `settings.tuning`. Tanpa itu app tetap jalan (tuning fallback ke
`.env`/default), tapi bagian tuning di halaman Settings disembunyikan.

---

## Menjalankan

### Terminal 1 — Next.js dev server

```bash
npm run dev
```
→ <http://localhost:3000>

### Terminal 2 — Detection worker

```bash
npm run worker
```

Worker memproses job deteksi dari antrian Redis. **Job tidak akan pernah selesai
tanpa worker** — UI akan menampilkan status `PENDING` selamanya.

Fallback: `npm run worker:legacy` (ts-node, tanpa `--env-file`).

---

## Test workflow

### 1. Buat Project
`/projects` → "New Project" → isi nama.

### 2. Upload Legend PDF
`/legends/new` → tab "Upload PDF" → pilih file → upload.

Gemini mengekstraksi simbol per region grid. Hasilnya masuk sebagai `DRAFT`.

### 3. Review simbol — `legends/[id]/review`

Ada **dua** status yang terpisah, dan ini sumber kebingungan paling sering:

| Aksi | Yang diubah | Efek |
|---|---|---|
| **Approve All** | `status`: DRAFT → ACTIVE | Simbol jadi aktif di UI |
| **Validate All** | `quality_status`: NULL → validated | Simbol jadi **matcher-eligible** |
| **Mark Validated** | `quality_status` (per simbol) | Sama, untuk satu simbol |
| **Re-crop** | bbox + crop baru (versi baru) | Reset `quality_status` ke NULL |
| **Reject** | `status=REJECTED` + `review_reason` | Dikeluarkan dari register |

Aturan matcher-eligible: `quality_status = 'validated'` **AND** crop terbaca.

> **Approve ≠ Validate.** `Approve All` **tidak** menyentuh `quality_status`.
> Kalau hanya approve, semua `quality_status` tetap `NULL`, tab `VALIDATED` tetap 0,
> dan **Finalize & Activate akan ditolak** oleh quality gate
> (`app/api/legends/[id]/route.ts`) selama ada draft / unassessed / `review`.

`Validate All` melewati simbol yang: tidak punya crop, sudah validated, atau
sudah di-reject (di kedua kolom). Response API melaporkan semua bucket
(`validated` / `already` / `noCrop` / `rejected`) supaya run 0-row bisa dijelaskan.

Klik **Finalize & Activate** setelah itu.

> **Belum ada diagnostics otomatis.** Kolom `computed_features`, `quality_reasons`,
> dan `pipeline_version` sudah ada di schema dan UI sudah membacanya, tapi tidak ada
> pipeline yang mengisinya. `quality_status` hanya berubah karena aksi manusia.
> Detail: `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md`.

### 4. Upload dokumen P&ID
`/documents` → upload PDF. Sistem membaca jumlah halaman.

### 5. Run Detection
`/detection` → pilih project + dokumen + legend → "Run Detection".

Worker memproses job asynchronously. Pantau progres (halaman ke berapa, jumlah
deteksi, confidence distribution).

### 6. Review detections
`/review` — confirm / edit / reject / manual add.

### 7. Export Asset Register
`/asset-register` → filter sesuai kebutuhan → "Export Asset Register (.xlsx)".

---

## Arsitektur

```text
Frontend (Next.js App Router)
    ↓
API Routes (Node.js runtime)
    ↓
Database (PostgreSQL)          storage/ (filesystem)
    ↑                                    ↑
Detection Worker (BullMQ + Redis) ──────┘
    ↑
AI Provider (Gemini)
```

**Flow:**
1. User upload P&ID → disimpan di `storage/`
2. Detection job di-antri ke Redis
3. Worker mengambil job, render halaman → PNG, kirim ke Gemini
4. Gemini mengembalikan deteksi (JSON terstruktur)
5. Hasil divalidasi ( rantai 9 tahap) + disimpan ke `detections`
6. UI polling status job, menampilkan hasil
7. User review (confirm/reject)
8. Aset confirmed → export Excel

---

## Lapisan ketahanan panggilan Gemini

Semua panggilan melewati `lib/gemini-request-gate.ts` (rate limit process-wide),
`lib/ai-circuit-breaker.ts` (breaker per model), dan `lib/model-resolver.ts`
(discovery model). Scan Legend dan Run Detection **berbagi satu kuota** — tidak
masing-masing punya ide sendiri soal boleh seberapa cepat.

| Gejala di log | Arti |
|---|---|
| `skipping <model>: circuit open` | Model itu 429/503 berulang; dilewati sampai cooldown habis |
| `attempt cap reached (N)` | Region itu sudah coba N model. Cap ini **per region**, bukan per halaman |
| `no usable model left` | Semua model breaker-nya open → halaman di-abort, bukan lanjut mengulang kegagalan |
| `request gate` | Menunggu slot RPM berikutnya |

---

## Logs & debugging

**Detection worker** (Terminal 2):
```
[detection] job=<job-id> start
[gemini] trying model=<model> page=1
[gemini] success model=<model> detections=5
[legend-extract] page 1: 3536x2491, splitting into 4x4=16 regions
[legend-extract] page 1: 108 raw → 55 after dedup
[model-resolver] Gemini candidates: ...
[legend/bulk-validate] legend=<id> validated=12 pending=0 noCrop=0 rejected=0
```

> Prefix log yang aktif: `[gemini]`, `[legend-extract]`, `[legend/reparse]`,
> `[model-resolver]`, `[legend/bulk-validate]`, `[ai-retry]`, `[db]`, `[env]`.
> Prefix lama `[parseLegendPdf]` **tidak lagi dipakai**.

**Database check:**
```sql
SELECT * FROM legends;
SELECT id, asset_type, symbol_name, status, quality_status, pipeline_version
  FROM legend_symbols WHERE legend_id = '<id>';
SELECT * FROM detection_jobs ORDER BY created_at DESC LIMIT 10;
SELECT validation_status, count(*) FROM detections GROUP BY 1;
```

**Health & quota:**
```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/quota
```

---

## Troubleshooting

### "No symbols on this page" / legend 0 simbol
- Gemini gagal parse → cek log `[legend-extract]` di Terminal 1.
- 429/503 → lihat bagian 429/503 di bawah.
- Re-upload legend PDF, atau tambahkan simbol manual lewat **Add Symbol** di
  `/legends/[id]/review` (mode draw-to-add).

### Tab VALIDATED tetap 0 setelah Approve All
- Ini **expected** — Approve All hanya mengubah `status`, bukan `quality_status`.
- Klik **Validate All**.

### Finalize ditolak: "Quality gate"
- Message memuat `unassessed` / `in_review` / `drafts`.
- Jalankan **Validate All** dan **Approve All** sampai ketiganya 0.
- `review` tidak bisa di-mass-validate dengan sengaja — simbol itu harus diputuskan
  manusia satu per satu (Re-crop, Reject, atau Mark Validated).

### Detection job stuck di PENDING
- Worker tidak jalan (Terminal 2).
- Redis tidak terjangkau (`REDIS_URL`).
- BullMQ lock: job dengan sweep panjang bisa di-flag stalled. Default
  `WORKER_LOCK_DURATION_MS=900000` (15 menit) dan
  `WORKER_MAX_STALLED_COUNT=1` — kalau job Anda rutin lebih dari itu, naikkan
  nilainya di Settings.

### "All Gemini models exhausted"
- Semua kandidat gagal. Cari alasan per-model di log.
- Cause paling umum: `GEMINI_MODEL` yang sudah tidak ada. Set model yang benar-benar
  tersedia (Settings → Scan Models) dan pastikan `GEMINI_PREFERRED_MODELS` juga
  berisi model hidup.
- 503 di semua model = outage sisi provider, bukan masalah config. Coba lagi
  nanti. `GEMINI_RETRY_MAX_ATTEMPTS` mengatur seberapa keras retry.

### 429 / quota exceeded
- Terlalu banyak request per menit.
- Region mode = satu panggilan per region, jadi grid 3×2 = 6 panggilan per halaman
  plus catch-up pass. Grid legend 4×4 = 17 permintaan per halaman — **melebihi kuota
  free tier 15 RPM**.
- Solusi: naikkan `GEMINI_REQUESTS_PER_MINUTE` (Settings → Tuning) kalau kuota
  sebenarnya lebih besar, turunkan `LEGEND_REGION_ROWS` / `DETECTION_REGION_ROWS`,
  atau pindah ke `DETECTION_REGION_MODE=page`.
- Pastikan `ENABLE_SYMBOL_FEATURE_EXTRACTION` dan `ENABLE_SYMBOL_EMBEDDING` tetap
  `false`; masing-masing menambah satu panggilan per deteksi.

### 503 "high demand"
- Ini respons sisi Google, sementara. Tidak ada yang bisa diperbaiki di kode.
- Yang penting: breaker harus trip supaya model lain dicoba dan halaman tidak
  diulang sampai habis. Kalau region succeeding menunjukkan
  `attempt cap reached (N)` **tanpa** baris `model <name>:` di atasnya, itu cap
  per-region yang belum ke-reset — laporkan sebagai bug.

### Halaman lebih dari 120 detik
- Ceiling yang diharapkan. Kalau rutin lampaui, biasanya karena region grid plus
  enrichment opsional. Matikan flag enrichment dulu, baru perkecil grid.

### Deteksi sedikit/tidak ada di sheet padat
- Pastikan `DETECTION_REGION_MODE=regions` (default). Mode single-page memampatkan
  sheet A3 padat sampai tag 6pt tidak terbaca.
- Coba naikkan `DETECTION_REGION_COLS` / `ROWS` untuk split lebih padat.
- Pastikan Legend punya simbol ACTIVE **dan** ber-`quality_status='validated'`
  dengan crop terbaca.

### PDF viewer menampilkan canvas kosong
- File PDF tidak tersimpan benar → cek `storage/` dan `STORAGE_PATH` di `.env.local`.

### 401 dari Gemini
- API key invalid/expired → regenerate di <https://ai.google.dev>, update
  `.env.local` (atau Settings page, yang menang).

### Perubahan di Settings tidak berlaku
- Tuning di-cache 30 detik — tunggu sebentar lalu coba lagi.
- Kalau bagian tuning hilang dari halaman, migrasi
  `sql/migrate-009-settings-tuning.sql` belum applied → `npm run migrate`.

---

## Status roadmap

| Item | Status |
|---|---|
| Gemini Vision detection + region grid | Selesai |
| Scan Legend (region grid + catch-up pass) | Selesai |
| Validation chain 9 tahap + fusion confidence | Selesai |
| Human review + Asset Register + Excel export | Selesai |
| Bulk approve / bulk validate legend | Selesai |
| Automated legend quality diagnostics (`computed_features`) | **Belum ada** |
| Benchmark / ground-truth tooling (`scripts/benchmark.ts`) | **Belum ada** |
| Custom CV model training | Di luar scope (lihat `docs/PRD.md` §4) |