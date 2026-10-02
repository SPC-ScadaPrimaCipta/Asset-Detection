# Product Requirements Document (PRD)
## Gemini-First P&ID Asset Detection & Asset Register

| Informasi | Detail |
|---|---|
| Product Name | Asset Detection — AI P&ID Reader |
| Product Type | Web-Based Engineering Document Intelligence Platform |
| Version | 2.0 |
| Status | Draft |
| Primary AI Engine | Google Gemini API |
| Primary Input | Legend PDF dan P&ID PDF |
| Primary Output | Verified Asset Register |
| Target Users | Document Controller, Process Engineer, Instrument Engineer, Reviewer, Approver, Asset Manager |
| Frontend | Next.js / TypeScript |
| Backend | Next.js API Routes / TypeScript |
| Database | PostgreSQL |
| Job Processing | Redis Queue + Detection Worker |
| Deployment | Cloud, On-Premise, atau Hybrid |

---

## 1. Product Summary

Asset Detection adalah aplikasi berbasis AI untuk membaca dokumen **Piping and Instrumentation Diagram (P&ID)** dalam format PDF dan mengubahnya menjadi **Asset Register** yang terstruktur.

Produk menggunakan pendekatan **Gemini-first**, yaitu Google Gemini API sebagai mesin utama untuk memahami elemen visual dan teks dalam dokumen P&ID. Sistem tidak menggunakan OCR, OpenCV, ataupun YOLO sebagai sumber keputusan utama untuk ekstraksi aset dalam versi ini.

Sebelum sebuah P&ID diproses, user memilih **Legend Library** yang telah dihasilkan dari Legend PDF dan disetujui oleh engineer. Legend Library menjadi referensi untuk simbol, kategori aset, nama simbol, deskripsi, dan aturan tag prefix ketika Gemini menganalisis dokumen P&ID.

Hasil dari Gemini tidak langsung menjadi data resmi. Sistem menyimpannya sebagai **Draft Detection**, memvalidasinya melalui backend, lalu mengirimkannya ke Verification Workspace. Engineer melakukan review, koreksi, confirm, reject, dan approval. Hanya asset yang berstatus `approved` masuk ke Final Asset Register.

```text
Legend PDF
    │
    ▼
Gemini Legend Extraction
    │
    ▼
Approved Symbol Reference Library
    │
    ▼
P&ID PDF Upload
    │
    ▼
Gemini P&ID Asset Extraction
    │
    ▼
Backend Validation + Rule Engine
    │
    ▼
Verification Workspace
    │
    ▼
Approved Asset Register
    │
    ├── CSV Export
    ├── Excel Export
    ├── JSON Export
    └── API Integration
```

---

## 2. Problem Statement

P&ID umumnya tersimpan sebagai dokumen PDF engineering dengan banyak simbol, equipment tag, instrument tag, valve tag, garis proses, anotasi, dan tabel teknis. Informasi tersebut sering belum tersedia dalam bentuk Asset Register yang terstruktur, dapat dicari, dapat diaudit, serta dapat diintegrasikan ke sistem lain.

Pendekatan konvensional menggunakan OCR, OpenCV, dan YOLO sering menghasilkan akurasi rendah karena:

- Simbol P&ID berbeda antar perusahaan, proyek, vendor, dan engineering standard.
- Dokumen P&ID memiliki struktur visual yang kompleks dan padat.
- Simbol, teks, dan garis sering bertumpuk.
- Tag dapat memiliki ukuran kecil, orientasi berbeda, atau kualitas scan rendah.
- OCR sering salah membaca tag seperti `P-101A`, `PT-101`, `FT-101`, atau `FCV-101`.
- YOLO membutuhkan dataset berlabel dalam jumlah besar untuk setiap variasi simbol.
- Hubungan antara tag dan simbol tidak selalu berdasarkan jarak terdekat.
- Engineer masih harus membuat Asset Register secara manual.

Sistem ini menggunakan Gemini untuk memahami konteks visual dan teks P&ID secara bersamaan, lalu membatasi hasil deteksi menggunakan Legend Library yang telah disetujui.

---

## 3. Product Goals

### 3.1 Primary Goals

- Menggunakan Google Gemini sebagai engine utama pembacaan dokumen P&ID.
- Menggunakan Approved Legend Library sebagai referensi simbol.
- Memproses P&ID PDF secara per halaman.
- Mengekstrak equipment, valve, instrument, dan pipe fitting.
- Mengekstrak tag number yang terlihat pada P&ID.
- Menghasilkan data terstruktur dalam JSON.
- Memvalidasi output AI menggunakan backend rules.
- Menyediakan review workflow oleh engineer.
- Membentuk Final Asset Register dari hasil yang disetujui.
- Mendukung export CSV, Excel, dan JSON.

### 3.2 Success Metrics

| Metric | Target MVP |
|---|---:|
| Keberhasilan upload PDF | ≥ 99% |
| Keberhasilan respons Gemini sesuai JSON schema | ≥ 98% |
| Waktu analisis per halaman P&ID | ≤ 120 detik |
| Detection precision sebelum review | ≥ 75% |
| Tag-symbol matching accuracy sebelum review | ≥ 75% |
| Akurasi tag setelah review engineer | ≥ 95% |
| Akurasi klasifikasi aset setelah review engineer | ≥ 95% |
| Pengurangan waktu pembuatan Asset Register | ≥ 50% |
| Keberhasilan export Asset Register | ≥ 99% |
| Asset dengan source document dan page reference | 100% |

