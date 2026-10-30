# DETECTION V2 — Implementation Plan (Revisi Bertahap)

> ## ⚠️ Status: hanya 2 dari 8 fase yang benar-benar selesai
>
> Plan ini **berhenti di Fase 2**. Fase 3–8 tidak pernah dimulai, dan tidak ada
> Python di stack. Baca unchecked box sebagai "belum dimulai", bukan "sedang
> dikerjakan" — dan beberapa targetnya sudah dibatalkan atau digantikan.
>
> | Fase | Status |
> |---|---|
> | 1 — Foundation | ✅ Selesai (kecuali `services/cv/`) |
> | 2 — Geometri | ✅ Selesai |
> | 3 — Python CV | ❌ Tidak dimulai — **dibatalkan**, digantikan region tiling Node (`lib/detection/region/`) |
> | 4 — OCR & Tag | ❌ Tidak dimulai — **dibatalkan**, tidak ada OCR di jalur Gemini Vision |
> | 5 — Legend Matching | ⚠️ Template matcher tidak ada; diganti rantai validasi 9 tahap (`lib/rule-validator.ts`) |
> | 6 — Confidence Engine | ❌ `confidence-engine.ts` tidak ada; masih `lib/confidence-fusion.ts` |
> | 7 — Gemini Verifier | ⚠️ `verifier.ts` **ada** tapi belum jadi gate ambiguous-only; `AI_MODE` tidak ada di env |
> | 8 — Benchmark | ❌ Tidak ada; lihat `eval/README.md` untuk satu-satunya laporan historis |
>
> Arsitektur target lengkap: `docs/DETECTION_V2_ARCHITECTURE.md`.
>
> Konteks produk: `docs/PRD.md` §4 (Non-Goals), `eval/README.md`.

> Aturan tiap fase: **revisi → test existing tetap pass → benchmark/inspeksi → lanjut.**
> Jika fase tidak menaikkan F1 benchmark, rollback.

## Fase 1 — Foundation ✅

- [x] Audit grep dead-code (`lib/ai-prompt.ts` terverifikasi mati → **dihapus**)
- [x] `lib/detection/config.ts` — config V2 terpusat (env + default)
- [x] `lib/detection/geometry/coordinate-transform.ts` + `__tests__/coordinate-transform.test.ts`
- [x] `DEBUG_ARTIFACTS` ada di `lib/env.ts`
- [x] Gate: `npx jest __tests__/coordinate-transform.test.ts` pass; `tsc --noEmit` pass
- [ ] `services/cv/` skeleton (`app.py`, `preprocess.py`, `requirements.txt`, `Dockerfile`) — **dibatalkan.** Direktori `services/` tidak pernah dibuat. Tidak ada Python di project ini.
- [ ] `lib/detection/cv-client.ts` — **dibatalkan**, tidak ada lagi yang perlu dikomunikasikan via HTTP.
- [ ] Delapan var V2 lainnya (`AI_MODE`, `CV_SERVICE_URL`, `PIPELINE_VERSION`, `TILE_SIZE`, `TILE_OVERLAP`, `HIGH_CONFIDENCE_THRESHOLD`, `LOW_CONFIDENCE_THRESHOLD`, `MAX_GEMINI_CALLS_PER_PAGE`) — **tidak pernah ditambahkan** ke `lib/env.ts`. Jangan mendokumentasikan mereka sebagai tersedia.

> Catatan: `lib/ocr-candidate.ts` juga **tidak ada** di repo, padahal dirujuk di
> `docs/DETECTION_V2_AUDIT.md`.

## Fase 2 — Geometri ✅

- [x] `lib/detection/geometry/bbox-validator.ts`
- [x] `lib/detection/geometry/spatial-association.ts` (scale-aware `exp(-dist/k·size)`)
- [x] `lib/detection/geometry/canonical-vision.ts`
- [x] `lib/detection/persistence/detection-repository.ts` (INSERT dipisah dari worker)
- [x] DB: `sql/migrate-v2-detection-extensions.sql`
- [x] `ai-schemas.ts` normalizer memakai canonical transform
- [x] Gate: test ada (`bbox-validator`, `spatial-association`, `coordinate-transform`, `detection-repository`)
- [ ] `renderPageTiles()` di `lib/pdf-render.ts` — **dibatalkan.** Digantikan `lib/detection/region/region-plan.ts` + `region-crop.ts` (region grid di Node dengan sharp).

## Fase 3 — Python CV ❌ tidak dimulai (dibatalkan)

