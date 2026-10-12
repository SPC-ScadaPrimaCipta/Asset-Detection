# Metrics Boundary & Quality Gate Documentation (v203)

**Status:** `NOT EVALUATED`  
**Reason:** Ground-truth dataset (`dataset-v1.json`) contains only **5 annotations** across 3 pages out of 12 evaluation pages; full-page annotation is incomplete.

---

## 1. Ground Truth Status

- `dataset-v1.json`: 12 page records, 5 total annotations (sheet-7-model-p1: 1, sheet-11-p1: 2, fire-water-p1: 2).
- The other 9 pages have zero annotations.
- `candidate-audit-v1.json`: 81 candidate audit decisions (4 TP, 76 FP, 1 wrong class). This represents a **candidate-bound audit of legacy predictions**, not a full-page ground-truth dataset.
- `annotation-progress.md`: Annotation progress is `in_progress` / `pending` across all 12 pages.
- **No full-page object enumeration has been completed** for the v203 model.

---

## 2. Metric Boundaries — What Is NOT Claimed

The following metrics are explicitly **NOT computed or claimed** for v203 based on this dataset:

- Precision, Recall, F1-score (at any threshold)
- Mean Average Precision (mAP)
- Per-class precision / recall
- False Positive / False Negative counts
- Quality gate pass/fail verdict (e.g., precision ≥ 0.80, recall ≥ 0.50)

All predictions in the baseline (`predictions-v203-baseline.json`) are labeled `UNREVIEWED_MODEL_PREDICTION`. They are **unreviewed candidates**, not verified correct detections.

---

## 3. What Is Reported as Counts

- **Prediction counts** (raw candidates before merge, retained after merge, suppressed by merge) are reported purely as pipeline statistics, not accuracy measures.
- Per-page prediction counts are reported as **candidates not yet reviewed**, never as "assets confirmed".

---

## 4. Conflicting Definitions Note (UI vs Export — Unresolved)

Per documentation (`docs/ASSET_REGISTER_EXCEL_EXPORT.md` §18–19), there is a discrepancy between:
- **UI definition:** `reviewStatus === 'PENDING'` indicates needs review.
- **Excel export (`Detection Summary`):** Uses hardcoded confidence bands 0.95 / 0.80.

The correct source-of-truth for "needs review" has not yet been resolved in production. Until the source is unified (UI, export, or both), confidence-band interpretations should not be treated as definitive.

---

## 5. Threshold Configuration (Baseline Only — Not Quality Gate)

- Confidence threshold: `0.50`
- Per-tile NMS IoU: `0.70`
- Per-tile cap: `300`
- Global merge IoU: `0.50`

These are pipeline parameters, not acceptance criteria.

---

## 6. Assertion Restrictions

Under this document, the following claims must not be made from current artifacts:

- `"v203 passes quality gate"` — False (gate not evaluated).
- `"v203 has X% precision"` — False (no ground truth for full dataset).
- `"v203 predictions are correct assets"` — False (all labeled `UNREVIEWED_MODEL_PREDICTION`).
- `"dataset-v203.draft.json annotations are final"` — False (status is `unannotated`).

---

## 7. Required Next Steps Before Any Quality Assessment

1. Complete full-page human annotation of all 12 evaluation pages.
2. Resolve all `unresolvedClassDecisions` in dataset draft.
3. Confirm annotated dataset satisfies `annotationStatus: complete` for each page.
4. Only after step 3, run formal TP/FP evaluation against the full annotated dataset.