---

## 4. Non-Goals

MVP tidak mencakup:

- Menggantikan validasi atau keputusan engineering oleh engineer.
- Membuat atau memodifikasi desain P&ID secara otomatis.
- Perhitungan process engineering, process simulation, atau equipment sizing.
- Pengganti CAD software seperti AutoCAD Plant 3D, AVEVA, SmartPlant, atau Hexagon.
- Native parsing file DWG atau DXF.
- Jaminan akurasi 100% tanpa review manusia.
- Pembacaan pipe connectivity graph secara penuh.
- Analisis control loop kompleks.
- Integrasi langsung ke SAP, CMMS, EAM, atau ERP.
- Automatic revision comparison.
- Penghapusan permanen modul OCR, OpenCV, dan YOLO sebelum pipeline Gemini stabil.

---

## 5. Product Principles

### 5.1 Gemini as Primary Extractor

Gemini menjadi engine utama untuk:

- Memahami halaman P&ID sebagai dokumen engineering visual.
- Membaca tag equipment, instrument, dan valve.
- Mengidentifikasi simbol yang relevan.
- Menentukan kategori dan tipe aset.
- Memilih `symbol_code` dari Legend Library yang aktif.
- Memberikan confidence score dan alasan review.

### 5.2 Legend-First Detection

Setiap P&ID wajib terkait dengan satu Legend Library berstatus `approved`.

```text
P&ID Document
   └── Approved Legend Library
        └── Symbol References
             ├── Symbol Code
             ├── Symbol Name
             ├── Asset Category
             ├── Tag Prefix Rules
             └── Symbol Description
```

Gemini hanya boleh memberikan `symbol_code` yang tersedia dalam Approved Legend Library.

### 5.3 Human-in-the-Loop

Output Gemini adalah hasil draft. Engineer tetap menjadi pihak yang melakukan validasi dan approval akhir.

```text
Gemini Detection
    │
    ▼
Pending / Needs Review
    │
    ▼
Engineer Review
    │
    ▼
Confirmed
    │
    ▼
Approved
    │
    ▼
Final Asset Register
```

### 5.4 Evidence and Traceability

Setiap aset harus dapat ditelusuri kembali ke sumbernya.

```text
Asset Register Record
   └── Detection Record
        └── P&ID Document
             └── Document Revision
                  └── Page Number
                       └── Bounding Box / Source Position
                            └── Legend Library Version
```

### 5.5 No Hallucination

Gemini harus:

- Tidak membuat tag number yang tidak terlihat pada P&ID.
- Tidak menebak karakter yang tidak terbaca.
- Tidak menciptakan aset yang tidak memiliki bukti visual.
- Tidak menggunakan symbol code di luar Legend Library aktif.
- Menggunakan nilai `null` untuk data yang tidak terbaca.
- Menandai hasil ambigu sebagai `needs_review`.

---

## 6. User Roles

| Role | Description | Responsibilities |
|---|---|---|
| Admin | Pengelola aplikasi | User, role, settings, quota, model configuration |
| Document Controller | Pengelola dokumen | Upload Legend dan P&ID PDF, metadata, revision |
| Process Engineer | Engineer proses | Memverifikasi process equipment dan process asset |
| Instrument Engineer | Engineer instrumentasi | Memverifikasi instrument tag, valve, dan control device |
| Reviewer | Pemeriksa hasil AI | Edit, confirm, reject, dan unreview detection |
| Approver | Pemberi persetujuan akhir | Approval dokumen dan aset |
| Asset Manager | Pengelola Asset Register | Review data aset dan export |
| Viewer | Pengguna baca-saja | Melihat data sesuai project access |

---

## 7. Core Components

| Component | Input | Process | Output |
|---|---|---|---|
| Legend Management | Legend PDF | Gemini extraction dan manual review | Approved Symbol Reference Library |
| P&ID Document Management | P&ID PDF + metadata | Upload, storage, rendering, job creation | Detection Job |
| Gemini Extraction | P&ID page + legend context | Vision analysis dan structured JSON extraction | Draft asset candidates |
| Backend Validation | Gemini response + business rules | Schema, tag, category, bbox, duplicate validation | Validated detection |
| Detection Repository | Validated detection | Save detection, status, source, audit trail | Reviewable records |
| Verification Workspace | P&ID page + detections | Review, correction, confirm/reject | Approved/rejected assets |
| Asset Register | Approved assets | Consolidation and deduplication | Final Asset Register |
| Export Module | Asset Register | CSV, Excel, JSON generation | Export file/API payload |
| Evaluation Module | Ground truth + reviewed data | Accuracy measurement | Evaluation report |

---

## 8. End-to-End Workflow

### 8.1 Legend Preparation

```text
1. Document Controller mengunggah Legend PDF.
2. Sistem memproses Legend PDF menggunakan Gemini.
3. Sistem mengekstrak simbol, label, kategori, description, dan tag prefix.
4. Sistem menyimpan hasil menjadi Draft Legend Library.
5. Engineer memeriksa dan memperbaiki hasil.
6. Engineer menyetujui Legend Library.
7. Legend berstatus Approved dapat dipilih untuk proses P&ID.
```

### 8.2 P&ID Detection

