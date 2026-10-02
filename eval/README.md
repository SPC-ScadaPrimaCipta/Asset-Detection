# Phase 8 — Ground Truth, Calibration & Accuracy Evaluation
# Phase 9 — Deterministic Recall & False-Positive Reduction (measured below)

> **Historical record — the pipeline measured below no longer runs.**
> These numbers describe the deterministic CV + OCR pipeline (OpenCV contour
> candidates, text-region masking, template matching, Tesseract OCR). Run
> Detection is now 100% Gemini Vision (`lib/ai-agent.ts` +
> `workers/detection-worker.ts`), aligned with Scan Legend. No OpenCV, no OCR,
> no YOLO, no Python. The reports are kept as the baseline any future pipeline
> must beat — they are not a description of current behaviour.
>
> **No benchmark exists for the current Gemini Vision pipeline.** The
> ground-truth tooling this doc describes (`sql/migrate-v2-ground-truth.sql`,
> `scripts/ground-truth.schema.json`, `scripts/benchmark.ts`,
> `POST /api/benchmark/run`) **was never built**. Every production threshold
> today — `DETECTION_REVIEW_THRESHOLD` 0.65, `DETECTION_SKIP_FEATURES_CONFIDENCE`
> 0.96, the IoU dedupe values — is a reasonable default, **not** a swept
> operating point. Status: `docs/DETECTION_V2_IMPLEMENTATION_PLAN.md` §Fase 8.

Measurement phases. Production thresholds untouched throughout.

## Datasets

| Dataset | Source | GT positives | Negatives | Method |
|---|---|---|---|---|
| `gt_pdt11_snippet_v1.json` | user P&ID markup 2026-09-24, human-annotated blind (no predictions viewed) | 9 (+3 ambiguous, 1 unknown) | 11 explicit | visual-estimate 0–1000 |
| `pdt11-reconstruction-v1` | vector redraw of the snippet (2000×950) | 9 (+2 ambiguous, 1 unknown) | 11 | cad-measured (design intent) |

## Measured result (reconstruction-v1, deterministic-only, cold OCR)

> Pada dataset evaluasi 1 halaman rekonstruksi dengan 9 annotated assets,
> pipeline deterministik-only menghasilkan: **P 0.018 / R 0.33 / F1 0.034**
> (TP 3, FP 166, FN 6), meanIoU@0.5 0.66, OCR exact 0.0, assoc accuracy 0.0.
> Full report: `eval/reports/pdt11-reconstruction-v1.json`.

Per-class: VALVE P 0.22/R 0.40; VESSEL R 1.0 but 118 FP; INSTRUMENT & VERTICAL PUMP 0.
Sweep (75 combos, A/B/C × HIGH × LOW): reviewVolume 168–169/169 — bands never reach HIGH.

## What this proves (evidence, not tuning)

1. Recall-first matching without text masking floods FPs (153 SMALL_SYMBOL_FP:
   text glyphs match legend templates). → Phase 9: text-region masking in P&ID path.
2. OCR reads all key tags incl. 6-digit (Tesseract ✓, parser fix validated) but
   cloud-paren artifacts (`(VLV-390795`) break parsing + associations miss.
3. Confidence bands uncalibrated: everything routes to review.
4. Tag regex `{1,5}` rejected real 6-digit plant tags — FIXED with evidence
   (`{1,6}`, test-covered). Only production change in Phase 8.

## Not measured

Gemini delta (no API key in eval env — `gemini_delta()` harness ready, status
not-run). Human-corrected reference = GT by construction. No accuracy claimed
from synthetic fixtures.

## Phase 10 re-measurement (matcher-stage co-design, same GT/methodology)

| Variant | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|
| Phase 9 +mask | 0.115 | 0.333 | 0.171 | 3 | 23 | 6 |
| P10-split (mask+linesplit+reunion) | 0.143 | 0.444 | 0.216 | 4 | 24 | 5 |
| +refine / +recon / +full10 | 0.143 | 0.444 | 0.216 | 4 | 24 | 5 |

Reading:
- Pump recovered (TP, IoU 0.76) via masked reunion — candidate supply 6/9 potential.
- Refine/repair neutral end-to-end here (guarded no-ops when direct sufficient;
  mechanisms unit-proven: reunion IoU 0.81, repair dual-evidence, tighten guard).
- Per-class: PUMP [1,1,0], VESSEL [1,3,0] (FP 14→3), VALVE [2,6,3], INSTRUMENT [0,3,2].
- Remaining bottleneck: matcher discrimination (capsule-vs-valve razor-thin) +
  association (OCR reads tags, links still miss) — next phase, not thresholds.
- Recommended production defaults: masking ON, linesplit+reunion ON (only with
  masking), refine ON (guarded), repair ON (auditable). Global linesplit alone
  stays OFF (Phase 9 negative). No Gemini used. No weights/thresholds changed.

## Phase 9 re-measurement (same GT, same methodology)

| Variant | n | P | R | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|---|
| baseline | 169 | 0.018 | 0.333 | 0.034 | 3 | 166 | 6 |
| +mask (text-region suppression) | 26 | 0.115 | 0.333 | 0.171 | 3 | 23 | 6 |
| +linesplit | 156 | 0.013 | 0.222 | 0.024 | 2 | 154 | 7 |
| +both | 35 | 0.057 | 0.222 | 0.091 | 2 | 33 | 7 |

Reading (ablation, not tuning):
- Masking: FP 166→23, recall UNCHANGED (3/3 TPs kept) → SHIP (default ON in
  runner; production wiring = next step, not this phase).
- Punctuation trim (7 cases, unit-covered): cloud-paren tags now parse;
  rawText + transformations preserved (auditable).
- Linesplit: candidate-level recall 3/9→5/9, pump halves reunite to IoU 0.81 —
  but end-to-end R drops 0.33→0.22 (line removal damages match features; 18
  reunion merges include junk). HELD behind flag (default OFF); needs matcher
  co-design, not more splitting.
- Net finding: candidate generation now reaches 6/9 potential; the MATCHING
  stage is the next bottleneck (labels/scores), not candidate supply.
- No Gemini used. No threshold/weight changed. Full report JSON updated in place.

