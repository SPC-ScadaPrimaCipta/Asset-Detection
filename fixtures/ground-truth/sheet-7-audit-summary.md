# Sheet 7 Variant Audit Summary

## Overview

Sheet 7 has three variants in the evaluation dataset:
- `sheet-7-p1` (main)
- `sheet-7-rev-p1` (revision variant)
- `sheet-7-model-p1` (model variant)

All three are from the same source document with minor revisions. This analysis determines whether they represent substantially identical drawings or meaningful variations.

## Candidate Detection Pattern

### sheet-7-p1 (13 candidates)
| Crop | Predicted Class | Conf | Audit Decision | Category |
|------|-----------------|------|----------------|----------|
| 00 | Rupture_disk (22) | 0.848 | false_positive | equipment_misclassification |
| 01 | Flange_or_Nozzle (21) | 0.746 | false_positive | revision_cloud |
| 02 | Flange_or_Nozzle (21) | 0.743 | false_positive | revision_cloud |
| 03 | Flange_or_Nozzle (21) | 0.734 | false_positive | wrong_symbol |
| 04 | Instrument_Aux_Panel (29) | 0.727 | false_positive | equipment_misclassification |
| 05 | Instrument_Aux_Panel (29) | 0.554 | false_positive | equipment_misclassification |
| 06 | Flange_or_Nozzle (21) | 0.551 | false_positive | wrong_symbol |
| 07 | Rupture_disk (22) | 0.420 | false_positive | wrong_symbol |
| 08 | Rupture_disk (22) | 0.418 | false_positive | wrong_symbol |
| 09 | Flange_or_Nozzle (21) | 0.417 | false_positive | wrong_symbol |
| 10 | Flange_or_Nozzle (21) | 0.277 | false_positive | wrong_symbol |
| 11 | Rupture_disk (22) | 0.277 | false_positive | wrong_symbol |
| 12 | Rupture_disk (22) | 0.260 | false_positive | wrong_symbol |

**Result:** 13/13 false positives (100% FP rate on inspected candidates)

### sheet-7-rev-p1 (13 candidates)
Candidate list is **identical** to sheet-7-p1:
- Same bbox coordinates
- Same confidence scores
- Same predicted classes

**Observation:** sheet-7-rev-p1 appears to be a duplicate or near-duplicate of sheet-7-p1.

### sheet-7-model-p1 (5 candidates)
| Crop | Predicted Class | Conf | Visual Inspection |
|------|-----------------|------|-------------------|
| 00 | Rupture_disk (22) | 0.905 | Pump P-004B with "NOTE 1" annotation — false positive |
| 01 | Instrument_Aux_Panel (29) | 0.782 | Vessel V-011 with valve assembly — false positive |
| 02 | Rupture_disk (22) | 0.643 | Pump P-004-A with "4"x6"" pipe annotation — false positive |
| 03 | Flange_or_Nozzle (21) | 0.516 | Valve symbol (NC) with pipe sizes — requires closer inspection |
| 04 | Control_Valve (14) | 0.482 | Sight glass or similar fitting — requires closer inspection |

**Preliminary:** At least 3/5 are false positives (Pump misclassified as Rupture_disk, Vessel as Instrument_Aux_Panel).

## Visual Similarity Analysis

### sheet-7-p1 vs sheet-7-rev-p1
Candidate detection lists are **byte-for-byte identical**:
- Same 13 candidates
- Same coordinates (pixel-perfect match)
- Same confidence scores (up to 10 decimal places)

**Conclusion:** These are either:
1. Duplicate files (same source PNG rendered twice), OR
2. Revision changes are so minor that YOLO inference produces identical output

**Impact on evaluation:**
- If duplicates: one should be removed from dataset to avoid double-counting same patterns
- If genuine revisions: keeping both is valid, but evaluation report must segment metrics per variant to prevent one drawing from dominating global statistics

### sheet-7-model-p1 vs sheet-7-p1
Detection pattern differs:
- Different candidate count (5 vs 13)
- Different bbox coordinates
- Different confidence distribution

**Conclusion:** sheet-7-model-p1 is a **distinct variant** (different layout, different equipment arrangement, or different rendering quality).

## Source/Variant Grouping Note

Sheet 7 original, revision, and model variant are retained as separate
evaluation pages for regression/variant sensitivity, but they are not treated
as three fully independent source drawings when assessing generalization.
Report both per-page metrics for all 12 pages and a grouped Sheet 7
original/revision/model metric so this drawing family does not dominate the
global generalization assessment.

## Recommendation

### For Ground Truth Annotation
1. **sheet-7-p1:** Continue full-page scan for supported symbols after candidate audit complete
2. **sheet-7-rev-p1:** 
   - Option A (Recommended): **Skip annotation** and remove from dataset if visual inspection confirms it is identical to sheet-7-p1
   - Option B: Keep in dataset but mark as "duplicate variant" and report metrics separately
3. **sheet-7-model-p1:** Continue full annotation (distinct drawing)

### For Gate Decision
- If sheet-7-rev-p1 is confirmed duplicate: dataset size remains 11 unique pages (still meets ≥10 minimum)
- Systematic FP patterns already visible across Sheet 7 variants:
  - Pump/equipment → Rupture_disk (high confidence)
  - Vessel assembly → Instrument_Aux_Panel
  - Valve/PI assemblies → Flange_or_Nozzle

## Next Steps

1. Visual comparison: Open `fixtures/pid-eval/sheet-7/page_1.png` and `fixtures/pid-eval/sheet-7-rev/page_1.png` side-by-side
2. If pixel-identical or visually indistinguishable: remove sheet-7-rev-p1 from dataset
3. Continue annotation on remaining 10-11 distinct pages
4. Complete candidate audit for sheet-7-model-p1 (5 candidates)
5. Full-page scan for all annotated sheets to capture false negatives

---

**Audit Status:** Preliminary analysis complete. Awaiting decision on sheet-7-rev-p1 before finalizing dataset structure.