```text
1. User memilih atau membuat project.
2. User mengunggah P&ID PDF.
3. User mengisi document number, title, area, unit, dan revision.
4. User memilih Approved Legend Library.
5. Sistem membuat Detection Job.
6. Detection Worker merender PDF per halaman.
7. Worker memuat symbol context dari Legend Library.
8. Worker mengirim halaman P&ID dan legend context ke Gemini.
9. Gemini mengembalikan hasil extraction dalam JSON.
10. Backend memvalidasi output Gemini.
11. Sistem menyimpan hasil sebagai Pending atau Needs Review.
12. User membuka Verification Workspace.
```

### 8.3 Verification and Approval

```text
1. Reviewer membuka P&ID document pada halaman Review.
2. Sistem menampilkan page dengan overlay hasil Gemini.
3. Reviewer memeriksa tag, symbol, category, confidence, dan validation result.
4. Reviewer mengedit hasil bila diperlukan.
5. Reviewer dapat confirm, reject, unreview, atau membuat manual detection.
6. Sistem mencatat semua perubahan ke audit log.
7. Approver menyetujui hasil akhir.
8. Detection yang Approved masuk ke Asset Register.
```

### 8.4 Asset Register Generation

```text
1. Sistem mengambil seluruh detection dengan status Approved.
2. Sistem memeriksa duplicate tag.
3. Sistem membentuk Asset Register.
4. Asset Manager melakukan pencarian, filter, dan review data.
5. User mengekspor Asset Register sebagai CSV, Excel, atau JSON.
```

---

## 9. Functional Requirements

### 9.1 Legend Management

| ID | Requirement | Priority |
|---|---|---|
| FR-LEG-001 | User dapat mengunggah Legend dalam format PDF | Must Have |
| FR-LEG-002 | Sistem mendukung Legend PDF multi-page | Must Have |
| FR-LEG-003 | Sistem menyimpan nama, project, standard, dan version Legend | Must Have |
| FR-LEG-004 | Sistem membentuk Symbol Reference Library | Must Have |
| FR-LEG-005 | User dapat mengubah nama, symbol code, category, description, dan tag prefix | Must Have |
| FR-LEG-006 | User dapat menambah atau menghapus symbol reference secara manual | Must Have |
| FR-LEG-007 | Legend memiliki status Draft, Reviewed, Approved, Archived | Must Have |
| FR-LEG-008 | Hanya Legend berstatus Approved yang dapat dipakai pada P&ID detection | Must Have |
| FR-LEG-009 | Sistem menyimpan history perubahan Legend | Should Have |
| FR-LEG-010 | Sistem menyimpan crop/reference image setiap symbol | Must Have |

### 9.2 P&ID Document Management

| ID | Requirement | Priority |
|---|---|---|
| FR-PID-001 | User dapat mengunggah P&ID dalam format PDF | Must Have |
| FR-PID-002 | Sistem mendukung P&ID PDF multi-page | Must Have |
| FR-PID-003 | User wajib memilih Approved Legend Library | Must Have |
| FR-PID-004 | User mengisi document number, title, project, area, unit, dan revision | Must Have |
| FR-PID-005 | Sistem menyimpan file P&ID PDF asli | Must Have |
| FR-PID-006 | Sistem menyimpan hasil render per halaman | Must Have |
| FR-PID-007 | Sistem menampilkan status Uploaded, Queued, Processing, Completed, Under Review, Approved, Failed | Must Have |
| FR-PID-008 | User dapat melakukan retry processing dokumen atau halaman tertentu | Should Have |
| FR-PID-009 | Sistem menyimpan pesan error jika job gagal | Must Have |

### 9.3 Gemini Extraction

| ID | Requirement | Priority |
|---|---|---|
| FR-GEM-001 | Sistem menggunakan Gemini sebagai engine utama P&ID extraction | Must Have |
| FR-GEM-002 | Sistem mengirim context Approved Symbol Reference Library | Must Have |
| FR-GEM-003 | P&ID diproses per halaman | Must Have |
| FR-GEM-004 | Gemini menghasilkan structured JSON sesuai schema | Must Have |
| FR-GEM-005 | Gemini mengekstrak tag number yang terlihat | Must Have |
| FR-GEM-006 | Gemini hanya memilih symbol code dari Legend Library aktif | Must Have |
| FR-GEM-007 | Gemini menentukan asset category dan asset type | Must Have |
| FR-GEM-008 | Gemini memberikan confidence score untuk symbol, tag, matching, dan overall result | Must Have |
| FR-GEM-009 | Gemini memberikan review flag dan review reason | Must Have |
| FR-GEM-010 | Gemini memberikan page number untuk setiap asset | Must Have |
| FR-GEM-011 | Gemini memberikan normalized bounding box jika posisi jelas | Should Have |
| FR-GEM-012 | Sistem menyimpan Gemini model name dan prompt version | Must Have |
| FR-GEM-013 | Sistem menyimpan raw AI response untuk audit | Should Have |

### 9.4 Backend Validation

