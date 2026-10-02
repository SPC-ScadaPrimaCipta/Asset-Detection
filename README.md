# Automatic Asset Detection

Aplikasi deteksi aset industri otomatis dari dokumen P&ID / PFD menggunakan AI multimodal (Google Gemini).

> **Gemini-First.** Detection 100% Google Gemini Vision: satu halaman P&ID di-render
> menjadi PNG lalu dikirim ke Gemini bersama Legend Library yang dipilih. Tidak ada
> OCR, tidak ada OpenCV/CV service, tidak ada model deteksi lokal di jalur ini.
> Lihat `docs/PRD.md` untuk requirement produk dan
> `docs/ASSET_REGISTER_EXCEL_EXPORT.md` untuk format export.

---

## Deskripsi

Sistem ini memungkinkan engineer untuk mengunggah dokumen P&ID (Piping and Instrumentation Diagram) dalam format PDF, lalu AI Agent secara otomatis mengidentifikasi peralatan/aset (pump, valve, vessel, dll), tag aset, dan mencocokkannya dengan Legend yang dipilih. Hasil deteksi kemudian dapat di-review, dikonfirmasi, diedit, atau ditolak sebelum dijadikan Asset Register final yang dapat diekspor ke Excel.

---

## Alur Kerja

```
1. Buat Project
       ↓
2. Upload Legend (manual atau dari PDF)
       ↓
3. Review simbol Legend → Re-crop / Reject / Mark Validated
       ↓
4. Upload dokumen P&ID / PFD (PDF)
       ↓
5. Pilih Legend → Run Detection
       ↓
6. AI Agent (Gemini) analisis setiap halaman P&ID
       ↓
7. Hasil: simbol terdeteksi + tag aset + confidence + bounding box
       ↓
8. Human Review: Confirm / Edit / Reject / Manual Add
       ↓
9. Asset Register final terbentuk
       ↓
10. Export Asset_Register.xlsx
```

### Tahap kualitas Legend (wajib sebelum Finalize)

Legend punya siklus hidup kualitas sendiri yang **terpisah** dari status approve:

| Kolom | Nilai | Diisi oleh |
|---|---|---|
| `status` | `DRAFT` / `ACTIVE` / `REJECTED` | tombol **Approve All** atau per-simbol |
| `quality_status` | `NULL` / `validated` / `review` / `rejected` | **Validate All**, **Mark Validated**, atau **Reject** |
| `pipeline_version` | `human-validated-v1` | saat validasi manusia |

> **Approve ≠ Validate.** `Approve All` hanya mengubah `status`; ia tidak menyentuh
> `quality_status`. Tanpa Validate, `quality_status` tetap `NULL` dan **Finalize &
> Activate akan ditolak** oleh quality gate (menolak finalize selama ada draft,
> unassessed, atau `review`).

Aturan matcher-eligible: `quality_status = 'validated'` **AND** crop file terbaca.
`review`, `rejected`, dan tanpa crop tidak pernah eligible.

> **Belum ada diagnostics otomatis.** Kolom `computed_features`, `quality_reasons`,
> dan `pipeline_version` sudah ada di DB (`sql/migrate-007-legend-quality-classes.sql`)
> dan UI sudah membacanya, tetapi **tidak ada pipeline yang mengisinya**. Selama ini
> `quality_status` hanya berubah karena aksi manusia. Lihat
> `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md` untuk status quo.

---

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Frontend | Next.js 16.3.5 (App Router), React 19.2.8, TypeScript 5, Tailwind CSS 4 |
| Backend | Next.js App Router API Routes (Node.js runtime) |
| Database | PostgreSQL (pg 8) |
| AI | Google Gemini (`@google/generative-ai`), DeepSeek via OpenAI SDK |
| Queue | BullMQ 6 + Redis (ioredis) |
| Storage | Local filesystem (`./storage`) |
| PDF | mupdf (render server) + pdfjs-dist (viewer browser) |
| Image | sharp (crop, upscale, sharpen) |
| Excel | ExcelJS 4 |
| Ikon | `@phosphor-icons/react` (satu-satunya yang dipakai) |

### Pemilihan model Gemini

Tidak ada model id yang di-hardcode di jalur analisis. `lib/model-resolver.ts`
menDiscoveri model yang benar-benar tersedia untuk API key Anda saat runtime, lalu
mengurutkan kandidat:

1. Model yang dikonfigurasi (`GEMINI_MODEL` / Settings) jika ada di daftar API
2. `GEMINI_PREFERRED_MODELS` berurutan
3. Model lain yang didukung `generateContent`

