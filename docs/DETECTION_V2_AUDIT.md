# DETECTION V2 — Audit Pipeline Existing (Revisi, Bukan Rewrite)

Tanggal: 2026-09-23 | Pipeline version baseline: `v1` | Dokumen revisi incremental.

> ## ⚠️ Status audit (diverifikasi ulang)
>
> Ini adalah **snapshot 2026-09-23** terhadap source saat itu. Sebagian item sudah
> selesai, sebagian masih terbuka, dan sebagian referensinya sudah tidak valid.
>
> **Sudah selesai sejak audit ini:**
> - `lib/detection/config.ts` (Fase 1) ✅
> - `lib/detection/geometry/coordinate-transform.ts` + test ✅
> - `lib/detection/geometry/bbox-validator.ts`, `spatial-association.ts`, `canonical-vision.ts` ✅
> - `lib/detection/persistence/detection-repository.ts` ✅
> - `lib/ai-prompt.ts` dihapus ✅
> - `sql/migrate-v2-detection-extensions.sql` ✅
> - `lib/detection/region/` — **menggantikan** `renderPageTiles()` yang direncanakan
> - Tuning terpusat lewat `lib/tuning.ts` — jawaban untuk B6, lebih lengkap dari
>   rencana "8 var V2" di §5
>
> **Referensi di dokumen ini yang tidak ada di repo:**
> - `lib/ocr-candidate.ts` — ❌ tidak ada
> - `autocad-bridge/` — ❌ tidak ada
> - `services/cv/` — ❌ tidak ada (dibatalkan, lihat plan)
> - `AI_MODE`, `CV_SERVICE_URL`, `TILE_SIZE`, `TILE_OVERLAP`,
>   `HIGH/LOW_CONFIDENCE_THRESHOLD`, `MAX_GEMINI_CALLS_PER_PAGE`,
>   `MAX_GEMINI_RETRY_PER_PAGE`, `PIPELINE_VERSION` — ❌ **tidak pernah ada di
>   `lib/env.ts`**. Yang benar-benar ada: `VERIFIER_MAX_CALLS_PER_PAGE`,
>   `VERIFIER_TIMEOUT_MS`, `VERIFIER_CACHE_MAX_ENTRIES`, `DEBUG_ARTIFACTS`.
>
> **Nilai yang sudah berubah:** `pipelineVersion` yang ditulis ke
> `detections.pipeline_version` adalah `gemini-vision-only`, bukan `v2.0.0`.
>
> Plan terkait: `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md`.
> Arsitektur target: `docs/DETECTION_V2_ARCHITECTURE.md`.

## 1. Pipeline Saat Ini (Terverifikasi dari Source)

```text
detectionQueue (BullMQ, concurrency 2)
  → workers/detection-worker.ts:41 processOnePage
    → renderPageToPng(buf, page, PDF_RENDER_SCALE=5.0)   [lib/pdf-render.ts:38, mupdf in-process]
    → runDetectionAgent({pageImageBase64, legendSymbols max 80, ocrText, pngWidth/Height})
        → runWithGemini | runWithDeepSeek                 [lib/ai-agent.ts:344/449]
        → validateDetection 10-step chain                 [lib/rule-validator.ts:267 CACHE→LEGEND→KB→EMBEDDING→RULES→ISA→ISO→VISION→UNKNOWN]
        → calibrateConfidence (penalty-based)             [lib/ai-agent.ts:503]
    → associateTagsToSymbols                              [lib/spatial.ts:51]
    → OCR F1/F2/F3 (extractTagTokens→rank→normalize→select) [workers/detection-worker.ts:254]
    → applyNMS (IoU 0.5, tag sama)                        [lib/spatial.ts:174]
    → INSERT detections (30 kolom) + audit trail (non-fatal)
  → Entity resolution (CANONICAL/DUPLICATE per tag)       [workers/detection-worker.ts:540]
```

## 2. Bottleneck Terukur

| # | Masalah | Lokasi | Dampak |
|---|---------|--------|--------|
| B1 | Gemini = satu-satunya candidate generator; tidak ada CV recall path | `lib/ai-agent.ts:116` Step1 Vision | Halaman padat → 0 deteksi; 429/quota → job FAILED (`detection-worker.ts:528`) |
| B2 | Bbox AI = final tanpa refinement geometris | `detection-worker.ts:439` persist langsung | Bbox bergeser, mencakup teks/line tetangga |
| B3 | Tag dibaca dari request Gemini yang sama dengan simbol | `symbol-detector.ts` + OCR pasif `pdf-render.ts:98` (structured text, bukan OCR piksel) | Tag kecil/rotated hilang; tidak ada PaddleOCR |
| B4 | Koordinat 0–1000 dinormalisasi tanpa dimensi halaman asli | `lib/ai-schemas.ts:8` `normalizeBBoxValues` (maxExtent heuristic) | Skala tidak konsisten antar halaman |
| B5 | Tidak ada tiling/multi-scale | — (tidak ada kode) | Simbol kecil hilang di full-page vision |
| B6 | Threshold tersebar di 8+ env var tanpa satu sumber config | `PDF_RENDER_SCALE, PAGE_BATCH_SIZE, NMS_IOU_THRESHOLD, NULL_FIELD_CONFIDENCE_THRESHOLD, EMBEDDING_SKIP_THRESHOLD, CONFIDENCE_THRESHOLD, FUSION_WEIGHTS_JSON, SPATIAL_MAX_PROXIMITY_JSON` | Sulit tuning, tidak ada benchmark loop |
| B7 | `processOnePage` 300 baris di dalam worker monolit 718 baris | `workers/detection-worker.ts:176` | Sulit test per-stage |