| ID | Requirement | Priority |
|---|---|---|
| FR-VAL-001 | Sistem memvalidasi output Gemini dengan schema | Must Have |
| FR-VAL-002 | Symbol code harus tersedia dalam Legend Library aktif | Must Have |
| FR-VAL-003 | Asset category harus sesuai dengan symbol reference | Must Have |
| FR-VAL-004 | Tag number divalidasi menggunakan configured regex | Must Have |
| FR-VAL-005 | Tag prefix divalidasi terhadap allowed prefixes | Must Have |
| FR-VAL-006 | Bounding box divalidasi terhadap batas halaman | Should Have |
| FR-VAL-007 | Confidence rendah ditandai sebagai needs_review | Must Have |
| FR-VAL-008 | Tag kosong atau tidak terbaca ditandai sebagai needs_review | Must Have |
| FR-VAL-009 | Sistem mendeteksi duplicate tag pada page, document, dan project | Must Have |
| FR-VAL-010 | Sistem menyimpan validation reasons | Must Have |
| FR-VAL-011 | Sistem tidak mengubah hasil Gemini langsung menjadi approved | Must Have |

### 9.5 Detection Status Workflow

| Status | Description | Allowed Actions |
|---|---|---|
| `pending` | Hasil Gemini valid secara teknis, belum direview | Edit, confirm, reject |
| `needs_review` | Hasil ambigu, confidence rendah, tag invalid, atau duplicate | Edit, confirm, reject |
| `confirmed` | Sudah diperiksa oleh Reviewer | Submit approval, edit, unreview |
| `approved` | Sudah disetujui oleh Approver | Export, masuk Asset Register |
| `rejected` | False detection atau data tidak valid | Unreview sesuai permission |
| `manual` | Dibuat manual oleh user | Confirm, approve, reject |

### 9.6 Verification Workspace

| ID | Requirement | Priority |
|---|---|---|
| FR-REV-001 | Sistem menampilkan P&ID page dengan overlay detection | Must Have |
| FR-REV-002 | User dapat zoom, pan, fit-to-screen, dan berpindah halaman | Must Have |
| FR-REV-003 | User dapat memilih detection pada canvas atau data table | Must Have |
| FR-REV-004 | User dapat melihat tag, symbol, category, confidence, validation reason, dan source | Must Have |
| FR-REV-005 | User dapat mengubah tag, name, type, category, dan symbol reference | Must Have |
| FR-REV-006 | User dapat memperbaiki bounding box | Should Have |
| FR-REV-007 | User dapat confirm detection | Must Have |
| FR-REV-008 | User dapat reject detection | Must Have |
| FR-REV-009 | User dapat unreview detection sesuai permission | Must Have |
| FR-REV-010 | User dapat menambah manual detection | Must Have |
| FR-REV-011 | User dapat filter berdasarkan page, category, confidence, status, dan duplicate flag | Must Have |
| FR-REV-012 | Semua action review disimpan dalam audit log | Must Have |

### 9.7 Asset Register

| ID | Requirement | Priority |
|---|---|---|
| FR-REG-001 | Hanya detection Approved yang masuk ke Asset Register final | Must Have |
| FR-REG-002 | Asset Register menyimpan tag, asset name, type, category, dan symbol code | Must Have |
| FR-REG-003 | Asset Register menyimpan project, document number, revision, dan page number | Must Have |
| FR-REG-004 | Asset Register menyimpan legend dan symbol reference asalnya | Must Have |
| FR-REG-005 | Asset Register menyimpan confidence dan verification status | Must Have |
| FR-REG-006 | User dapat mencari dan filter Asset Register | Must Have |
| FR-REG-007 | Duplicate tag ditandai pada Asset Register | Must Have |
| FR-REG-008 | User dapat menambah metadata asset tambahan | Should Have |
| FR-REG-009 | User dapat export ke CSV | Must Have |
| FR-REG-010 | User dapat export ke Excel | Should Have |
| FR-REG-011 | User dapat mengambil data melalui JSON/REST API | Should Have |

### 9.8 Job Processing

| ID | Requirement | Priority |
|---|---|---|
| FR-JOB-001 | Detection berjalan asynchronous menggunakan queue | Must Have |
| FR-JOB-002 | Job menyimpan status, progress, total page, current page, dan error | Must Have |
| FR-JOB-003 | Worker memproses P&ID per halaman | Must Have |
| FR-JOB-004 | User dapat melihat progress detection | Must Have |
| FR-JOB-005 | User dapat membatalkan job | Should Have |
| FR-JOB-006 | User dapat menjalankan ulang job gagal | Must Have |
| FR-JOB-007 | Retry tidak boleh membuat duplicate detection | Must Have |
| FR-JOB-008 | Sistem menerapkan rate limit Gemini API | Must Have |
| FR-JOB-009 | Sistem mencatat model, prompt version, request time, dan response status | Must Have |

---

## 10. Gemini Prompt Requirements

### 10.1 Required Prompt Rules

Prompt harus menginstruksikan Gemini untuk:

- Menganalisis satu halaman P&ID per request.
- Menggunakan hanya informasi yang terlihat pada halaman.
- Menggunakan hanya symbol code dari Legend Library aktif.
- Tidak menebak tag number yang tidak terbaca.
- Menggunakan nilai `null` untuk data yang tidak jelas.
- Tidak menganggap title block, notes, dimensions, table, process line, atau arrow sebagai asset.
- Menandai hasil ambigu dengan `review_required: true`.
- Mengembalikan JSON saja tanpa Markdown.

### 10.2 Gemini P&ID Extraction Prompt

