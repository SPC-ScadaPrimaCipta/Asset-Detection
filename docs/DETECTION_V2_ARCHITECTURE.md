# DETECTION V2 — Arsitektur Hybrid (Revisi Incremental)

> ## ⚠️ Status: RENCANA, bukan kondisi saat ini
>
> Dokumen ini adalah **desain target** untuk pendekatan hybrid
> (CV deterministik + OCR + Gemini verifier). Hampir seluruhnya **belum
> diimplementasikan**. Yang benar-benar berjalan hari ini adalah
> **Gemini Vision 100%** — persis seperti Scan Legend.
>
> Jangan mencari file di bawah ini di repo: **`services/cv/` tidak pernah
> dibuat** (direktori `services/` tidak ada sama sekali), dan konsekuensinya
> tidak ada OpenCV, tidak ada PaddleOCR, tidak ada Tesseract, tidak ada YOLO,
> tidak ada Python di stack.
>
> Yang **sudah ada** (lihat §2): `lib/detection/geometry/`,
> `lib/detection/ai/verifier.ts`, `lib/detection/legend/`,
> `lib/detection/persistence/detection-repository.ts`, `lib/detection/region/`,
> `sql/migrate-v2-detection-extensions.sql`.
>
> Pipeline version yang benar-benar ditulis ke `detections.pipeline_version`
> adalah **`gemini-vision-only`** (`lib/detection/config.ts`) — bukan `v2.0.0`.
>
> Status per fase: `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md`.
> Necessity/urgency: `docs/PRD.md` §4 (Non-Goals) dan `eval/README.md`.

> Prinsip: **Deterministic menemukan bukti. Legend mendefinisikan validitas.
> Geometri memvalidasi. OCR membaca tag. Gemini menyelesaikan ambiguitas.
> Human Review otoritas final.**

## 1. Arsitektur Target

```text
                     ┌──────────────┐
                     │Legend Library│  legends + legend_symbols (+ templates Fase 5)
                     └──────┬───────┘
                            │
PDF → Renderer (mupdf, +tiles Fase 3) → Preprocessor (Python CV)   ← BELUM ADA
      ├─ TextDetection → OCR (PaddleOCR, Fase 4) → TagNormalization   ← BELUM ADA
      └─ ShapeDetection → CV Candidates (contours/CC, Fase 3) → LegendMatcher (Fase 5)   ← BELUM ADA
                        └────────────┬────────────┘
                                     ▼
                        CandidateGenerator (recall-first, dedup IoU)
                                     ▼
                        SpatialAssociation (scale-aware, Fase 2) — symbolBBox ≠ tagBBox
                                     ▼
                        GeometryValidation + BBoxRefinement (Fase 2)
                                     ▼
                        DeterministicConfidence (dynamic weights, Fase 6)
                                     ▼
                        ┌────────────┴────────────┐
                     score≥HIGH              LOW≤score<HIGH
                   (accept, no AI)         (Gemini verify, ≤10/page, cached)
                        └────────────┬────────────┘
                                     ▼
                        Revalidasi → Human Review → Asset Register → Excel
```

`AI_MODE=disabled`: jalur kiri saja, tetap hasilkan deteksi valid.
`AI_MODE=assisted`: tambah jalur kanan untuk kandidat ambigu.

> ⚠️ `AI_MODE` **belum ada** di `lib/env.ts`. Kedua mode di atas belum dapat
> dipilih; hanya jalur Gemini Vision yang berjalan.

## 2. Pemisahan Engine — status nyata per file

### Sudah ada

```
lib/detection/
  config.ts                             # config terpusat (✅ ada)
  geometry/
    coordinate-transform.ts             # canonical pixels ↔ normalized ↔ tile ↔ SVG (✅ ada)
    bbox-validator.ts                   # validasi bbox (✅ ada)
    spatial-association.ts              # scale-aware (✅ ada)
    canonical-vision.ts                 # ✅ ada
  legend/
    legend-classes.ts                   # ✅ ada — grouping + eligibility rule
    legend-model.ts                     # ✅ ada — normalisasi label
  region/
    region-plan.ts, region-crop.ts      # ✅ ada — region grid (pengganti tiling Python)
  ai/
    verifier.ts, verifier-prompt.ts, verdict-schema.ts   # ✅ ada (Fase 7)
  persistence/
    detection-repository.ts             # ✅ ada (Fase 2)
  job-status.ts

sql/
  migrate-v2-detection-extensions.sql   # ✅ ada
```

