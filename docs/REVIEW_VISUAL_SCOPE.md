# Scoped Review Visual Package — v203 (Offline Preparation Only)

**Status:** `NOT EVALUATED`  
**Scope:** Offline preparation for human review. No production overlay, no quality metrics.  
**Review Label Applied to All Candidates:** `UNREVIEWED_MODEL_PREDICTION` (not TP/FP classification).

---

## 1. File Scope (Precise Paths)

```text
scripts/
└── generate-v203-visual-review.ts              [NEW — generator, read-only]

fixtures/diagnostics/review-v203-baseline-v1/
├── manifest.json                                [NEW — links page/prediction/crop/overlay]
├── review-manifest.csv                           [NEW — tabular index for quick scan]
├── full-page/
│   ├── sheet-1-p1_reviewed.png                  [NEW — full page with bbox overlays]
│   ├── ... (12 images total)
│   └── sheet-7-rev-p1_reviewed.png               [NEW — duplicate variant kept]
├── candidate-crops/
│   ├── sheet-1-p1_pred-000_crop.png             [NEW — crop with context padding]
│   └── ... (232 crop images per baseline)
├── tile-seams/
│   ├── sheet-1-p1_tile_grid_diagnostic.png      [NEW — tile seams overlaid on page]
│   └── ... (optional diagnostic layer)
└── class-reference-v203/
    └── v203-raw-label-table.md                  [NEW — vocabulary display reference]
```

---

## 2. Generator Design (No Change to Protected Files)

The generator reads from the verified baseline `fixtures/diagnostics/predictions-v203-baseline.json` and produces the following artifacts offline:

### 2.1 Full Page Overlay
- Source: `fixtures/pid-eval/*/page_*.png` (original page resolution, zero resize).
- Overlays: Bounding boxes from `predictions-v203-baseline.json` `retainedDetections[].pageBox`.
- Labels drawn: `Page` (e.g., "sheet-7-p1"), `Class` (`rawLabel`), `Conf` (`confidence`), `Tile` (`tileIndex`).
- All predictions retain label `UNREVIEWED_MODEL_PREDICTION`.

### 2.2 Candidate Crop Images
- For each retained prediction, crop is centered on `pageBox` with a context margin (~20% larger than bbox).
- Filename format: `<pageId>_pred-<paddingId>_crop.png`.
- Overlay: Same bbox + raw class label + confidence value.
- Purpose: Human reviewer examines each candidate with local context.

### 2.3 Tile Seam Diagnostic Layer
- Draws `tileGrid` boundaries (stride 819, tile size 1024) over the full page image.
- Purpose: Allows reviewer to verify if predictions cluster near tile seams (potential artifact of sliding-window method).

---

## 3. Manifest Design (Review Tracking Only)

The manifest (`manifest.json`) maps:
- Page ID $	o$ full-page overlay image path.
- Prediction ID $	o$ crop image path.
- Prediction ID $	o$ `rawClassId`, `rawLabel`, `confidence`, `tileProvenance`.

No TP/FP annotations added by script. Human reviewer must manually confirm/reject/edit/reject/add in separate workflow.

---

## 4. Full-Page Review Requirement (Explicit)

Review instructions included in manifest:
1. Open full-page overlay.
2. Scan for objects **not** enclosed by any bbox overlay (potential missed detections / false negatives).
3. Open crop for suspicious predictions.
4. Consult `v203-raw-label-table.md` for vocabulary reference.
5. Note any `unresolved` class decisions separately; proposal mapping does not force binding.

---

## 5. Duplicate Image Handling in Review Package

Both `sheet-7-p1` and `sheet-7-rev-p1` receive independent review artifacts (full page + crops). During review:
- Duplicate hash (`dcb6475f...`) noted.
- Predictions are identical (verified from baseline).
- Reviewer should treat them as duplicate variants; quality conclusions must not double-count them.