```text
You are a Piping and Instrumentation Diagram (P&ID) asset extraction system.

Analyze exactly one attached P&ID page using the approved Symbol Reference Library supplied below.

Identify each distinct visible process equipment, valve, instrument, or pipe fitting that matches an approved symbol in the supplied library.

For every detected asset:
- Read the visible tag number exactly as written.
- Select symbol_code only from the supplied Symbol Reference Library.
- Return asset_name, asset_type, and asset_category.
- Return page_number.
- Return bounding_box_1000 when the object position is visually clear.
- Provide symbol_confidence, tag_confidence, matching_confidence, and overall_confidence between 0 and 1.
- Set review_required to true when tag reading, symbol classification, or tag-symbol matching is uncertain.
- Use null for unreadable values. Never guess missing tag characters.

Strict rules:
- Use only visible information from the attached P&ID page.
- Do not invent assets, symbols, descriptions, or tag numbers.
- Do not use symbol codes outside the supplied library.
- Do not extract title blocks, notes, dimensions, arrows, process lines, or tables as assets.
- Return valid JSON only according to the supplied response schema.
```

---

## 11. AI Response Schema

```json
{
  "document_number": "P-ID-WTP-001",
  "document_title": "Raw Water Transfer System",
  "page_number": 1,
  "assets": [
    {
      "page_number": 1,
      "tag_number": "P-101A",
      "symbol_code": "PUMP_CENTRIFUGAL",
      "asset_name": "Centrifugal Pump",
      "asset_type": "Pump",
      "asset_category": "Equipment",
      "visible_description": "Transfer Pump A",
      "bounding_box_1000": {
        "x": 278,
        "y": 432,
        "width": 82,
        "height": 74
      },
      "symbol_confidence": 0.93,
      "tag_confidence": 0.91,
      "matching_confidence": 0.88,
      "overall_confidence": 0.9,
      "review_required": false,
      "review_reason": null,
      "duplicate_tag_warning": false
    }
  ]
}
```

### 11.1 Required Asset Fields

| Field | Type | Description |
|---|---|---|
| `page_number` | Integer | Halaman P&ID sumber |
| `tag_number` | String/null | Tag yang terlihat |
| `symbol_code` | String/null | Symbol code dari Legend Library |
| `asset_name` | String | Nama aset |
| `asset_type` | String | Tipe aset |
| `asset_category` | Enum | Equipment, Valve, Instrument, Pipe Fitting, Other |
| `visible_description` | String/null | Keterangan yang terlihat |
| `bounding_box_1000` | Object/null | Posisi aset pada skala 0–1000 |
| `symbol_confidence` | Number | Confidence klasifikasi simbol |
| `tag_confidence` | Number | Confidence pembacaan tag |
| `matching_confidence` | Number | Confidence hubungan symbol dan tag |
| `overall_confidence` | Number | Confidence keseluruhan |
| `review_required` | Boolean | Penanda hasil perlu review |
| `review_reason` | String/null | Alasan review |
| `duplicate_tag_warning` | Boolean | Penanda kemungkinan duplicate tag |

---

## 12. Validation Rules

### 12.1 Validation Flow

```text
Gemini JSON Response
        │
        ▼
Schema Validation
        │
        ▼
Legend Symbol Validation
        │
        ▼
Asset Category Validation
        │
        ▼
Tag Regex and Prefix Validation
        │
        ▼
Bounding Box Validation
        │
        ▼
Duplicate Tag Validation
        │
        ▼
Confidence Validation
        │
        ▼
Save as Pending or Needs Review
```

### 12.2 Validation Rules

| Rule ID | Rule | Result if Failed |
|---|---|---|
| VR-001 | Gemini response harus sesuai schema | Response ditolak atau job di-retry |
| VR-002 | Symbol code harus ada di Legend Library aktif | `needs_review` |
| VR-003 | Asset category harus sesuai dengan symbol reference | `needs_review` |
| VR-004 | Tag harus memenuhi regex jika tidak null | `needs_review` |
| VR-005 | Tag prefix harus sesuai allowed prefixes jika tersedia | `needs_review` |
| VR-006 | Overall confidence kurang dari 0.80 | `needs_review` |
| VR-007 | `review_required = true` | `needs_review` |
| VR-008 | Tag null atau unreadable | `needs_review` |
| VR-009 | Duplicate tag warning true | `needs_review` |
| VR-010 | BBox di luar ukuran halaman | BBox dihapus dan item `needs_review` |
| VR-011 | Tidak ada tag dan symbol code | Detection ditolak atau `needs_review` |
| VR-012 | Page number tidak sesuai page yang diproses | Response ditolak |

### 12.3 Confidence Threshold

| Level | Range | Status Default |
|---|---:|---|
| High Confidence | ≥ 0.90 | `pending` |
| Medium Confidence | 0.80–0.89 | `pending` |
| Low Confidence | < 0.80 | `needs_review` |
| Tag Unreadable | N/A | `needs_review` |
| Symbol Unknown | N/A | `needs_review` |
| Duplicate Tag | N/A | `needs_review` |

---

## 13. System Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend                          │
│ Dashboard | Legends | Documents | Detection | Review | Register   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Next.js API Routes                          │
│ Upload | Jobs | Detections | Legends | Assets | Export | Settings │
└───────────────┬───────────────────────┬──────────────────────────┘
                │                       │
                ▼                       ▼
