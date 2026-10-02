# DETECTION V2 — Arsitektur Hybrid (Revisi Incremental)

> Prinsip: **Deterministic menemukan bukti. Legend mendefinisikan validitas.
> Geometri memvalidasi. OCR membaca tag. Gemini menyelesaikan ambiguitas.
> Human Review otoritas final.**

## 1. Arsitektur Target

```text
                    ┌──────────────┐
                    │Legend Library│  legends + legend_symbols (+ templates Fase 5)
                    └──────┬───────┘
                           │
PDF → Renderer (mupdf, +tiles Fase 3) → Preprocessor (Python CV)
      ├─ TextDetection → OCR (PaddleOCR, Fase 4) → TagNormalization (Legend tagPatterns)
      └─ ShapeDetection → CV Candidates (contours/CC, Fase 3) → LegendMatcher (Fase 5)
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

`AI_MODE=disabled`: jalur kiri saja, tetap hasilkan deteksi valid (integration test Fase 7).
`AI_MODE=assisted`: tambah jalur kanan untuk kandidat ambigu.

## 2. Pemisahan Engine (Baru vs Revisi)

```
lib/detection/                        # BARU — worker menipis, bukan membengkak
  config.ts                           # REVISI-terpusat: baca env V2 + default (Fase 1 ✅)
  cv-client.ts                        # BARU: HTTP client → services/cv (Fase 1 ✅ stub+fallback)
  geometry/
    coordinate-transform.ts           # BARU: canonical pixels ↔ normalized ↔ tile ↔ SVG (Fase 1 ✅)
    bbox-validator.ts                 # REVISI dari validasi inline worker:384 (Fase 2)
    spatial-association.ts            # REVISI dari lib/spatial.ts, scale-aware (Fase 2)
  scoring/confidence-engine.ts        # REVISI dari confidence-fusion.ts, dynamic (Fase 6)
  legend/template-builder.ts + matcher.ts  # BARU (Fase 5, reuse vector-repository.ts)
  ai/verifier.ts + prompts/verifier-prompt.ts  # BARU: gate Gemini ambiguous-only (Fase 7)
  pipeline/detection-pipeline.ts + page-pipeline.ts  # REVISI: extract processOnePage (Fase 2-3)
  persistence/detection-repository.ts # REVISI: extract INSERT worker:411 (Fase 2)

services/cv/                          # BARU — Windows-native FastAPI, Docker optional
  app.py                              # /health /preprocess /candidates /ocr /refine-bbox (Fase 1 ✅ skeleton)
  preprocess.py, line_detection.py, component_detection.py, contour_detection.py,
  shape_features.py, bbox_refinement.py, text_detection.py, ocr_runner.py,
  tag_normalization.py, legend_template_builder.py, legend_matcher.py  # Fase 3-5
  requirements.txt                    # Fase 1 ✅ (pinned, Windows wheels)
  Dockerfile                          # Fase 1 ✅ (deploy/CI saja, bukan mandatory dev)

sql/
  migrate-v2-detection-extensions.sql # Fase 2 (ADD COLUMN IF NOT EXISTS — backward compat)
  migrate-v2-ground-truth.sql         # Fase 8 (ground_truth_documents/assets, benchmark_runs)
```

## 3. Sistem Koordinat Kanonik (§8, mandatory)

Internal = **natural page pixels** + dimensi halaman. `0–1000` hanya di batas UI.

```text
tile pixels →(tileToPage)→ page pixels →(pageToNormalized)→ 0–1000 →(normalizedToSvg)→ SVG/DOM
```

Implementasi: `lib/detection/geometry/coordinate-transform.ts` (pure functions, tested).
Lihat `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md` Fase 1 untuk daftar fungsi.

## 4. Gemini Budget (expensive verifier, bukan primary)

```
Env: MAX_GEMINI_CALLS_PER_PAGE=10, MAX_GEMINI_RETRY_PER_PAGE=2 (configurable)
Gate: score≥0.90 accept | 0.70–0.90 verify (top-N by score, ≤ budget) | <0.70 reject/review
Cache: sha256(documentHash+pageNumber+cropHash+legendVersion+promptVersion+pipelineVersion)
Output: {decision: confirm|correct|reject|uncertain, legendReferenceId, assetType,
         bboxCorrection, tagCorrection, reason, confidence} → selalu lewat validator.
Failure: aiStatus=failed + aiFailureReason, hasil deterministik retained, page ≠ FAILED.
```

## 5. Ground Truth & Benchmark (Fase 8)

`ground_truth_documents` + `ground_truth_assets` (assetType, assetTag nullable, bbox canonical,
tagBBox, legendSymbolId, page, reviewStatus) + JSON schema `scripts/ground-truth.schema.json`.
Metrik: Precision, Recall, F1, mean IoU@0.5, Tag Accuracy, Tag Association Accuracy.
Threshold (HIGH/LOW/NMS/weights) di-sweep terhadap benchmark — tidak ada nilai final sebelum diukur.
