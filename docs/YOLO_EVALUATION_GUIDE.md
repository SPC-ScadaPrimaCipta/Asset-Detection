# YOLO Model Accuracy Evaluation — Ground Truth Annotation Guide

**Last Updated:** 2026-10-02  
**Status:** Stage 1.5 — Model accuracy baseline (Pre-Stage 2 blocker)

---

## Purpose

Measure YOLO model accuracy against manually annotated P&ID pages to determine whether the model is fit to become a V3.0 primary detection engine.

**OFFLINE ONLY.** This evaluation harness does NOT integrate with the production detection pipeline. No changes to workers, API, database, UI, or export.

---

## Annotation Requirements

### Minimum Dataset

- **≥10 P&ID pages** from representative projects
- Multiple drawing styles if available (different plants, vendors, standards)
- Coverage of symbols the YOLO model DOES support (see supported classes below)
- Includes common noise: revision clouds, title blocks, notes, text annotations, grid lines, borders

### What to Annotate

**Only annotate symbols for classes the YOLO model actually supports.**

The model has 32 classes (IDs 0-31). **Do NOT annotate:**
- Pump, Vessel, Tank, Compressor, Heat Exchanger, Fan, Motor (not in model)
- Process flow relationships, piping runs, or connections
- Text labels, tags, or descriptions (OCR scope, not YOLO)

**DO annotate** (supported classes):
- Valves: Gate, Ball, Globe, Butterfly, Plug, Check, Diaphragm, Needle, Control, Rotary
- Valve states: NC (normally closed), NO (normally open), half-filled
- Blinds: Paddle blind, Spectacle blind (open/closed)
- Rupture disk
- Reducer
- Flange/Nozzle
- Sight glass
- Instruments: Field, Panel, Auxiliary Panel, Box
- Flow arrow
- Pipe insulation/tracing

**Class ID reference:** `lib/detection/yolo/yolo-class-map.ts`

### Annotation Rules

1. **Draw tight bounding boxes** around the symbol only, not including:
   - Nearby tags (e.g. "V-101")
   - Connection lines
   - Annotation clouds
   - Labels or notes

2. **Use source pixel coordinates** of the rendered PNG (not normalized 0-1000)

3. **One bbox per symbol instance** — don't skip duplicates

4. **Use canonical class IDs** (0-31):
   - Class 5 → use class 3 (Globe_valve_NO duplicate)
   - Class 27 → use class 26 (Instrument_Field duplicate)
   - Class 31 → use class 28 (Instrument_Panel duplicate)

5. **Skip class 0** (Not_used) — never annotate

6. **When uncertain about a symbol**, add a `note` field explaining ambiguity, but include the bbox so it counts in the dataset

---

## Ground Truth JSON Format

```json
{
  "description": "YOLO accuracy baseline v1 — 10 representative P&ID pages",
  "iouThreshold": 0.50,
  "pages": [
    {
      "pageId": "project-a-sheet-7",
      "imagePath": "fixtures/pid-eval/project-a-sheet-7.png",
      "width": 3573,
      "height": 2526,
      "annotations": [
        {
          "id": "gt-001",
          "classId": 1,
          "label": "Gate_Valve",
          "bbox": {
            "x": 1250,
            "y": 840,
            "width": 86,
            "height": 62
          }
        },
        {
          "id": "gt-002",
          "classId": 22,
          "label": "Rupture_disk",
          "bbox": {
            "x": 2131,
            "y": 1967,
            "width": 166,
            "height": 73
          },
          "note": "High confidence but visually ambiguous with pump symbol"
        },
        {
          "id": "gt-003",
          "classId": 21,
          "label": "Flange_or_Nozzle",
          "bbox": {
            "x": 2064,
            "y": 977,
            "width": 122,
            "height": 49
          }
        }
      ]
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | No | Dataset version, annotation rules used |
| `iouThreshold` | number | No | Default 0.50; IoU ≥ this = match |
| `pages` | array | **Yes** | List of annotated pages |
| `pages[].pageId` | string | **Yes** | Stable page identifier |
| `pages[].imagePath` | string | **Yes** | Relative path from JSON file to rendered PNG |
| `pages[].width` | number | **Yes** | Rendered image width (px) |
| `pages[].height` | number | **Yes** | Rendered image height (px) |
| `pages[].annotations` | array | **Yes** | GT symbols on this page |
| `annotations[].id` | string | **Yes** | Unique within page, e.g. "gt-001" |
| `annotations[].classId` | number | **Yes** | Canonical YOLO class (0-31) |
| `annotations[].label` | string | **Yes** | Human-readable class name |
| `annotations[].bbox.x` | number | **Yes** | Top-left X (source pixels) |
| `annotations[].bbox.y` | number | **Yes** | Top-left Y (source pixels) |
| `annotations[].bbox.width` | number | **Yes** | Width (source pixels) |
| `annotations[].bbox.height` | number | **Yes** | Height (source pixels) |
| `annotations[].note` | string | No | Free text for ambiguous cases |

---

## Workflow

### 1. Prepare Pages

Render each P&ID page to PNG at 3.0× scale (same as production detection):

```bash
npx tsx scripts/render-pages-for-annotation.ts <pdf-path> <output-dir>
```

This outputs:
- `page_1.png`, `page_2.png`, etc.
- `metadata.json` (width, height per page)

### 2. Annotate

Use an annotation tool (labelImg, CVAT, or manual JSON editing) to draw bounding boxes.

**Recommendation:** Use [labelImg](https://github.com/HumanSignal/labelImg) (supports YOLO format, converts to JSON).

Export as JSON matching the schema above.

### 3. Validate

Validate schema before running evaluation:

```bash
npx tsx scripts/validate-ground-truth.ts fixtures/ground-truth/dataset-v1.json
```

This checks:
- All image paths exist
- All class IDs are 0-31
- All bboxes are within page bounds
- No duplicate annotation IDs
- At least 10 pages (acceptance gate requirement)

### 4. Run Evaluation

```bash
npx tsx --env-file=.env.local scripts/yolo-evaluate.ts \
  fixtures/ground-truth/dataset-v1.json \
  --output ./eval-results \
  --thresholds 0.25,0.50,0.75