┌─────────────────────────┐   ┌───────────────────────────────────┐
│ PostgreSQL               │   │ Redis Queue                       │
│ Projects                 │   │ Detection Jobs                    │
│ Legends                  │   │ Retry / Cancel / Progress         │
│ Symbols                  │   └───────────────┬───────────────────┘
│ Documents                │                   │
│ Detections               │                   ▼
│ Assets                   │   ┌───────────────────────────────────┐
│ Audit Logs               │   │ Detection Worker                  │
└─────────────────────────┘   │ Render PDF Page                   │
                              │ Load Legend Context               │
                              │ Call Gemini                       │
                              │ Validate Result                   │
                              │ Save Detection + Audit            │
                              └───────────────┬───────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────────────┐
                              │ Google Gemini API                 │
                              │ Vision + Structured JSON Output   │
                              └───────────────────────────────────┘
```

---

## 14. Existing Project Mapping

| Existing File or Directory | Responsibility in Gemini-First Flow |
|---|---|
| `lib/gemini.ts` | Gemini client dan API request |
| `lib/ai-config.ts` | Model, temperature, quota, dan AI configuration |
| `lib/ai-agent.ts` | AI orchestration utility bila diperlukan |
| `lib/ai-prompts/legend-extractor.ts` | Existing Legend extraction prompt |
| `lib/ai-prompts/symbol-detector.ts` | Dapat direfactor untuk Gemini P&ID extraction |
| `lib/ai-prompts/pid-asset-extractor.ts` | File baru untuk prompt P&ID extraction |
| `lib/ai-schemas.ts` | Shared schema AI output |
| `lib/legend-extract.ts` | Existing Legend extraction service |
| `lib/detection/legend/` | Legend model dan symbol class |
| `lib/detection/ai/` | Gemini P&ID extractor dan AI validation |
| `lib/detection/geometry/` | Validasi bbox dan coordinate transformation |
| `lib/detection/persistence/detection-repository.ts` | Simpan detection, status, dan source metadata |
| `lib/rule-engine.ts` | Validasi tag, category, prefix, dan business rule |
| `lib/confidence-fusion.ts` | Menggabungkan AI score dan backend validation score |
| `lib/pdf-render.ts` | Render P&ID page untuk Gemini dan UI viewer |
| `lib/queue.ts` | Queue detection job |
| `workers/detection-worker.ts` | Orchestrator Gemini extraction per page |
| `app/api/detection/jobs/` | API create, monitor, retry, cancel detection jobs |
| `app/api/detections/` | API confirm, reject, bulk operation, dan manual detection |
| `app/review/page.tsx` | Verification Workspace |
| `app/asset-register/page.tsx` | Final Asset Register UI |
| `app/api/export/assets/route.ts` | Export approved asset records |
| `lib/detection-audit.ts` | Audit AI request, result, review, dan approval |
| `__tests__/` | Test schema, prompt, validation, worker, dan workflow |

---

## 15. Database Requirements

### 15.1 Required Detection Fields

```text
detection_id
project_id
document_id
legend_id
legend_symbol_id
page_number
tag_number
asset_name
asset_type
asset_category
symbol_code
bounding_box
symbol_confidence
tag_confidence
matching_confidence
overall_confidence
verification_status
validation_reasons
source
model_name
prompt_version
raw_ai_response
created_at
updated_at
reviewed_by
approved_by
```

### 15.2 AI Provenance Fields

| Field | Purpose |
|---|---|
| `source` | Sumber deteksi: `gemini`, `manual`, atau source lain |
| `model_name` | Nama Gemini model |
| `prompt_version` | Versi prompt yang digunakan |
| `raw_ai_response` | Respons asli Gemini |
| `validation_reasons` | Alasan status `needs_review` |
| `legend_id` | Legend aktif saat detection |
| `legend_symbol_id` | Symbol Reference terkait |
| `document_revision` | Revisi P&ID sumber |
| `page_number` | Halaman sumber aset |
| `bounding_box` | Posisi untuk overlay dan audit |
| `reviewed_by` | Reviewer yang melakukan pemeriksaan |
| `approved_by` | Approver yang memberi persetujuan |

### 15.3 Migration Requirement

Tambahkan migration berikut:

```text
sql/migrate-009-gemini-detection-provenance.sql
```

```sql
ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS symbol_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS tag_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS matching_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS overall_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS validation_reasons JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_ai_response JSONB,
  ADD COLUMN IF NOT EXISTS bbox_1000 JSONB;
