# Ground Truth Annotation Progress (Task #8)

Offline annotation tracking for 12 evaluation pages.
Dataset schema target: `fixtures/ground-truth/dataset-v1.json` (via draft `dataset-v1.draft.json`).

| # | Page ID | Source Document | Status | Inspection Notes |
|---|---------|-----------------|--------|------------------|
| 1 | `sheet-7-p1` | SP Pondok Tengah Sheet 7 | `in_progress` | Candidate audit complete (13/13; all false positives). Full-page scan and supported-symbol annotation still required. Repeated high-risk false-positive patterns observed in preliminary audit. |
| 2 | `sheet-7-rev-p1` | Sheet 7 REV variant | `in_progress` | 13 YOLO candidates (5 Rupture_disk, 6 Flange_or_Nozzle) — Same drawing revision |
| 3 | `sheet-7-model-p1` | Sheet 7 Model variant | `pending` | 5 YOLO candidates (2 Rupture_disk, 1 Control Valve, 1 Flange, 1 Aux Panel) |
| 4 | `sheet-2-p1` | SP Pondok Tengah Sheet 2 | `pending` | 4 YOLO candidates (3 Rupture_disk, 1 Flange_or_Nozzle) — Audit 3 Rupture_disk for equipment outlines |
| 5 | `fire-water-p1` | Fire Water Page 1 | `pending` | 11 YOLO candidates (4 Flow Arrow, 2 Flange, 2 Rupture_disk, 1 Half Filled Gate, 1 Ball NC) |
| 6 | `fire-water-p2` | Fire Water Page 2 | `pending` | 6 YOLO candidates (2 Instrument Panel, 2 Aux Panel, 1 Box, 1 Rupture_disk) |
| 7 | `sheet-4-p1` | SP Pondok Tengah Sheet 4 | `pending` | 10 YOLO candidates (4 Instrument Panel, 3 Aux Panel, 1 Globe NC, 1 Reducer, 1 Rupture_disk) |
| 8 | `sheet-3-p1` | SP Pondok Tengah Sheet 3 | `pending` | 0 YOLO candidates — Full visual scan required (check for undetected valves/instruments) |
| 9 | `sheet-1-p1` | SP Pondok Tengah Sheet 1 | `pending` | 2 YOLO candidates (1 Aux Panel, 1 Rupture_disk) |
| 10 | `sheet-5-p1` | SP Pondok Tengah Sheet 5 | `pending` | 1 YOLO candidate (1 Spectacle Blind Open) |
| 11 | `sheet-11-p1` | SP Pondok Tengah Sheet 11 | `pending` | 8 YOLO candidates (4 Flow Arrow, 2 Rupture_disk, 1 Flange, 1 Half Filled Gate) |
| 12 | `sheet-12-p1` | SP Pondok Tengah Sheet 12 | `pending` | 8 YOLO candidates (5 Aux Panel, 1 Box, 1 Reducer, 1 Rupture_disk) |

## Annotation Criteria Checklist
- [ ] Only 28 canonical supported class IDs (1..30 excluding 0, 5, 27, 31, 32+)
- [ ] Source pixel coordinate system (3573 x 2526)
- [ ] Bounding boxes tightly wrap symbols only (no tag text, no connected pipes)
- [ ] Zero pump/motor/equipment annotated as Rupture_disk
- [ ] Zero revision cloud/text/grid annotated as Flange_or_Nozzle
- [ ] Manual scan completed for missed symbols on all 12 pages
