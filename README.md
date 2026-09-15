# Automatic Asset Detection

Aplikasi deteksi aset industri otomatis dari dokumen P&ID / PFD menggunakan AI multimodal (Gemini / DeepSeek).

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
3. Review & edit simbol Legend
       ↓
4. Upload dokumen P&ID / PFD (PDF)
       ↓
5. Pilih Legend → Run Detection
       ↓
6. AI Agent (Gemini) analisis setiap halaman P&ID
       ↓
7. Hasil: simbol terdeteksi + tag aset + confidence score + bounding box
       ↓
8. Human Review: Confirm / Edit / Reject / Manual Add
       ↓
9. Asset Register final terbentuk
       ↓
10. Export Asset_Register.xlsx
```

---

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Backend | Next.js App Router API Routes |
| Database | PostgreSQL 16 |
| AI | Google Gemini (gemini-2.0-flash) / DeepSeek fallback |
| Queue | BullMQ + Redis |
| Storage | Local filesystem (`./storage`) |
| Excel | ExcelJS |

---

## Struktur Halaman

| URL | Fungsi |
|-----|--------|
| `/` | Dashboard — statistik total dokumen, job, deteksi |
| `/projects` | Kelola project |
| `/detection` | Workspace utama — pilih dokumen + legend, jalankan deteksi, lihat P&ID viewer + tabel aset |
| `/review` | Batch review semua deteksi pending — confirm/edit/reject massal |
| `/documents` | Upload & kelola dokumen PDF per project |
| `/legends` | Library legend — daftar semua legend |
| `/legends/new` | Buat legend baru (manual atau upload PDF) |
| `/legends/[id]` | Edit legend — kelola simbol, tag pattern, aliases |
| `/assets` | Asset Register final — filter, search, export Excel |

---

## Struktur API

```
POST   /api/projects              Buat project
GET    /api/projects              List project

POST   /api/documents             Upload PDF
GET    /api/documents             List dokumen (filter: project_id)
DELETE /api/documents/[id]        Hapus dokumen

POST   /api/legends               Buat legend
GET    /api/legends               List legend (+ symbol_count)
PUT    /api/legends/[id]          Update legend
DELETE /api/legends/[id]          Hapus legend
POST   /api/legends/upload        Upload PDF → AI parse → buat legend

POST   /api/legends/[id]/symbols          Tambah simbol
GET    /api/legends/[id]/symbols          List simbol
PUT    /api/legends/[id]/symbols/[sid]    Edit simbol
DELETE /api/legends/[id]/symbols/[sid]    Hapus simbol

POST   /api/detection/jobs             Buat & antri detection job
GET    /api/detection/jobs             List jobs (+ stats per job)
GET    /api/detection/jobs/[id]        Status + progress job
POST   /api/detection/jobs/[id]/run    Re-trigger job ke queue
POST   /api/detection/jobs/[id]/cancel Cancel job

GET    /api/detections                 List deteksi (filter: job_id, status, q, confidence)
GET    /api/detections/[id]            Detail deteksi
PUT    /api/detections/[id]            Edit deteksi
POST   /api/detections/[id]/confirm    Konfirmasi → masuk asset register
POST   /api/detections/[id]/reject     Tolak deteksi
POST   /api/detections/manual          Tambah aset manual

GET    /api/assets                     List asset register (filter + pagination)

GET    /api/export/assets              Download Asset_Register.xlsx
GET    /api/stats                      Dashboard statistics
```

---

## Database Schema

```
projects
  └── documents
        └── document_pages
        └── detection_jobs
              └── agent_runs
              └── detections ──→ assets

legends
  └── legend_symbols
```

Tabel utama:
- `projects` — container untuk dokumen dan job
- `legends` + `legend_symbols` — referensi simbol P&ID per organisasi/plant
- `documents` — file PDF yang diupload
- `document_pages` — metadata per halaman PDF
- `detection_jobs` — job antrian deteksi (PENDING → PROCESSING → COMPLETED/FAILED)
- `agent_runs` — log eksekusi AI per job (model, prompt version, durasi, error)
- `detections` — hasil deteksi AI per aset (dengan bbox, confidence, evidence)
- `assets` — aset yang sudah dikonfirmasi (final asset register)

---

## Cara Menjalankan

### 1. Prasyarat

- Node.js 20+
- Docker (untuk PostgreSQL + Redis)

### 2. Clone & Install

```bash
git clone <repo>
cd Asset-Detection
npm install
```

### 3. Setup Environment

```bash
cp .env.example .env
# Edit .env — isi DATABASE_URL dan GEMINI_API_KEY
```

### 4. Jalankan PostgreSQL + Redis

```bash
docker-compose up -d
```

### 5. Inisialisasi Database

```bash
# Jalankan SQL schema
psql postgresql://user:password@localhost:5432/asset_db -f sql/init.sql
```

### 6. Jalankan Detection Worker (proses background)

```bash
# Terminal terpisah
node -r ts-node/register workers/detection-worker.ts
```

> Worker memproses detection jobs dari antrian Redis secara background.

### 7. Jalankan Aplikasi

```bash
npm run dev
# Buka http://localhost:3000
```

---

## AI Provider

### Gemini (default)
- Set `AI_PROVIDER=gemini`
- Isi `GEMINI_API_KEY` dari [Google AI Studio](https://aistudio.google.com)
- Model: `gemini-2.0-flash`
- Mendukung analisis PDF langsung (multimodal)

### DeepSeek (fallback)
- Set `AI_PROVIDER=deepseek`
- Isi `DEEPSEEK_API_KEY`
- Tidak mendukung image/PDF langsung — menggunakan OCR text proxy

---

## Confidence Score

| Score | Label | Makna |
|-------|-------|-------|
| ≥ 95% | High | Deteksi sangat yakin |
| 80–94% | Medium | Perlu diverifikasi |
| < 80% | Review | Harus di-review manual |

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
├── app/                    Next.js App Router pages + API routes
│   ├── page.tsx            Dashboard
│   ├── detection/          Workspace deteksi utama
│   ├── review/             Batch review
│   ├── assets/             Asset Register
│   ├── documents/          Document management
│   ├── legends/            Legend library
│   ├── projects/           Project management
│   └── api/                REST API routes
├── components/ui/          Shared UI components
├── lib/
│   ├── ai-agent.ts         AI Agent runner (Gemini/DeepSeek)
│   ├── ai-prompt.ts        System prompt builder
│   ├── ai-schemas.ts       Zod schema validasi output AI
│   ├── db.ts               PostgreSQL pool
│   ├── excel-export.ts     ExcelJS workbook builder
│   ├── gemini.ts           Gemini + DeepSeek client
│   ├── pdf-render.ts       PDF validation + page extraction
│   ├── queue.ts            BullMQ queue
│   ├── spatial.ts          Tag-symbol spatial association
│   ├── storage.ts          File storage (local filesystem)
│   └── env.ts              Env validation (Zod)
├── workers/
│   └── detection-worker.ts Background job processor
├── sql/
│   └── init.sql            Database schema
├── docker-compose.yml      PostgreSQL + Redis
└── .env.example            Template environment variables
```
