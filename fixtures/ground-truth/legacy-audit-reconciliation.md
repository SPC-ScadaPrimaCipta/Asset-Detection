# Legacy Audit Reconciliation & Dataset Boundary Report (v1 → v203)

**Document Status:** Historical Audit Record & Reconciliation  
**Source Baseline:** `fixtures/ground-truth/candidate-audit-v1.json`  
**Quality Gate Status for v203:** `NOT EVALUATED`

---

## 1. Executive Summary & Historical Audit Status

`candidate-audit-v1.json` represents an offline audit of candidate bounding boxes proposed by the legacy YOLO model (`yolo-pid-v8n.onnx`, 640×640 letterbox, 32 output classes). 

### Audit Breakdown (81 Candidate Decisions)
- **Total Candidates Audited:** 81
- **True Positives (TP):** 4 (4.94%)
- **False Positives (FP):** 76 (93.83%)
- **Wrong Class:** 1 (1.23% — candidate recovered as `Gate_Valve_NC`)

### Resolution of Stale Progress Tracker
In `fixtures/ground-truth/audit-findings-preliminary.md`, progress was recorded as **18/81 candidates inspected**. This represented an interim snapshot report during the initial audit phase (inspecting `sheet-7-p1`, `sheet-1-p1`, and part of `sheet-2-p1`). The subsequent audit batches completed all 81 candidate reviews, which are fully recorded in `candidate-audit-v1.json`.

---

## 2. Scope & Limitations of the Legacy Audit

1. **Candidate-Bounded Review Only:**  
   The 81 audited records were derived solely from the candidate bounding boxes proposed by the legacy 640×640 YOLO model at confidence threshold $\ge 0.25$.  
   **This audit does NOT represent a full-page object enumeration of the P&ID sheets.** Undetected physical symbols, instruments, and equipment (False Negatives) were not systematically annotated across all 12 sheets.

2. **Systematic False Positive Categories in Legacy Model:**
   - **Equipment Misclassification:** Process equipment (Pumps, Vessels, Tanks) misidentified as `Rupture_disk` (Class 22) or `Instrument_Aux_Panel` (Class 29).
   - **Drawing Markup & Revision Clouds:** Revisions, cloud boundaries, and line markers misidentified as `Flange_or_Nozzle` (Class 21).
   - **Multi-symbol Assemblies:** Valve and instrument bubbles in close proximity misidentified as composite single symbols.

---

## 3. Strict Boundary Rules for v203

1. **No Automatic Decision Carry-over:**  
   Decisions recorded in `candidate-audit-v1.json` **must NOT** be converted, copied, or assumed valid for the v203 model.
2. **Architectural & Spatial Separation:**  
   - The legacy model operated on 640×640 letterboxed images with a 32-class vocabulary.
   - The v203 model operates on native 1024×1024 sliding-window tiles (zero resize) with a 203-class vocabulary.
   - Candidate coordinates, receptive fields, feature maps, and class semantics differ fundamentally.
3. **Preservation of v1 Records:**  
   `candidate-audit-v1.json` is maintained strictly as an immutable historical audit artifact.