```

---

## 16. UI Requirements

### 16.1 Main Pages

| Page | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Statistik project, documents, detections, review, dan assets |
| Projects | `/projects` | Project management |
| Legends | `/legends` | Legend upload, review, approval, dan versioning |
| Legend Detail | `/legends/[id]` | Detail Symbol Library |
| Legend Review | `/legends/[id]/review` | Review symbol, category, tag prefix, dan crop |
| Documents | `/documents` | Daftar P&ID PDF dan status job |
| Detection | `/detection` | Membuat dan memantau detection job |
| Review | `/review` | Verifikasi hasil Gemini |
| Assets | `/assets` | Asset list dan metadata |
| Asset Register | `/asset-register` | Asset final yang dapat diekspor |
| Settings | `/settings` | Model Gemini, quota, rules, dan application settings |

### 16.2 Verification Workspace Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ P&ID: P-ID-WTP-001 | Rev.02 | Legend: WTP Legend Rev.02 | Under Review    │
├───────────────────┬──────────────────────────────────┬─────────────────────┤
│ Filters           │ P&ID Viewer                       │ Detection Detail    │
│                   │                                  │                     │
│ □ Equipment       │      [ Zoomable P&ID Page ]       │ Tag: P-101A         │
│ □ Valve           │      [ Gemini BBox Overlay ]      │ Type: Pump          │
│ □ Instrument      │      [ Detection Marker ]         │ Symbol: PUMP_...    │
│ □ Pending         │                                  │ AI Score: 0.90      │
│ □ Needs Review    │                                  │ Validation: Valid   │
│ □ Duplicate Tag   │                                  │                     │
│                   │                                  │ [Edit] [Confirm]    │
│                   │                                  │ [Reject] [Manual]   │
├───────────────────┴──────────────────────────────────┴─────────────────────┤
│ Asset List | Search | Page | Save | Submit Approval | Job Progress          │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 17. Asset Register Output

### 17.1 Required Columns

| Column | Description | Example |
|---|---|---|
| Asset ID | Unique internal ID | `AST-000001` |
| Tag Number | Tag dari P&ID | `P-101A` |
| Asset Name | Nama aset | `Centrifugal Pump` |
| Asset Type | Tipe aset | `Pump` |
| Asset Category | Kategori aset | `Equipment` |
| Symbol Code | Reference symbol code | `PUMP_CENTRIFUGAL` |
| Project | Nama project | `Water Treatment Plant` |
| Area | Area plant | `Raw Water Intake` |
| Document Number | Nomor P&ID | `P-ID-WTP-001` |
| Document Revision | Revisi P&ID | `Rev.02` |
| Page Number | Halaman sumber | `1` |
| Legend Name | Nama Legend Library | `WTP P&ID Legend` |
| Legend Version | Revisi Legend | `Rev.02` |
| Overall Confidence | Confidence Gemini | `0.90` |
| Verification Status | Status review | `Approved` |
| Detection Source | Asal detection | `gemini` |
| Reviewed By | Reviewer | `engineer@company.com` |
| Approved By | Approver | `lead.engineer@company.com` |
| Approved At | Waktu approval | `2026-09-30T20:00:00Z` |

### 17.2 Example CSV

```csv
asset_id,tag_number,asset_name,asset_type,asset_category,symbol_code,project,area,document_number,document_revision,page_number,legend_name,overall_confidence,verification_status,detection_source
AST-000001,P-101A,Centrifugal Pump,Pump,Equipment,PUMP_CENTRIFUGAL,Water Treatment Plant,Raw Water Intake,P-ID-WTP-001,Rev.02,1,WTP P&ID Legend,0.90,Approved,gemini
AST-000002,FT-101,Flow Transmitter,Flow Transmitter,Instrument,FLOW_TRANSMITTER,Water Treatment Plant,Raw Water Intake,P-ID-WTP-001,Rev.02,1,WTP P&ID Legend,0.88,Approved,gemini
AST-000003,FCV-101,Flow Control Valve,Control Valve,Valve,FLOW_CONTROL_VALVE,Water Treatment Plant,Raw Water Intake,P-ID-WTP-001,Rev.02,1,WTP P&ID Legend,0.87,Approved,gemini
```

---

## 18. Non-Functional Requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-001 | Performance | Satu halaman P&ID dianalisis maksimal 120 detik |
| NFR-002 | Scalability | Processing menggunakan asynchronous queue |
| NFR-003 | Reliability | Job gagal menyimpan error dan dapat di-retry |
| NFR-004 | Data Integrity | Retry tidak membuat duplicate detection |
| NFR-005 | Security | File PDF dan AI response dibatasi berdasarkan project access |
| NFR-006 | Privacy | Mendukung opsi deployment cloud, hybrid, atau on-premise |
| NFR-007 | Auditability | Upload, detection, edit, review, approval, dan export dicatat |
| NFR-008 | Usability | Reviewer dapat review tanpa mengubah PDF asli |
| NFR-009 | Maintainability | Model dan prompt dapat diganti melalui config layer |
| NFR-010 | Observability | Menyediakan job log, error log, audit trail, dan request status |
| NFR-011 | Cost Control | Memiliki quota, rate limit, dan monitoring usage Gemini |
| NFR-012 | Compatibility | Mendukung browser modern |

---

## 19. Error Handling

| Scenario | Expected Behaviour |
|---|---|
| File bukan PDF | Sistem menolak upload dengan pesan validasi |
| PDF tidak bisa dirender | Status dokumen `Failed` dan error reason disimpan |
| Legend belum Approved | User tidak dapat menjalankan P&ID detection |
| Gemini request gagal | Worker retry sesuai konfigurasi dan menyimpan error |
| Gemini memberi JSON invalid | Response ditolak, page/job di-retry atau ditandai gagal |
| Symbol code tidak ada di legend | Detection menjadi `needs_review` |
| Tag tidak terbaca | `tag_number = null`, status `needs_review` |
| Bounding box invalid | BBox dibuang, detection tetap tersimpan sebagai `needs_review` |
| Retry page | Hasil lama diarsipkan atau diganti tanpa duplikasi |
| Tidak ada asset approved | Asset Register menampilkan empty state dan export diblokir/diinformasikan |

---

## 20. Testing Requirements

### 20.1 New Test Files

```text
__tests__/
├── gemini-pid-extraction-schema.test.ts
├── gemini-pid-prompt.test.ts
├── gemini-result-validator.test.ts
├── gemini-bbox-transform.test.ts
├── gemini-detection-worker.test.ts
├── gemini-duplicate-tag.test.ts
└── asset-register-approved-only.test.ts
```

### 20.2 Required Test Cases

| Test Area | Test Case |
|---|---|
| AI Schema | Output tanpa field wajib harus ditolak |
| Symbol Validation | Symbol code di luar Legend Library menjadi `needs_review` |
| Tag Validation | Tag tidak sesuai regex menjadi `needs_review` |
| Prefix Validation | `PT-101` tidak valid jika dipasangkan dengan Pump |
| Confidence | Overall score `< 0.80` menjadi `needs_review` |
| Bounding Box | BBox di luar rentang 0–1000 tidak merusak viewer |
| Duplicate Tag | Tag sama ditandai pada scope page, document, atau project |
| Retry | Re-run page tidak membuat record duplicate |
| Review Flow | Confirm, reject, unreview menghasilkan audit log |
| Asset Register | Hanya record `approved` tampil dan dapat diekspor |
| Prompt Context | Gemini hanya dapat memilih symbol code dari library yang dikirim |
| Failure Handling | JSON invalid dapat di-retry dan error disimpan |

---

## 21. MVP Scope

### Included

- Approved Legend Library.
- Upload P&ID PDF multi-page.
- Pemilihan Legend Library.
- Render PDF per halaman.
- Gemini extraction per halaman.
- Structured JSON schema.
- Backend validation.
- Detection queue, progress, retry, dan cancel.
- Review Workspace.
- Confirm, reject, unreview, dan manual detection.
- Approved Asset Register.
- Export CSV.
- Audit log dan AI provenance.

### Excluded

- Full pipe connectivity extraction.
- Control loop analysis.
- Native DWG/DXF parsing.
- SAP, CMMS, EAM, atau ERP integration.
- Automatic revision comparison.
- Automatic engineering compliance checking.
- Mobile application.
- Fine-tuning Gemini.
- Custom Excel template yang kompleks.

---

## 22. Implementation Plan

### Phase 1 — Gemini Extraction Foundation

- Buat schema P&ID asset extraction.
- Buat `pid-asset-extractor.ts`.
- Buat Gemini extraction service.
- Gunakan `application/json` response.
- Gunakan strict response schema.
- Tambahkan model name dan prompt version.

### Phase 2 — Detection Worker Integration

- Refactor `workers/detection-worker.ts`.
- Render P&ID PDF per halaman.
- Load Approved Legend Library.
- Kirim page image dan legend context ke Gemini.
- Simpan raw result dan draft detections.

### Phase 3 — Validation and Persistence

- Tambahkan Gemini result validator.
- Validasi schema, tag, symbol code, category, bbox, dan duplicate.
- Refactor confidence fusion.
- Tambahkan migration provenance Gemini.
- Simpan validation reasons.

### Phase 4 — Review and Asset Register

- Hubungkan result Gemini ke halaman `/review`.
- Tampilkan detection overlay dan source detail.
- Implement confirm/reject/manual detection workflow.
- Pastikan Asset Register hanya menggunakan approved detection.
- Implement CSV export.

### Phase 5 — Evaluation and Improvement

- Bentuk ground truth dari P&ID yang direview engineer.
- Bandingkan output Gemini dengan ground truth.
- Hitung precision, recall, tag accuracy, dan correction rate.
- Perbaiki prompt, legend context, validation threshold, dan rule engine.
- Tambahkan semantic search atau embedding jika diperlukan.

---

## 23. Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Gemini salah membaca tag kecil | Tag asset tidak akurat | `null`, confidence, review reason, dan review engineer |
| Gemini menghasilkan asset yang tidak ada | False positive | Strict prompt, allowed symbol code, backend validation, approval workflow |
| Gemini melewatkan asset | False negative | Per-page processing, retry, manual detection, evaluation dataset |
| Legend tidak lengkap | Salah klasifikasi | Legend review, approval, versioning |
| P&ID sangat padat | Hasil kurang stabil | High-resolution render, per-page processing, retry strategy |
| API quota atau cost tinggi | Pengeluaran meningkat | Rate limit, queue, quota, monitoring, dan caching |
| Dokumen rahasia | Risiko data exposure | RBAC, audit log, encryption, retention policy, deployment option |
| User terlalu percaya AI | Risiko engineering | Approval mandatory dan disclaimer |
| Raw AI response besar | Storage bertambah | Retention policy dan archival strategy |
| Gemini model berubah | Output tidak konsisten | Model resolver, prompt versioning, regression test |

---

## 24. Definition of Done

Fitur Gemini-First P&ID Asset Detection dianggap selesai apabila:

- User dapat memilih Legend Library berstatus `Approved`.
- User dapat mengunggah P&ID PDF multi-page.
- Sistem membuat detection job asynchronous.
- Worker dapat memproses P&ID per halaman.
- Worker mengirim halaman dan legend context ke Gemini.
- Gemini menghasilkan output JSON yang tervalidasi schema.
- Backend memvalidasi tag, symbol, category, confidence, duplicate, dan bbox.
- Setiap detection memiliki page number, source, model name, prompt version, confidence, dan validation result.
- Hasil ambigu otomatis menjadi `needs_review`.
- Reviewer dapat edit, confirm, reject, unreview, dan menambah manual detection.
- Approver dapat menyetujui hasil.
- Hanya detection `approved` masuk ke Asset Register.
- Asset Register dapat diekspor setidaknya sebagai CSV.
- Retry halaman tidak menciptakan duplicate detection.
- Semua aktivitas penting tercatat di audit log.
- Unit test dan integration test utama lulus.
- Tidak ada bug kritis pada flow upload → detection → review → approval → export.