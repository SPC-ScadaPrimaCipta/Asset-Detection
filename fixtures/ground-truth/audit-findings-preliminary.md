# Ground Truth Annotation — Audit Findings (Preliminary)

**Date:** 2026-10-05  
**Status:** Candidate audit in progress (18/81 candidates inspected)  
**Dataset:** 12 pages, 81 YOLO candidates at threshold 0.25

---

## Executive Summary

**Critical finding:** Observed precision on inspected candidates is **0%** (0/18 true positives).

All 18 candidates inspected so far are false positives across three systematic pattern categories:

1. **Equipment misclassification** — Large process equipment (Pump, Vessel, Tank) misclassified as Rupture_disk or Instrument_Aux_Panel
2. **Revision cloud / annotation text** — Document markup misclassified as Flange_or_Nozzle
3. **Valve + instrument assemblies** — Valve/PI combinations with annotation bubbles misclassified as Flange_or_Nozzle or Rupture_disk

**Gate implications:** If this pattern holds across all 81 candidates, the model will fail the precision gate (≥0.80 required at threshold 0.50).

---

## Inspected Candidates by Page

### sheet-7-p1 (13/13 candidates audited)
| Candidate | Predicted Class | Conf | Decision | Category | Observed Object |
|-----------|----------------|------|----------|----------|-----------------|
| crop-00 | Rupture_disk (22) | 0.848 | FP | equipment_misclassification | Pump P-004B with motor |
| crop-01 | Flange_or_Nozzle (21) | 0.746 | FP | revision_cloud | Revision cloud STR-38008 |
| crop-02 | Flange_or_Nozzle (21) | 0.743 | FP | revision_cloud | Revision cloud VLV-380715 |
| crop-03 | Flange_or_Nozzle (21) | 0.734 | FP | wrong_symbol | Valve NC + annotation bubble VLV-380710 |
| crop-04 | Instrument_Aux_Panel (29) | 0.727 | FP | equipment_misclassification | Vessel V-011 with valve assembly |
| crop-05 | Instrument_Aux_Panel (29) | 0.554 | FP | equipment_misclassification | Tank T-004 with CLEAN OUT port |
| crop-06 | Flange_or_Nozzle (21) | 0.551 | FP | wrong_symbol | Valve + check valve VLV-380709 |
| crop-07 | Rupture_disk (22) | 0.420 | FP | wrong_symbol | Valve NC VLV-380720 |
| crop-08 | Rupture_disk (22) | 0.418 | FP | wrong_symbol | Valve VLV-380698 + strainer STR-38006 |
| crop-09 | Flange_or_Nozzle (21) | 0.417 | FP | wrong_symbol | PI P-004 + valve VLV-380695 |
| crop-10 | Flange_or_Nozzle (21) | 0.277 | FP | wrong_symbol | PI V-011A + valve VLV-380716 |
| crop-11 | Rupture_disk (22) | 0.277 | FP | wrong_symbol | Valve VLV-380712 + pipe size annotation |
| crop-12 | Rupture_disk (22) | 0.260 | FP | wrong_symbol | PI P-004 + valve VLV-380711 |

**Result:** 13/13 false positives (100% FP rate)

---

### sheet-1-p1 (2/2 candidates audited)
| Candidate | Predicted Class | Conf | Decision | Category | Observed Object |
|-----------|----------------|------|----------|----------|-----------------|
| crop-00 | Instrument_Aux_Panel (29) | 0.943 | FP | equipment_misclassification | Tank T-012 (rectangular vessel symbol) |
| crop-01 | Rupture_disk (22) | 0.814 | FP | equipment_misclassification | Pump P-006 with motor EM |

**Result:** 2/2 false positives (100% FP rate)

---

### sheet-2-p1 (4/4 candidates audited — visual inspection)
| Candidate | Predicted Class | Conf | Preliminary Decision | Observed Object |
|-----------|----------------|------|----------------------|-----------------|
| crop-00 | Rupture_disk (22) | 0.752 | FP | "NON ACTIVE LINE" annotation with cloud border |
| crop-01 | Rupture_disk (22) | 0.636 | FP | Valve assembly with multiple annotation bubbles (VLV-380195, NC, etc.) |
| crop-02 | Flange_or_Nozzle (21) | 0.328 | FP | Valve assembly with annotation bubbles (PCV-380001, PG-01, etc.) |
| crop-03 | Rupture_disk (22) | 0.270 | FP | Control valve assembly with annotation (PC V-003A, "SET @ 50 PSIG", pipe sizes) |

**Result:** 4/4 preliminary false positives (100% FP rate)

---

### sheet-7-model-p1 (3/5 candidates audited)
| Candidate | Predicted Class | Conf | Decision | Category | Observed Object |
|-----------|----------------|------|----------|----------|-----------------|
| crop-00 | Rupture_disk (22) | 0.905 | FP | equipment_misclassification | Pump P-004B with "NOTE 1" annotation |
| crop-01 | Instrument_Aux_Panel (29) | 0.782 | FP | equipment_misclassification | Vessel V-011 with valve assembly |
| crop-02 | Rupture_disk (22) | 0.643 | FP | equipment_misclassification | Pump P-004-A with "4"x6"" pipe annotation |

**Result (partial):** 3/3 audited are false positives (100% FP rate on inspected subset)

---

## Systematic False Positive Patterns