### Belum ada

```
lib/detection/
  cv-client.ts                          # ❌ tidak ada
  scoring/confidence-engine.ts          # ❌ tidak ada (masih lib/confidence-fusion.ts)
  legend/template-builder.ts, matcher.ts # ❌ tidak ada
  pipeline/detection-pipeline.ts, page-pipeline.ts  # ❌ tidak ada (logic masih inline di worker)

services/cv/                            # ❌ SELURUH DIREKTORI TIDAK ADA
  app.py, preprocess.py, line_detection.py, component_detection.py,
  contour_detection.py, shape_features.py, bbox_refinement.py,
  text_detection.py, ocr_runner.py, tag_normalization.py,
  legend_template_builder.py, legend_matcher.py, requirements.txt, Dockerfile

sql/
  migrate-v2-ground-truth.sql           # ❌ tidak ada (Fase 8)
scripts/
  benchmark.ts, ground-truth.schema.json # ❌ tidak ada (Fase 8)
```

> **Region tiling sudah digantikan.** `lib/detection/region/` mengimplementasikan
> pemecahan region di Node dengan sharp, jadi kebutuhan `TILE_SIZE`/`TILE_OVERLAP`
> dari Fase 3 Python tidak lagi relevan untuk MVP.
>
> **Template matcher belum ada, tapi tidak kritis.** Legend matching saat ini
> dilakukan lewat `lib/rule-validator.ts` (rantai CACHE → LEGEND → KB →
> EMBEDDING → RULES → ISA → ISO → VISION → UNKNOWN) plus embedding opsional,
> bukan contour/template matching.

## 3. Sistem Koordinat Kanonik (§8, mandatory)

Internal = **natural page pixels** + dimensi halaman. `0–1000` hanya di batas UI.

```text
tile pixels →(tileToPage)→ page pixels →(pageToNormalized)→ 0–1000 →(normalizedToSvg)→ SVG/DOM
```

Implementasi: `lib/detection/geometry/coordinate-transform.ts` (pure functions, tested).
Lihat `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md` Fase 1 untuk daftar fungsi.

## 4. Gemini Budget (expensive verifier, bukan primary)

> ⚠️ Gate score di bawah ini **belum nyambung** ke halaman P&ID. `lib/detection/ai/verifier.ts`
> sudah ada dan punya budget, tapi belum dipakai sebagai gate ambiguous-only seperti
> ada di rencana ini. Nama env di bawah sudah dikoreksi ke yang benar-benar ada
> di `lib/env.ts` (`MAX_GEMINI_CALLS_PER_PAGE` / `MAX_GEMINI_RETRY_PER_PAGE`
> **tidak pernah ada**).

```
Env (nyata):  VERIFIER_MAX_CALLS_PER_PAGE=10 (default), VERIFIER_TIMEOUT_MS=60000,
              VERIFIER_CACHE_MAX_ENTRIES=500
Gate (rencana): score≥0.90 accept | 0.70–0.90 verify (top-N by score, ≤ budget) | <0.70 reject/review
Cache: sha256(documentHash+pageNumber+cropHash+legendVersion+promptVersion+pipelineVersion)
Output: {decision: confirm|correct|reject|uncertain, legendReferenceId, assetType,
         bboxCorrection, tagCorrection, reason, confidence} → selalu lewat validator.
Failure: aiStatus=failed + aiFailureReason, hasil deterministik retained, page ≠ FAILED.
```

## 5. Ground Truth & Benchmark (Fase 8) — ❌ BELUM ADA

Tabel `ground_truth_documents` / `ground_truth_assets`, `benchmark_runs`,
`scripts/ground-truth.schema.json`, dan `scripts/benchmark.ts` **belum pernah
dibuat** — tidak ada di `sql/` maupun `scripts/`.

Yang ada hanyalah satu laporan historis: `eval/reports/pdt11-reconstruction-v1.json`,
yang mengukur pipeline deterministik+OCR **yang sudah tidak lagi berjalan**.
Baca banner di `eval/README.md` sebelum memakai angkanya.

Metrik yang direncanakan: Precision, Recall, F1, mean IoU@0.5, Tag Accuracy,
Tag Association Accuracy. Threshold (HIGH/LOW/NMS/weights) harus di-sweep terhadap
benchmark — tidak ada nilai final sebelum diukur.