Model yang mengabaikan `responseMimeType: application/json` dilewati lewat
`GEMINI_JSON_INCOMPATIBLE_MODELS`. Gunakan **Settings → Scan Models** untuk melihat
model apa yang bisa dijangkau key Anda.

---

## Struktur Halaman

| URL | Fungsi |
|-----|--------|
| `/` | Dashboard — statistik dokumen, job, deteksi |
| `/projects` | Kelola project |
| `/documents` | Upload & kelola dokumen PDF per project |
| `/legends` | Library legend — daftar semua legend |
| `/legends/new` | Buat legend baru (manual atau upload PDF) |
| `/legends/[id]` | Detail & edit legend |
| `/legends/[id]/review` | Review simbol: re-crop, reject, validate, bulk approve/validate |
| `/detection` | Workspace utama — pilih dokumen + legend, jalankan deteksi, P&ID viewer + tabel aset |
| `/review` | Batch review semua deteksi pending |
| `/assets` | Asset Register final — filter, search |
| `/asset-register` | Export Asset Register (.xlsx) |
| `/settings` | AI provider, API key, model, dan tuning operasional |

---

## Struktur API

```text
# Projects
POST   /api/projects                     Buat project
GET    /api/projects                     List project
GET    /api/projects/[id]                Detail project
DELETE /api/projects/[id]                Hapus project
GET    /api/projects/[id]/export         Export per project

# Documents
POST   /api/documents                    Upload PDF
GET    /api/documents                    List dokumen (filter: project_id)
GET    /api/documents/[id]               Detail dokumen
DELETE /api/documents/[id]               Hapus dokumen
GET    /api/documents/[id]/export        Export dokumen
GET    /api/documents/[id]/pages/[page]/image   Render halaman

# Legends
POST   /api/legends                      Buat legend
GET    /api/legends                      List legend (+ symbol_count)
GET    /api/legends/[id]                 Detail legend
PUT    /api/legends/[id]                 Update legend (status/strictQuality)
DELETE /api/legends/[id]                 Hapus legend
POST   /api/legends/upload               Upload PDF → AI parse → buat legend
POST   /api/legends/[id]/reparse         Re-parse penuh: hapus semua simbol, jalankan ulang ekstraksi
GET    /api/legends/[id]/pdf             Serve PDF legend
GET    /api/legends/[id]/pages/count     Jumlah halaman PDF
GET    /api/legends/[id]/pages/[page]/image  Render halaman legend

# Legend symbols + siklus hidup kualitas
GET    /api/legends/[id]/symbols                    List simbol (?include_draft=true)
POST   /api/legends/[id]/symbols                    Tambah simbol manual
PUT    /api/legends/[id]/symbols/[symbolId]         Edit simbol
DELETE /api/legends/[id]/symbols/[symbolId]         Hapus simbol
POST   /api/legends/[id]/symbols/[symbolId]/validate   Tandai VALIDATED (per simbol)
POST   /api/legends/[id]/symbols/[symbolId]/recrop     Re-crop versi baru (bbox digambar)
POST   /api/legends/[id]/symbols/[symbolId]/crop       Crop dari bbox tersimpan
POST   /api/legends/[id]/symbols/bulk-approve          DRAFT → ACTIVE (semua)
POST   /api/legends/[id]/symbols/bulk-validate         → VALIDATED (yang punya crop, tanpa rejected)

# Detection jobs
POST   /api/detection/jobs              Buat & antri detection job
GET    /api/detection/jobs              List jobs (+ stats per job)
GET    /api/detection/jobs/[id]         Status + progress job
POST   /api/detection/jobs/[id]/run     Re-trigger job ke queue
POST   /api/detection/jobs/[id]/cancel  Cancel job

# Detections
GET    /api/detections                  List (filter: job_id, status, q, confidence)
GET    /api/detections/[id]             Detail
PUT    /api/detections/[id]             Edit
POST   /api/detections/[id]/confirm     Konfirmasi → asset register
POST   /api/detections/[id]/reject      Tolak
POST   /api/detections/[id]/unreview    Kembalikan ke review
POST   /api/detections/manual           Tambah aset manual
POST   /api/detections/bulk             Aksi massal
POST   /api/detections/deduplicate      Deteksi duplikat lintas job

# Assets & export
GET    /api/assets                      List asset register (filter + pagination)
GET    /api/assets/[id]                 Detail asset
GET    /api/export/assets               Download Asset_Register.xlsx

# Pengetahuan & aturan
GET    /api/knowledge                   Company knowledge base
POST   /api/knowledge
GET    /api/knowledge/[id]
GET    /api/rules                       Rule engine rules
POST   /api/rules
DELETE /api/rules/[id]                  (via /api/rules)

# Embedding & cache
POST   /api/embeddings/search           Pencarian kemiripan symbol
GET    /api/embeddings/search
GET    /api/cache/[hash]                Cache file (crop / page render)

# Operasional
GET    /api/stats                       Dashboard statistics
GET    /api/health                      Health check + provider info
GET    /api/quota                       Status kuota Gemini
GET    /api/settings                    Baca settings + tuning
PUT    /api/settings                    Tulis settings + tuning
POST   /api/settings/scan-models        Scan model yang tersedia untuk API key
POST   /api/debug-reparse               Re-parse legend (dev)
```