## 3. File: Tetap vs Revisi vs Hapus

### KEEP (jangan sentuh)
`lib/gemini.ts`, `lib/ai-config.ts`, `lib/queue.ts`, `lib/storage.ts`, `lib/rate-limit.ts`,
`lib/vector-repository.ts`, `lib/symbol-cache.ts`, `lib/knowledge-db.ts`,
`lib/excel-export.ts`, `app/review`, `app/assets`, `app/legends/**`, `sql/init.sql` (imutable baseline).

### REVISE (extract + tambah, bukan rewrite)
| File | Revisi |
|------|--------|
| `workers/detection-worker.ts` | Tipiskan → panggil `lib/detection/pipeline/*`; logic persist pindah ke `detection-repository.ts` |
| `lib/ai-agent.ts` | Tambah `AI_MODE` gate; `runWithGemini` dibungkus `verifier.ts` (ambiguous-only) |
| `lib/pdf-render.ts` | Tambah `renderPageTiles()`; `renderPageToPng` tetap |
| `lib/spatial.ts` | Keep API legacy; tambah `lib/detection/geometry/spatial-association.ts` scale-aware |
| `lib/confidence-fusion.ts` | Keep weights; tambah `confidence-engine.ts` dynamic |
| `lib/ai-schemas.ts` | `normalizeBBoxValues` panggil `coordinate-transform.ts` |
| `lib/env.ts` | Tambah 8 var V2 (lihat §5) |
| `lib/ocr-candidate.ts` | Keep; tambah `services/cv/tag_normalization.py` sisi Python |

### DELETE (terverifikasi via grep 2026-09-23)
| Target | Bukti | Status |
|--------|-------|--------|
| `lib/ai-prompt.ts` (`buildDetectionPrompt`) | `grep buildDetectionPrompt` → 1 hit (definisi saja); tidak ada import di `lib/`/`app/`/`workers/`; caller sudah pakai `lib/ai-prompts/symbol-detector.ts:16` | ✅ DIHAPUS di revisi ini |
| `lib/feature-extractor.ts` (Gemini vision features) | MASIH DIPAKAI (`ai-agent.ts:28,178`, `embedding-service.ts`) | ⛔ KEEP sampai Phase 5 benchmark buktikan CV deterministik lebih baik |
| `scripts/render-page.mjs` fallback | Dipakai `pdf-render.ts:61` saat import mupdf gagal (platform mismatch) | ⛔ KEEP sebagai fallback |
| `autocad-bridge/` | Out of scope V2 | ⛔ IGNORE, tidak dihapus |
| Konstanta tersebar (`MAX_LEGEND_PER_PAGE=80` inline dst.) | — | 🔁 PINDAH ke `lib/detection/config.ts` bertahap per fase |

## 4. Dependensi
Node-only saat ini. Python **belum ada** — `services/cv/` baru (Windows-native, FastAPI sidecar, Docker optional).
Tidak ada perubahan ke `package.json` di Fase 1 (kecuali dev tool bila perlu).

## 5. Env Baru V2 (ditambah ke `lib/env.ts`, semua ada default)
```
AI_MODE=disabled|assisted (default assisted)
CV_SERVICE_URL=http://127.0.0.1:8001
PIPELINE_VERSION=v2.0.0
TILE_SIZE=1280  TILE_OVERLAP=0.20
HIGH_CONFIDENCE_THRESHOLD=0.90  LOW_CONFIDENCE_THRESHOLD=0.70
MAX_GEMINI_CALLS_PER_PAGE=10  MAX_GEMINI_RETRY_PER_PAGE=2
DEBUG_ARTIFACTS=0
```
> Nilai threshold = engineering target awal, BUKAN final. Dikalibrasi di Fase 8 via benchmark.

## 6. Perubahan DB (additive saja, `IF NOT EXISTS`)
Fase 1: tidak ada migrasi DB. Migrasi mulai Fase 2 (`symbol_bbox_*`, `tag_bbox_*`, `page_width/height`,
`detection_method`, `deterministic_score`, `ai_*`) + Fase 8 (`ground_truth_*`, `benchmark_runs`).