```

Output:
- `evaluation-report.json` — full structured metrics
- `conf_50/per_class.csv` — per-class TP/FP/FN/precision/recall/F1
- `conf_50/per_page.csv` — per-page metrics
- `conf_50/<pageId>_annotated.png` — visual overlays (TP green, FP red, FN magenta)

---

## Acceptance Gate (Threshold 0.50)

Before Stage 2 integration, the model must meet:

| Criterion | Minimum | Purpose |
|-----------|---------|---------|
| Dataset size | ≥10 pages | Statistically meaningful |
| Global precision | ≥0.80 | Few false alarms |
| Global recall | ≥0.50 | Catches half of existing symbols |
| Critical FPs (conf ≥0.70) | 0 systematic | No pump→rupture disk, text→symbol patterns |
| Per-class reporting | All classes | Identify weak classes |
| Insufficient sample flag | <5 GT instances | Don't judge sparse classes |

**If gate fails:**
- DO NOT lower threshold to inflate recall
- DO NOT integrate YOLO into production pipeline
- DO NOT rely on Legend filter to "fix" model accuracy
- Document model limitations
- Consider model as low-confidence supporting signal only OR retain V2.0 Gemini-only until better model available

---

## False Positive Categorization

Every FP must be manually classified during report review:

| Category | Description | Example |
|----------|-------------|---------|
| `wrong_symbol` | Correct symbol type, wrong instance | Two adjacent valves, model detected one twice |
| `text_annotation` | Model detected text/label as symbol | Tag "V-101" classified as valve |
| `revision_cloud` | Annotation/markup detected as symbol | Revision cloud classified as flange |
| `title_block` | Title block elements as symbols | Border detail classified as instrument |
| `border_or_grid` | Grid lines, borders, frame | Grid crossing classified as symbol |
| `line_or_connection` | Piping/connection line as symbol | Elbow detected as valve |
| `equipment_misclassification` | Real equipment, wrong class | Pump detected as rupture disk (critical!) |
| `unknown` | Cannot determine cause | New noise pattern |

**Large `unknown` bucket = taxonomy is incomplete.**

Update categories as patterns emerge from real evaluation data.

---

## Example Datasets

### Starter Template (Empty)

```json
{
  "description": "YOLO accuracy baseline v1",
  "iouThreshold": 0.50,
  "pages": []
}
```

Save as `fixtures/ground-truth/dataset-v1.json` and populate `pages` array.

### Current Fixture (1 page)

`storage/18870d45-f7a6-497d-9f34-e0fabb45f53e-SP_PDT_Sheet_7-REV.pdf` is rendered in golden test.

Visual inspection found:
- Detection #0 (cls22 Rupture_disk, conf=0.848) → **FALSE** (actually pump P-004B)
- Detection #1 (cls21 Flange_or_Nozzle, conf=0.746) → **FALSE** (revision cloud text)

Annotate this page + 9 more to reach minimum 10 pages.

---

## Tools & Scripts

| Script | Purpose |
|--------|---------|
| `scripts/render-pages-for-annotation.ts` | Render PDF → PNG at eval scale |
| `scripts/validate-ground-truth.ts` | Schema validator |
| `scripts/yolo-evaluate.ts` | Run evaluation |
| `scripts/yolo-golden-crops.ts` | Visual crop verification (dev helper) |
| `lib/detection/eval/types.ts` | TypeScript schema |
| `lib/detection/eval/matcher.ts` | IoU matching logic |
| `lib/detection/eval/runner.ts` | Evaluation orchestrator |

---

## Notes

- **This is NOT OCR evaluation** — only visual symbol detection
- **This is NOT production integration** — results inform go/no-go decision for Stage 2
- Annotation is manual — expect 1-2 hours per page for careful work
- Save intermediate progress (commit JSON after each page)
- Visual crops (`yolo-golden-crops.ts`) help verify ambiguous symbols before annotation

---

## Next Steps After Evaluation

1. **If gate passes:** Proceed to Stage 2 (Legend filter, OCR, template matching, evidence fusion)
2. **If gate fails:** Document findings, consider mitigation strategies (confidence tuning, bbox filters, area exclusions), or recommend model improvement/replacement before production integration
3. **Either way:** Commit ground truth dataset and evaluation report to version control for repeatability