### Pattern 1: Equipment → Rupture_disk
**Frequency:** 8/18 inspected candidates (44%)  
**Confidence range:** 0.260 - 0.905  
**Affected equipment types:**
- Pumps (P-004B, P-006, P-004-A)
- Valves with annotation bubbles (VLV-380720, VLV-380698, VLV-380712, VLV-380711, VLV-380195)
- "NON ACTIVE LINE" annotation cloud

**Root cause hypothesis:** Rectangular or circular equipment outlines, especially when combined with annotation bubbles or text, trigger Rupture_disk false positives.

### Pattern 2: Revision Cloud / Annotation → Flange_or_Nozzle
**Frequency:** 6/18 inspected candidates (33%)  
**Confidence range:** 0.277 - 0.746  
**Affected objects:**
- Revision clouds (STR-38008, VLV-380715)
- Valve + annotation bubble assemblies (VLV-380710, VLV-380709, VLV-380695, VLV-380716)
- Control valve annotation (PCV-380001)

**Root cause hypothesis:** Cloud-shaped annotation borders and circular tag bubbles have visual similarity to flange/nozzle symbols.

### Pattern 3: Large Equipment → Instrument_Aux_Panel
**Frequency:** 4/18 inspected candidates (22%)  
**Confidence range:** 0.554 - 0.943  
**Affected equipment:**
- Tanks (T-004, T-012)
- Vessels (V-011 with valve assembly, appears twice across variants)

**Root cause hypothesis:** Rectangular equipment symbols with internal details or connected piping trigger instrument panel false positives.

---

## Precision Estimate (Preliminary)

| Metric | Value | Note |
|--------|-------|------|
| Inspected candidates | 18 / 81 | 22% of total |
| True positives | 0 / 18 | 0% |
| False positives | 18 / 18 | 100% |
| Observed precision | **0.00** | On inspected sample only |

**Confidence interval (Wilson score, 95%):** 0.00 - 0.19 (upper bound)

**Gate threshold:** Precision ≥ 0.80 at threshold 0.50

**Preliminary assessment:** If this pattern holds across all 81 candidates, the model **will fail the precision gate** by a wide margin.

---

## High-Confidence False Positives (conf ≥ 0.70)

All candidates with confidence ≥0.70 that have been inspected are false positives:

| Page | Candidate | Class | Conf | Category |
|------|-----------|-------|------|----------|
| sheet-7-p1 | crop-00 | Rupture_disk | 0.848 | equipment_misclassification |
| sheet-1-p1 | crop-00 | Instrument_Aux_Panel | 0.943 | equipment_misclassification |
| sheet-1-p1 | crop-01 | Rupture_disk | 0.814 | equipment_misclassification |
| sheet-2-p1 | crop-00 | Rupture_disk | 0.752 | revision_cloud |
| sheet-7-p1 | crop-01 | Flange_or_Nozzle | 0.746 | revision_cloud |
| sheet-7-p1 | crop-02 | Flange_or_Nozzle | 0.743 | revision_cloud |
| sheet-7-p1 | crop-03 | Flange_or_Nozzle | 0.734 | wrong_symbol |
| sheet-7-p1 | crop-04 | Instrument_Aux_Panel | 0.727 | equipment_misclassification |
| sheet-7-model-p1 | crop-00 | Rupture_disk | 0.905 | equipment_misclassification |
| sheet-7-model-p1 | crop-01 | Instrument_Aux_Panel | 0.782 | equipment_misclassification |

**High-confidence FP rate:** 10/10 inspected (100%)

**Gate requirement:** Audit all FP with confidence ≥0.70

---

## Recall Estimate (Not Yet Available)

Recall cannot be computed until:
1. Full-page scans identify all supported symbols that YOLO missed (false negatives)
2. Ground truth annotations are complete for all 12 pages

**Gate threshold:** Recall ≥ 0.50 at threshold 0.50

---

## Next Steps

### Immediate (Task #8 continuation)
1. Complete candidate audit for remaining 63 candidates (78 remaining after sheet-2-p1 formalization)
2. Prioritize high-risk pages: fire-water-p1/p2, sheet-4-p1, sheet-11-p1, sheet-12-p1
3. Formalize audit decisions in `candidate-audit-v1.json`
4. Full-page visual scan on all 12 pages to capture false negatives
5. Build `dataset-v1.json` from verified symbols only
6. Run validator (must exit 0 with zero errors)
7. Run evaluator at thresholds 0.25, 0.50, 0.75

### Gate Review
After evaluation completes:
1. Confirm systematic FP patterns across full dataset
2. Compute official precision/recall at threshold 0.50
3. Audit all FP with confidence ≥0.70 (already in progress for inspected subset)
4. Determine if Pump→Rupture_disk and Revision_cloud→Flange_or_Nozzle qualify as "systematic critical patterns"
5. Make gate decision based on official metrics

### Stage 2 Remains Blocked
No changes to production pipeline, worker, API, schema, queue, UI, or export until gate passes.

---

## Audit Traceability

**Audit log:** `fixtures/ground-truth/candidate-audit-v1.json`  
**Progress tracker:** `fixtures/ground-truth/annotation-progress.md`  
**Visual inspection crops:** `storage/annotation-inspection-crops/*/`  
**Preliminary findings:** This document

**Reviewed by:** Human annotator  
**Review date:** 2026-10-05  
**Next review:** After full 81-candidate audit complete