---

## Database Schema

```text
projects
  └── documents
        ├── document_pages
        ├── detection_jobs
        │     └── agent_runs
        │     └── detections ──→ assets
        │     └── detection_audits
        └── detection_audit_trail

legends
  ├── legend_symbols ──→ legend_classes
  └── legend_classes

settings                        (singleton id=1: AI config + tuning JSON)
company_knowledge
rule_engine_rules
symbol_cache
symbol_embeddings
negative_learning
```

Tabel utama:
- `projects` — container untuk dokumen dan job
- `legends` + `legend_symbols` + `legend_classes` — referensi simbol P&ID per organisasi/plant, termasuk siklus hidup kualitas
- `documents` + `document_pages` — file PDF yang diupload dan metadata per halaman
- `detection_jobs` — job antrian deteksi (PENDING → PROCESSING → COMPLETED/FAILED/CANCELLED)
- `agent_runs` — log eksekusi AI per job (model, prompt version, durasi, error)
- `detections` — hasil deteksi AI per aset (bbox, confidence, evidence, validation_status)
- `detection_audits` / `detection_audit_trail` — jejak audit aksi review
- `assets` — aset yang sudah dikonfirmasi (final asset register)
- `settings` — baris tunggal: provider, API key, model, dan dokumen `tuning`
- `company_knowledge`, `rule_engine_rules`, `symbol_cache`, `symbol_embeddings`, `negative_learning` — lapisan pengetahuan & validasi

Migrasi: `npm run migrate` (idempoten, aman diulang). `sql/init.sql` untuk database baru.

---

## Cara Menjalankan

Ringkas: lihat **[SETUP.md](SETUP.md)** untuk panduan setup lengkap dan
**[RUNNING.md](RUNNING.md)** untuk troubleshooting operasional.

### Prasyarat

- Node.js 20+
- PostgreSQL, Redis

### Install & migrate

```bash
npm install
cp .env.example .env.local   # isi DATABASE_URL, REDIS_URL, GEMINI_API_KEY
npm run migrate
```

### Jalankan aplikasi (2 terminal)

```bash
# Terminal 1 — Next.js
npm run dev            # → http://localhost:3000

# Terminal 2 — BullMQ detection worker
npm run worker
```

Command lain:

