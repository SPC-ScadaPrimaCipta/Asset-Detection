# DETECTION V2 — Implementation Plan (Revisi Bertahap)

> Aturan tiap fase: **revisi → test existing tetap pass → benchmark/inspeksi → lanjut.**
> Jika fase tidak menaikkan F1 benchmark, rollback.

## Fase 1 — Foundation ✅ (sedang dikerjakan)
- [x] Audit grep dead-code (`lib/ai-prompt.ts` terverifikasi mati → hapus)
- [ ] `lib/detection/config.ts` — config V2 terpusat (env + default)
- [ ] `lib/detection/geometry/coordinate-transform.ts` + `__tests__/coordinate-transform.test.ts`
- [ ] `services/cv/` skeleton (`app.py`, `preprocess.py`, `requirements.txt`, `Dockerfile`)
- [ ] `lib/detection/cv-client.ts` (HTTP + fallback saat service down)
- [ ] Revisi `lib/env.ts` (8 var V2) — `AI_MODE` gate belum di-wire (Fase 7)
- Gate: `npx jest __tests__/coordinate-transform.test.ts` pass; `tsc --noEmit` pass

## Fase 2 — Geometri (berikutnya)
- Revisi: `bbox-validator.ts`, `spatial-association.ts` (scale-aware `exp(-dist/k·size)`),
  `detection-repository.ts` (extract INSERT), `renderPageTiles()` di `pdf-render.ts`
- DB: `migrate-v2-detection-extensions.sql` (`symbol_bbox_*`, `tag_bbox_*`, `page_width/height`,
  `detection_method`, `deterministic_score`, `ai_*`, `pipeline_version`)
- Revisi `ai-schemas.ts` normalizer → pakai canonical transform
- Gate: bbox/IoU/dedup tests; dual-write `bbox_*` legacy + `symbol_bbox_*` lolos

## Fase 3 — Python CV
- `preprocess.py`, `line_detection.py`, `component_detection.py`, `contour_detection.py`,
  `shape_features.py` + tiling (`TILE_SIZE=1280`, overlap 20%, config-driven)
- Debug masks: `line-mask`, `text-mask`, `candidate-mask` via `?debug=1`
- Gate: inspeksi visual mask di 1 halaman Sheet 11; recall kandidat naik vs baseline

## Fase 4 — OCR & Tag
- `ocr_runner.py` (PaddleOCR + rotation cascade) + `tag_normalization.py`
  (koreksi `O↔0` dkk. HANYA jika cocok Legend `tagPatterns`)
- Aturan §20: tag null → aset tetap dibuat (`requiresReview: true`)
- Gate: tag pattern tests (valid/invalid/typo/rotated); Tag Accuracy naik

## Fase 5 — Legend Matching
- `legend_template_builder.py` saat Legend finalize + `matcher.ts`
  (`0.30 shape +0.25 template +0.20 contour +0.10 size +0.10 orientation +0.05 prior`, configurable)
- `feature-extractor.ts` KEEP sampai benchmark fase ini menang → baru hapus
- Gate: recall per-asset-type naik; tanpa hardcode tipe aset

## Fase 6 — Confidence Engine
- `confidence-engine.ts`: bobot dinamis atas sinyal tersedia (tag hilang ≠ auto-rendah)
- Gate: confidence with/without tag/AI tests

## Fase 7 — Gemini Verifier
- `verifier.ts`: gate ambiguous-only, budget `MAX_GEMINI_CALLS_PER_PAGE=10`, cache/dedup,
  structured `confirm|correct|reject|uncertain`, failure isolation
- Gate: integration `AI_MODE=disabled` (valid, tanpa Gemini) + `assisted` (≤10 calls/page)

## Fase 8 — Benchmark & Kalibrasi
- 8.0: `migrate-v2-ground-truth.sql` + `ground-truth.schema.json` + annotate UI (reuse PidViewer)
  → label manual 1–2 halaman Sheet 11 (target 30–60 aset)
- 8.1: `scripts/benchmark.ts` + `POST /api/benchmark/run` → Precision/Recall/F1/IoU/TagAcc
- 8.2: sweep HIGH/LOW/NMS/weights → operating point; 8.3: regression gate CI (F1 drop >2pts = fail)