Target: `preprocess.py`, `line_detection.py`, `component_detection.py`,
`contour_detection.py`, `shape_features.py`, plus tiling.

**Tidak ada satu pun file Python di repo ini.** Kebutuhan tiling sudah dipenuhi
`lib/detection/region/` di sisi Node.

## Fase 4 — OCR & Tag ❌ tidak dimulai (dibatalkan)

Target: `ocr_runner.py` (PaddleOCR + rotation cascade) + `tag_normalization.py`.

**Tidak ada OCR di jalur ini.** Gemini membaca tag langsung dari gambar. Prinsip
PRD §5.1 tetap berlaku: tag null → aset tetap dibuat dengan `NEEDS_REVIEW`.
Pemrosesan tag berjalan lewat Gemini + validasi aturan, bukan OCR piksel.

## Fase 5 — Legend Matching ⚠️ berubah arah

- [ ] `legend_template_builder.py` + `matcher.ts` — **tidak dibuat.**
- [x] Pengganti yang benar-benar ada: `lib/detection/legend/legend-classes.ts` (grouping by normalized label + eligibility rule) dan `lib/rule-validator.ts` (rantai CACHE → LEGEND → KB → EMBEDDING → RULES → ISA → ISO → VISION → UNKNOWN).
- [x] `lib/feature-extractor.ts` **dipertahankan** — belum ada benchmark yang membuktikan CV deterministik lebih baik. Default tetap `false` lewat `ENABLE_SYMBOL_FEATURE_EXTRACTION`.
- [x] Gate "tanpa hardcode tipe aset" terpenuhi: tipe aset berasal dari Legend yang dipilih, bukan daftar statis.

## Fase 6 — Confidence Engine ❌ tidak dimulai

Target: `confidence-engine.ts` dengan bobot dinamis.

File tersebut tidak ada. Confidence dihitung `lib/confidence-fusion.ts` + penalty di
`lib/ai-agent.ts`, dengan `DETECTION_REVIEW_THRESHOLD` (default 0.65) dan
`DETECTION_PENALTY_REVIEW_THRESHOLD`. Status hanya `VALID` / `NEEDS_REVIEW` /
`CONFLICT` — **tidak ada** band High/Medium/Low.

## Fase 7 — Gemini Verifier ⚠️ sebagian

- [x] `lib/detection/ai/verifier.ts` + `verifier-prompt.ts` + `verdict-schema.ts` ada
- [x] Budget & cache ada: `VERIFIER_MAX_CALLS_PER_PAGE`, `VERIFIER_TIMEOUT_MS`, `VERIFIER_CACHE_MAX_ENTRIES`
- [ ] Belum jadi gate ambiguous-only dengan band 0.90/0.70 seperti di §4 arsitektur
- [ ] `AI_MODE=disabled|assisted` — **tidak ada** di `lib/env.ts`. Kedua mode tidak dapat dipilih, dan tidak ada integration test untuknya.

## Fase 8 — Benchmark & Kalibrasi ❌ tidak dimulai

Tidak ada `sql/migrate-v2-ground-truth.sql`, `ground-truth.schema.json`,
`scripts/benchmark.ts`, `POST /api/benchmark/run`, maupun annotate UI.

Yang ada: `eval/reports/pdt11-reconstruction-v1.json` — satu laporan untuk pipeline
deterministik + OCR yang **sudah tidak lagi berjalan**. Angka di sana bukan deskripsi
perilaku saat ini; baca banner di `eval/README.md`.

Konsekuensi yang harus jujur: **belum ada benchmark yang mengukur jalur Gemini
Vision.** Semua threshold saat ini (0.65 review, 0.96 skip-features, IoU 0.5/0.3,
dan seterusnya) adalah default yang masuk akal, bukan hasil sweep.

## Kalau plan ini dilanjutkan lagi

1. **Jangan** langsung ke Fase 3–5 (Python/OCR). PRD §4 menandainya non-goal untuk MVP.
2. Yang paling bernilai sekarang: **benchmark harness untuk jalur Gemini** (Fase 8 saja), supaya threshold bisa diukur sebelum ditebak.
3. Setelah itu: **diagnostics otomatis untuk kualitas crop Legend** (`computed_features` / `quality_reasons`). Kolomnya sudah ada di `sql/migrate-007-legend-quality-classes.sql` dan UI sudah membacanya, tapi tidak ada yang mengisinya — `quality_status` hanya berubah karena aksi manusia (Validate All / Reject / Re-crop).
4. `services/cv/` hanya masuk akal kalau ada bukti bahwa Gemini Vision tidak cukup. Hari ini belum ada bukti itu.