| Command | Fungsi |
|---|---|
| `npm test` | Jalankan test suite (Jest) |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run migrate` | Terapkan migrasi database (idempoten) |
| `npm run seed:standards` | Seed legend standar bawaan |
| `npm run worker:legacy` | Worker via ts-node (fallback) |

---

## Gemini Call Budget & Resilience

Semua panggilan Gemini melewati lapisan ini, bukan memanggil provider langsung di setiap loop:

| Modul | Tugas |
|---|---|
| `lib/gemini-request-gate.ts` | Rate limit **process-wide** (RPM), dibagi bersama Scan Legend & Run Detection |
| `lib/ai-circuit-breaker.ts` | Breaker **per model**: model yang 429/503 berulang dilewati selama cooldown |
| `lib/model-resolver.ts` | Discovery model saat runtime + fallback berurutan |
| `lib/tuning.ts` | **Satu** jalur baca untuk semua nilai operasional (DB > .env > default) |

Legenda ekstraksi memakai grid region + satu pass catch-up. Variable kunci:

| Variable | Default | Dampak |
|---|---|---|
| `GEMINI_REQUESTS_PER_MINUTE` | `15` | Batas keras semua request Gemini di proses |
| `GEMINI_MAX_MODEL_ATTEMPTS` | `3` | Jatuh maksimal model **per region** (bukan per halaman) |
| `GEMINI_CIRCUIT_FAILURES` / `_COOLDOWN_MS` | `3` / `300000` | Kapan breaker suatu model trip |
| `ENABLE_SYMBOL_FEATURE_EXTRACTION` | `false` | +1 panggilan per deteksi - menghabiskan kuota free tier |
| `ENABLE_SYMBOL_EMBEDDING` | `false` | +1 panggilan embedding per deteksi |

Nilai mana pun bisa dioverride dari **Settings → Tuning** tanpa restart (cache 30 detik).

---

## Confidence & Validation Status

Detection tidak memakai tiga band High/Medium/Low. `detections.validation_status`
hanya punya tiga nilai:

| Nilai | Kapan |
|---|---|
| `VALID` | Semua evidence konsisten, confidence ≥ `DETECTION_REVIEW_THRESHOLD` |
| `NEEDS_REVIEW` | Tipe `UNKNOWN`, field evidence lemah, confidence di bawah threshold, atau total penalty ≥ `DETECTION_PENALTY_REVIEW_THRESHOLD` |
| `CONFLICT` | Legend dan Company KB tidak sepakat |

Default `DETECTION_REVIEW_THRESHOLD = 0.65` (bukan 0.80). Penalty lain: tag hilang,
evidence tipis, bbox kebesaran, bbox degenerat. Semua configurable.

Validasi berantai: `CACHE → LEGEND → KB → EMBEDDING → RULES → ISA → ISO → VISION → UNKNOWN`.

---

## Excel Output

File `Asset_Register.xlsx` berisi 5 sheet:
1. **Asset Register** — daftar aset final
2. **Equipment Summary** — ringkasan per tipe aset
3. **Detection Summary** — statistik confidence
4. **Legend Used** — legend yang dipakai
5. **Detection Evidence** — bukti per deteksi

Aset dengan status REJECTED tidak muncul di sheet Asset Register.

---

## Struktur Folder

```
Asset-Detection/
├── app/                       Next.js App Router pages + API routes
│   ├── page.tsx               Dashboard
│   ├── detection/             Workspace deteksi utama
│   ├── review/                Batch review deteksi
│   ├── assets/  asset-register/  documents/  projects/
│   ├── legends/               Legend library + review simbol
│   ├── settings/              Provider, key, model, tuning
│   └── api/                   REST API routes
├── components/ui/             Shared UI (button, card, table, modal, badge, …)
├── lib/
│   ├── ai-agent.ts             AI Agent runner (Gemini/DeepSeek) + fallback chain
│   ├── ai-schemas.ts          Zod schema validasi output AI
│   ├── ai-config.ts           Resolved provider/key/model (DB > env)
│   ├── ai-circuit-breaker.ts  Breaker per model
│   ├── ai-generation.ts       Generation config per flow
│   ├── ai-prompts/            Prompt builder (symbol-detector, legend-extractor, rule-validator)
│   ├── gemini.ts              Klien Gemini + DeepSeek
│   ├── gemini-request-gate.ts Rate limit process-wide
│   ├── model-resolver.ts      Discovery model runtime
│   ├── tuning.ts              Jalur baca tunggal untuk semua tuning
│   ├── env.ts                 Validasi env (Zod)
│   ├── db.ts                  Pool PostgreSQL
│   ├── queue.ts               BullMQ queue
│   ├── workers/detection-worker.ts (lihat di bawah)
│   ├── pdf-render.ts          Validasi + render PDF (mupdf, fallback render-page.mjs)
│   ├── legend-extract.ts      Ekstraksi simbol legend (region grid + catch-up)
│   ├── legend-crop.ts         Crop + simpan reference image
│   ├── image-crop.ts          Utilitas crop
│   ├── spatial.ts             Asosiasi tag↔simbol
│   ├── rule-validator.ts      Rantai validasi 9 tahap
│   ├── rule-engine.ts         Rule engine
│   ├── confidence-fusion.ts   Fusion confidence
│   ├── excel-export.ts        Workbook ExcelJS
│   ├── storage.ts             File storage (local)
│   ├── symbol-cache.ts        Cache & deteksi duplikat (image_hash lokal)
│   ├── knowledge-db.ts        Company knowledge base
│   ├── vector-repository.ts   Embedding search
│   ├── embedding-service.ts   Embedding Gemini
│   ├── feature-extractor.ts   Ekstraksi fitur visual (opt-in)
│   ├── description-template.ts Template deskripsi
│   ├── rate-limit.ts          Rate limit API
│   ├── standard-legends.ts    Legend standar bawaan
│   ├── detection/             config, geometry, region, legend, ai, persistence
│   └── learning/negative-learning.ts
├── workers/
│   ├── detection-worker.ts    BullMQ processor
│   └── preload.ts             Preload worker
├── scripts/                   migrate, seed, backfill, render-page
├── sql/                       init.sql + migrate-*.sql
├── __tests__/                 Test suite Jest
├── docs/                      PRD, arsitektur, export spec, V2 plan
├── eval/                      Ground truth & laporan evaluasi
├── docker-compose.yml         PostgreSQL + Redis
├── start-services.bat         Helper start service (Windows)
├── ecosystem.config.cjs       PM2 config
└── .env.example               128 env var terdokumentasi
```