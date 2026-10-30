"""
Pilot comparison with coordinate-corrected Gemini bbox (transform B).
Writes two exclusive artefacts:
  fixtures/diagnostics/pilot-sheet-1-p1-v3/discovery-coordinate-corrected.json
  fixtures/diagnostics/pilot-sheet-1-p1-v3/comparison-coordinate-corrected.json

No API calls, no inference, no modification of existing artefacts.
"""

import json, math, os
from pathlib import Path

# ── paths ─────────────────────────────────────────────────────────────────────
REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "fixtures" / "diagnostics" / "pilot-sheet-1-p1-v3"
CORRECTED_PATH = OUT_DIR / "discovery-coordinate-corrected.json"
COMPARISON_PATH = OUT_DIR / "comparison-coordinate-corrected.json"

W, H = 3573.0, 2526.0
TRANSFORM_FORMULA = "x_px = x_raw / 1000 * 3573 ; y_px = y_raw / 1000 * 2526"
TRANSFORM_REF = "fixtures/diagnostics/pilot-sheet-1-p1-v3/bbox-overlay-diagnostic/coordinate-transform-diagnostic.json"

# ── 29 Gemini v3 candidates (raw bbox, normalized 0–1000) ────────────────────
GEMINI_RAW = [
  dict(id="discovery-001-001",type="Vessel",tag="V-001",conf=0.99,x1=605,y1=178,x2=661,y2=313),
  dict(id="discovery-001-002",type="Vessel",tag="V-002",conf=0.99,x1=530,y1=558,x2=606,y2=692),
  dict(id="discovery-001-003",type="Tank",tag="T-012",conf=0.99,x1=453,y1=128,x2=492,y2=181),
  dict(id="discovery-001-004",type="Positive Displacement Pump",tag="P-006",conf=0.95,x1=435,y1=232,x2=472,y2=260),
  dict(id="discovery-001-005",type="Electric Motor",tag="M-001A",conf=0.90,x1=210,y1=222,x2=227,y2=240),
  dict(id="discovery-001-006",type="Electric Motor",tag="M-001A",conf=0.90,x1=249,y1=302,x2=266,y2=320),
  dict(id="discovery-001-007",type="Electric Motor",tag="M-001B",conf=0.90,x1=249,y1=382,x2=266,y2=400),
  dict(id="discovery-001-008",type="Electric Motor",tag="M-001G",conf=0.90,x1=249,y1=462,x2=266,y2=480),
  dict(id="discovery-001-009",type="Electric Motor",tag="M-001D",conf=0.90,x1=249,y1=530,x2=266,y2=548),
  dict(id="discovery-001-010",type="Electric Motor",tag="M-001E",conf=0.90,x1=249,y1=600,x2=266,y2=618),
  dict(id="discovery-001-011",type="Electric Motor",tag="M-001F",conf=0.90,x1=249,y1=670,x2=266,y2=688),
  dict(id="discovery-001-012",type="Electric Motor",tag="M-001H",conf=0.90,x1=249,y1=810,x2=266,y2=828),
  dict(id="discovery-001-013",type="Pressure Safety Valve",tag="PSV-001",conf=0.95,x1=583,y1=133,x2=601,y2=154),
  dict(id="discovery-001-014",type="Pressure Safety Valve",tag="PSV-002",conf=0.95,x1=579,y1=490,x2=597,y2=511),
  dict(id="discovery-001-015",type="Level Control Valve",tag="LCV-001",conf=0.95,x1=693,y1=361,x2=713,y2=393),
  dict(id="discovery-001-016",type="Level Control Valve",tag="LCV-002",conf=0.95,x1=741,y1=732,x2=759,y2=761),
  dict(id="discovery-001-017",type="Pressure Control Valve",tag="PCV-001",conf=0.95,x1=855,y1=234,x2=877,y2=266),
  dict(id="discovery-001-018",type="Pressure Control Valve",tag="PCV-002",conf=0.95,x1=612,y1=791,x2=634,y2=823),
  dict(id="discovery-001-019",type="Flow Element",tag=None,conf=0.90,x1=847,y1=182,x2=858,y2=204),
  dict(id="discovery-001-020",type="Flow Element",tag=None,conf=0.90,x1=591,y1=841,x2=603,y2=863),
  dict(id="discovery-001-021",type="Temperature Indicator",tag="TI-001",conf=0.90,x1=595,y1=234,x2=608,y2=249),
  dict(id="discovery-001-022",type="Pressure Indicator",tag="PI-001",conf=0.90,x1=662,y1=127,x2=676,y2=142),
  dict(id="discovery-001-023",type="Level Indicator",tag="LG",conf=0.90,x1=730,y1=268,x2=743,y2=281),
  dict(id="discovery-001-024",type="Level Indicator",tag="LG",conf=0.90,x1=569,y1=612,x2=582,y2=625),
  dict(id="discovery-001-025",type="Level Controller",tag="LIC-001",conf=0.90,x1=772,y1=196,x2=790,y2=217),
  dict(id="discovery-001-026",type="Level Controller",tag="LIC-002",conf=0.90,x1=791,y1=558,x2=809,y2=580),
  dict(id="discovery-001-027",type="Check Valve",tag=None,conf=0.85,x1=465,y1=242,x2=483,y2=252),
  dict(id="discovery-001-028",type="Gate Valve",tag=None,conf=0.85,x1=498,y1=241,x2=516,y2=253),
  dict(id="discovery-001-029",type="Check Valve",tag=None,conf=0.85,x1=194,y1=222,x2=208,y2=234),
]

# ── 60 YOLO predictions (pageBox, source-pixel) ───────────────────────────────
YOLO = [
  dict(id="sheet-1-p1-pred-0000",label="valve.ball.iso",conf=0.977,x1=2640.64,y1=987.30,x2=2686.23,y2=1014.97),
  dict(id="sheet-1-p1-pred-0001",label="valve.ball.iso",conf=0.946,x1=2329.97,y1=988.46,x2=2379.07,y2=1016.19),
  dict(id="sheet-1-p1-pred-0002",label="valve.ball.iso",conf=0.930,x1=2751.49,y1=1067.76,x2=2801.55,y2=1094.37),
  dict(id="sheet-1-p1-pred-0003",label="valve.pneumatic_diaphragm_globe.niso",conf=0.910,x1=3021.60,y1=577.09,x2=3074.19,y2=621.32),
  dict(id="sheet-1-p1-pred-0004",label="valve.ball.iso",conf=0.881,x1=2423.44,y1=988.61,x2=2473.85,y2=1015.81),
  dict(id="sheet-1-p1-pred-0005",label="valve.ball.iso",conf=0.860,x1=2549.35,y1=1479.96,x2=2592.02,y2=1511.14),
  dict(id="sheet-1-p1-pred-0006",label="valve.ball.iso",conf=0.846,x1=1676.45,y1=1382.37,x2=1699.50,y2=1426.52),
  dict(id="sheet-1-p1-pred-0007",label="valve.pneumatic_diaphragm_globe.niso",conf=0.831,x1=2617.99,y1=1831.62,x2=2666.67,y2=1882.57),
  dict(id="sheet-1-p1-pred-0008",label="valve.ball.iso",conf=0.824,x1=2371.67,y1=2033.32,x2=2410.54,y2=2057.11),
  dict(id="sheet-1-p1-pred-0009",label="valve.ball.iso",conf=0.820,x1=2514.37,y1=836.60,x2=2563.84,y2=864.90),
  dict(id="sheet-1-p1-pred-0010",label="valve.ball.iso",conf=0.807,x1=2644.10,y1=1639.97,x2=2694.99,y2=1668.70),
  dict(id="sheet-1-p1-pred-0011",label="valve.ball.iso",conf=0.783,x1=1880.65,y1=511.58,x2=1925.36,y2=538.41),
  dict(id="sheet-1-p1-pred-0012",label="valve.ball.iso",conf=0.763,x1=2344.93,y1=1357.13,x2=2394.96,y2=1383.17),
  dict(id="sheet-1-p1-pred-0013",label="valve.ball.iso",conf=0.753,x1=2343.05,y1=1921.63,x2=2384.05,y2=1945.20),
  dict(id="sheet-1-p1-pred-0014",label="valve.manual_operated.pip",conf=0.732,x1=2605.83,y1=755.84,x2=2659.19,y2=797.09),
  dict(id="sheet-1-p1-pred-0015",label="valve.3way_gate.niso",conf=0.726,x1=2481.56,y1=1643.14,x2=2512.89,y2=1684.31),
  dict(id="sheet-1-p1-pred-0016",label="valve.ball.iso",conf=0.710,x1=794.08,y1=2056.51,x2=830.89,y2=2079.12),
  dict(id="sheet-1-p1-pred-0017",label="valve.pneumatic_diaphragm_globe.niso",conf=0.707,x1=2123.88,y1=2000.07,x2=2163.38,y2=2057.46),
  dict(id="sheet-1-p1-pred-0018",label="valve.ball.iso",conf=0.705,x1=3048.59,y1=720.89,x2=3088.53,y2=750.72),
  dict(id="sheet-1-p1-pred-0019",label="valve.general.iso",conf=0.703,x1=1257.89,y1=500.64,x2=1280.34,y2=542.74),
  dict(id="sheet-1-p1-pred-0020",label="valve.check.pip",conf=0.684,x1=644.04,y1=929.49,x2=702.36,y2=959.16),
  dict(id="sheet-1-p1-pred-0021",label="valve.ball.iso",conf=0.683,x1=2917.80,y1=1476.89,x2=2960.61,y2=1501.64),
  dict(id="sheet-1-p1-pred-0022",label="valve.ball.iso",conf=0.670,x1=1371.41,y1=1166.78,x2=1423.91,y2=1195.20),
  dict(id="sheet-1-p1-pred-0023",label="valve.ball.iso",conf=0.659,x1=2343.13,y1=1740.77,x2=2399.41,y2=1766.71),
  dict(id="sheet-1-p1-pred-0024",label="equipment.pump.niso",conf=0.651,x1=998.05,y1=971.01,x2=1023.93,y2=993.84),
  dict(id="sheet-1-p1-pred-0025",label="valve.ball.iso",conf=0.637,x1=793.83,y1=713.99,x2=831.96,y2=737.16),
  dict(id="sheet-1-p1-pred-0026",label="valve.ball.iso",conf=0.631,x1=791.81,y1=842.43,x2=834.64,y2=866.65),
  dict(id="sheet-1-p1-pred-0027",label="valve.ball.iso",conf=0.631,x1=2916.41,y1=1549.97,x2=2960.82,y2=1573.44),
  dict(id="sheet-1-p1-pred-0028",label="valve.ball.iso",conf=0.629,x1=998.16,y1=971.88,x2=1042.39,y2=995.84),
  dict(id="sheet-1-p1-pred-0029",label="valve.ball.iso",conf=0.622,x1=793.92,y1=1826.79,x2=829.07,y2=1852.49),
  dict(id="sheet-1-p1-pred-0030",label="valve.ball.iso",conf=0.619,x1=1067.87,y1=555.14,x2=1090.33,y2=597.25),
  dict(id="sheet-1-p1-pred-0031",label="valve.ball.iso",conf=0.616,x1=2724.73,y1=736.61,x2=2783.11,y2=767.67),
  dict(id="sheet-1-p1-pred-0032",label="valve.ball.iso",conf=0.608,x1=792.39,y1=1942.24,x2=831.43,y2=1966.28),
  dict(id="sheet-1-p1-pred-0033",label="valve.ball.iso",conf=0.597,x1=2597.73,y1=1273.50,x2=2621.07,y2=1317.20),
  dict(id="sheet-1-p1-pred-0034",label="valve.ball.iso",conf=0.576,x1=1371.96,y1=1897.96,x2=1421.06,y2=1926.45),
  dict(id="sheet-1-p1-pred-0035",label="valve.check.pip",conf=0.575,x1=2632.10,y1=1693.49,x2=2662.00,y2=1731.10),
  dict(id="sheet-1-p1-pred-0036",label="valve.ball.iso",conf=0.566,x1=1370.24,y1=1532.45,x2=1423.17,y2=1559.46),
  dict(id="sheet-1-p1-pred-0037",label="valve.ball.iso",conf=0.562,x1=2335.77,y1=1091.95,x2=2373.90,y2=1116.02),
  dict(id="sheet-1-p1-pred-0038",label="valve.butterfly.niso",conf=0.559,x1=646.66,y1=672.00,x2=705.38,y2=699.46),
  dict(id="sheet-1-p1-pred-0039",label="valve.ball.iso",conf=0.558,x1=1373.42,y1=1642.11,x2=1421.05,y2=1669.58),
  dict(id="sheet-1-p1-pred-0040",label="valve.ball.iso",conf=0.557,x1=998.52,y1=714.87,x2=1042.24,y2=737.64),
  dict(id="sheet-1-p1-pred-0041",label="valve.pneumatic_diaphragm_globe.niso",conf=0.556,x1=2534.85,y1=962.59,x2=2576.71,y2=1010.17),
  dict(id="sheet-1-p1-pred-0042",label="valve.ball.iso",conf=0.553,x1=1377.97,y1=929.59,x2=1420.07,y2=955.55),
  dict(id="sheet-1-p1-pred-0043",label="valve.ball.iso",conf=0.550,x1=1779.14,y1=643.03,x2=1821.82,y2=672.29),
  dict(id="sheet-1-p1-pred-0044",label="valve.ball.iso",conf=0.545,x1=999.10,y1=843.88,x2=1041.40,y2=867.01),
  dict(id="sheet-1-p1-pred-0045",label="valve.ball.iso",conf=0.543,x1=791.27,y1=1458.76,x2=832.37,y2=1482.94),
  dict(id="sheet-1-p1-pred-0046",label="valve.ball.iso",conf=0.541,x1=2198.59,y1=2031.79,x2=2240.66,y2=2059.70),
  dict(id="sheet-1-p1-pred-0047",label="valve.ball.iso",conf=0.538,x1=2684.80,y1=2060.97,x2=2711.26,y2=2112.88),
  dict(id="sheet-1-p1-pred-0048",label="valve.ball.iso",conf=0.530,x1=2943.30,y1=1024.67,x2=2968.27,y2=1074.51),
  dict(id="sheet-1-p1-pred-0049",label="valve.ball.iso",conf=0.529,x1=993.39,y1=1459.27,x2=1045.97,y2=1485.84),
  dict(id="sheet-1-p1-pred-0050",label="valve.ball.iso",conf=0.529,x1=2545.46,y1=1922.33,x2=2582.25,y2=1942.92),
  dict(id="sheet-1-p1-pred-0051",label="valve.ball.iso",conf=0.527,x1=956.65,y1=1865.13,x2=979.47,y2=1909.06),
  dict(id="sheet-1-p1-pred-0052",label="valve.ball.iso",conf=0.526,x1=1379.97,y1=1052.51,x2=1418.38,y2=1076.42),
  dict(id="sheet-1-p1-pred-0053",label="valve.ball.iso",conf=0.525,x1=2963.83,y1=926.74,x2=2987.44,y2=981.05),
  dict(id="sheet-1-p1-pred-0054",label="valve.pneumatic_diaphragm_globe.niso",conf=0.524,x1=956.83,y1=1595.01,x2=997.26,y2=1625.59),
  dict(id="sheet-1-p1-pred-0055",label="valve.ball.iso",conf=0.516,x1=2715.47,y1=1691.08,x2=2744.91,y2=1733.29),
  dict(id="sheet-1-p1-pred-0056",label="valve.ball.iso",conf=0.516,x1=2635.86,y1=1508.15,x2=2685.09,y2=1539.01),
  dict(id="sheet-1-p1-pred-0057",label="valve.ball.iso",conf=0.512,x1=2983.41,y1=626.17,x2=3017.28,y2=648.50),
  dict(id="sheet-1-p1-pred-0058",label="valve.ball.iso",conf=0.510,x1=792.73,y1=1686.45,x2=831.42,y2=1710.85),
  dict(id="sheet-1-p1-pred-0059",label="valve.general.iso",conf=0.510,x1=2664.35,y1=765.16,x2=2703.46,y2=790.35),
]

# ── class mapping (explicit, from artefacts) ──────────────────────────────────
CLASS_MAP = {
  "equipment.pump.niso":                    dict(gemini_types=["Positive Displacement Pump","Pump"], confidence="partial"),
  "valve.check.pip":                         dict(gemini_types=["Check Valve"], confidence="partial"),
  "valve.pneumatic_diaphragm_globe.niso":   dict(gemini_types=["Level Control Valve","Pressure Control Valve"], confidence="partial"),
  "valve.pressure_relief.pip":              dict(gemini_types=["Pressure Safety Valve"], confidence="partial"),
  "valve.control.iso":                       dict(gemini_types=["Level Control Valve","Pressure Control Valve"], confidence="partial"),
  "instrument.orifice.pip":                 dict(gemini_types=["Flow Element"], confidence="partial"),
  "valve.ball.iso":                          dict(gemini_types=["Gate Valve"], confidence="uncertain"),
  "valve.general.iso":                       dict(gemini_types=["Gate Valve"], confidence="uncertain"),
}
UNMAPPED_YOLO = {"valve.3way_gate.niso","valve.butterfly.niso","valve.manual_operated.pip","valve.angle.iso"}
YOLO_ONLY_GEMINI_TYPES = {"Vessel","Tank","Electric Motor","Temperature Indicator",
                           "Pressure Indicator","Level Indicator","Level Controller","Flow Element"}

def iou(ax1,ay1,ax2,ay2, bx1,by1,bx2,by2):
    ix1,iy1 = max(ax1,bx1), max(ay1,by1)
    ix2,iy2 = min(ax2,bx2), min(ay2,by2)
    if ix2<=ix1 or iy2<=iy1: return 0.0
    inter=(ix2-ix1)*(iy2-iy1)
    a=(ax2-ax1)*(ay2-ay1); b=(bx2-bx1)*(by2-by1)
    return inter/(a+b-inter)

def class_relation(gemini_type, yolo_label):
    if yolo_label in UNMAPPED_YOLO:
        return "yolo_unmapped"
    mapping = CLASS_MAP.get(yolo_label)
    if mapping is None:
        return "yolo_unmapped"
    if gemini_type in mapping["gemini_types"]:
        return f"class_match_{mapping['confidence']}"
    return "class_conflict"

# ── Step 1: convert + validate all 29 ────────────────────────────────────────
corrected_entries = []
valid_entries = []
invalid_entries = []

for g in GEMINI_RAW:
    cx1 = round(g["x1"]/1000.0*W, 2)
    cy1 = round(g["y1"]/1000.0*H, 2)
    cx2 = round(g["x2"]/1000.0*W, 2)
    cy2 = round(g["y2"]/1000.0*H, 2)

    violations = []
    if not (math.isfinite(cx1) and math.isfinite(cy1) and math.isfinite(cx2) and math.isfinite(cy2)):
        violations.append("non-finite value")
    if cx1 >= cx2: violations.append(f"x1({cx1}) >= x2({cx2})")
    if cy1 >= cy2: violations.append(f"y1({cy1}) >= y2({cy2})")
    if cx1 < 0 or cx2 > W: violations.append(f"x out of image bounds [0,{W}]")
    if cy1 < 0 or cy2 > H: violations.append(f"y out of image bounds [0,{H}]")

    entry = {
        "candidateId": g["id"],
        "assetType": g["type"],
        "assetTag": g["tag"],
        "confidence": g["conf"],
        "rawBbox": {"x1":g["x1"],"y1":g["y1"],"x2":g["x2"],"y2":g["y2"]},
        "convertedBbox": {"x1":cx1,"y1":cy1,"x2":cx2,"y2":cy2},
        "bboxAreaPx": round((cx2-cx1)*(cy2-cy1),1) if not violations else None,
        "coordinateSpaceRaw": "normalized-0-1000",
        "coordinateSpaceConverted": "source-pixel",
        "transformFormula": TRANSFORM_FORMULA,
        "transformReference": TRANSFORM_REF,
        "bboxValid": len(violations)==0,
        "bboxViolations": violations,
    }
    corrected_entries.append(entry)
    if entry["bboxValid"]:
        valid_entries.append(entry)
    else:
        invalid_entries.append(entry)

print(f"Validation: {len(valid_entries)} valid, {len(invalid_entries)} invalid")

# ── Step 2: one-to-one greedy matching (YOLO sorted by conf desc) ─────────────
IoU_THRESHOLD = 0.15
yolo_sorted = sorted(YOLO, key=lambda y: y["conf"], reverse=True)
yolo_matched = {}
gemini_matched = {}
pairs = []

for g in valid_entries:
    cx1,cy1,cx2,cy2 = g["convertedBbox"]["x1"],g["convertedBbox"]["y1"],g["convertedBbox"]["x2"],g["convertedBbox"]["y2"]
    best_iou, best_y = 0.0, None
    for y in yolo_sorted:
        if y["id"] in yolo_matched: continue
        i = iou(cx1,cy1,cx2,cy2, y["x1"],y["y1"],y["x2"],y["y2"])
        if i > best_iou:
            best_iou, best_y = i, y
    if best_iou >= IoU_THRESHOLD and best_y:
        gemini_matched[g["candidateId"]] = True
        yolo_matched[best_y["id"]] = True
        cr = class_relation(g["assetType"], best_y["label"])
        pairs.append({
            "gemini_id": g["candidateId"],
            "gemini_type": g["assetType"],
            "gemini_tag": g["assetTag"],
            "gemini_convertedBbox": {"x1":cx1,"y1":cy1,"x2":cx2,"y2":cy2},
            "gemini_bboxAreaPx": g["bboxAreaPx"],
            "yolo_id": best_y["id"],
            "yolo_label": best_y["label"],
            "yolo_conf": best_y["conf"],
            "yolo_pageBox": {"x1":best_y["x1"],"y1":best_y["y1"],"x2":best_y["x2"],"y2":best_y["y2"]},
            "iou": round(best_iou,4),
            "classRelation": cr,
        })
    # also record best IoU even below threshold for diagnostics
    elif best_y:
        # find best IoU regardless
        pass

# also collect all IoU > 0 for candidates that didn't match (diagnostic)
best_iou_per_gemini = {}
for g in valid_entries:
    cx1,cy1,cx2,cy2 = g["convertedBbox"]["x1"],g["convertedBbox"]["y1"],g["convertedBbox"]["x2"],g["convertedBbox"]["y2"]
    best = 0.0
    for y in YOLO:
        i = iou(cx1,cy1,cx2,cy2, y["x1"],y["y1"],y["x2"],y["y2"])
        if i > best: best = i
    best_iou_per_gemini[g["candidateId"]] = round(best,4)

gemini_only = [g for g in valid_entries if g["candidateId"] not in gemini_matched]
yolo_only   = [y for y in YOLO if y["id"] not in yolo_matched]

# ── Step 3: duplicate indicators ─────────────────────────────────────────────
duplicates = [
    {"issue":"duplicate_tag","tag":"M-001A","ids":["discovery-001-005","discovery-001-006"],
     "note":"Two Electric Motor entries share tag M-001A at different bbox locations. Likely separate motors on same label, or misidentification."},
    {"issue":"ambiguous_tag","tag":"LG","ids":["discovery-001-023","discovery-001-024"],
     "note":"Two Level Indicator entries share generic tag LG. Expected — one per vessel. Disambiguation by vessel association needed."},
]

print(f"Matched: {len(pairs)}, Gemini-only: {len(gemini_only)}, YOLO-only: {len(yolo_only)}")
for p in pairs:
    print(f"  MATCH {p['gemini_id']} ({p['gemini_type']}, {p['gemini_tag']}) <-> {p['yolo_id']} ({p['yolo_label']}) IoU={p['iou']} class={p['classRelation']}")

# ── Step 4: write artefacts ───────────────────────────────────────────────────
if CORRECTED_PATH.exists():
    print(f"GUARD: {CORRECTED_PATH} exists — skip")
else:
    corrected_doc = {
        "schemaVersion": "pilot-discovery-coordinate-corrected-v1",
        "generatedAt": "2026-10-12T07:28:00.000Z",
        "pageId": "sheet-1-p1",
        "sourceDiscovery": "fixtures/diagnostics/pilot-sheet-1-p1-v3/discovery-result.json",
        "imageDimensions": {"width": int(W), "height": int(H)},
        "transformApplied": {
            "from": "normalized-0-1000 (actual Gemini output)",
            "to": "source-pixel",
            "formula": TRANSFORM_FORMULA,
            "confirmedBy": TRANSFORM_REF,
            "note": "Gemini returned normalized 0-1000 coords despite prompt requesting source-pixel. Confirmed by visual overlay diagnostic."
        },
        "validationSummary": {
            "total": len(corrected_entries),
            "valid": len(valid_entries),
            "invalid": len(invalid_entries),
            "checks": ["finite values","x1<x2","y1<y2","within image bounds [0,W]x[0,H]"],
        },
        "invalidEntries": [{"candidateId":e["candidateId"],"violations":e["bboxViolations"]} for e in invalid_entries],
        "candidates": corrected_entries,
        "disclaimer": "This file does not modify discovery-result.json. It provides corrected coordinate representation only.",
    }
    CORRECTED_PATH.write_text(json.dumps(corrected_doc, indent=2))
    print(f"Written: {CORRECTED_PATH}")

if COMPARISON_PATH.exists():
    print(f"GUARD: {COMPARISON_PATH} exists — skip")
else:
    # build gemini-only with best IoU annotation
    gemini_only_entries = []
    for g in gemini_only:
        gemini_only_entries.append({
            "candidateId": g["candidateId"],
            "assetType": g["assetType"],
            "assetTag": g["assetTag"],
            "convertedBbox": g["convertedBbox"],
            "bestIouAnyYolo": best_iou_per_gemini[g["candidateId"]],
            "note": "No YOLO prediction within IoU threshold. See bestIouAnyYolo for closest overlap."
        })

    # build yolo-only
    yolo_only_entries = [{"id":y["id"],"label":y["label"],"conf":y["conf"],
                           "pageBox":{"x1":y["x1"],"y1":y["y1"],"x2":y["x2"],"y2":y["y2"]}} for y in yolo_only]

    comp_doc = {
        "schemaVersion": "pilot-comparison-coordinate-corrected-v1",
        "generatedAt": "2026-10-12T07:28:00.000Z",
        "pageId": "sheet-1-p1",
        "imageSha256": "e691c8a1101ee40d1056e9f37fd2bb4e2c222f35c314eabbb552e3f76d42892d",
        "imageDimensions": {"width": int(W), "height": int(H)},
        "disclaimers": [
            "Gemini discovery-result.json has NOT undergone independent visual verification.",
            "YOLO baseline retainedDetections are UNREVIEWED_MODEL_PREDICTION.",
            "This is NOT ground truth, NOT precision/recall/mAP, NOT a hybrid final result.",
            "This is a comparison of two unverified prediction sets after coordinate correction."
        ],
        "inputs": {
            "gemini": {
                "source": "fixtures/diagnostics/pilot-sheet-1-p1-v3/discovery-result.json",
                "coordinateCorrectionApplied": TRANSFORM_FORMULA,
                "candidateCount": 29,
                "validForMatching": len(valid_entries),
                "invalidExcluded": len(invalid_entries),
            },
            "yolo": {
                "source": "fixtures/diagnostics/predictions-v203-baseline.json",
                "coordinateUsed": "pageBox (source-pixel, no transform)",
                "predictionCount": 60,
            }
        },
        "matchingRules": {
            "iouThreshold": IoU_THRESHOLD,
            "method": "greedy one-to-one, YOLO sorted by confidence descending",
            "geminiCoordinate": "convertedBbox from discovery-coordinate-corrected.json",
            "yoloCoordinate": "pageBox from predictions-v203-baseline.json",
            "classMatchingBasis": "explicit mapping from artefact labels; unmapped noted explicitly",
        },
        "classMapping": {
            "documented": [
                {"yolo_label":"equipment.pump.niso","gemini_assetType":"Positive Displacement Pump/Pump","confidence":"partial"},
                {"yolo_label":"valve.check.pip","gemini_assetType":"Check Valve","confidence":"partial"},
                {"yolo_label":"valve.pneumatic_diaphragm_globe.niso","gemini_assetType":"Level/Pressure Control Valve","confidence":"partial"},
                {"yolo_label":"valve.pressure_relief.pip","gemini_assetType":"Pressure Safety Valve","confidence":"partial"},
                {"yolo_label":"valve.control.iso","gemini_assetType":"Level/Pressure Control Valve","confidence":"partial"},
                {"yolo_label":"instrument.orifice.pip","gemini_assetType":"Flow Element","confidence":"partial"},
                {"yolo_label":"valve.ball.iso","gemini_assetType":"Gate Valve","confidence":"uncertain"},
                {"yolo_label":"valve.general.iso","gemini_assetType":"Gate Valve","confidence":"uncertain"},
            ],
            "unmappedYolo": list(UNMAPPED_YOLO),
            "geminiOnlyTypes": list(YOLO_ONLY_GEMINI_TYPES),
        },
        "summary": {
            "matchedPairs": len(pairs),
            "geminiOnlyCount": len(gemini_only),
            "yoloOnlyCount": len(yolo_only),
            "invalidGeminiExcluded": len(invalid_entries),
        },
        "matchedPairs": pairs,
        "geminiOnly": gemini_only_entries,
        "yoloOnly": {
            "count": len(yolo_only),
            "byLabel": {},
            "entries": yolo_only_entries,
        },
        "duplicateIndicators": duplicates,
        "keyObservations": [
            f"After coordinate correction (B-transform), matched pairs remain low ({len(pairs)} at IoU>=0.15).",
            "Root cause: Gemini detects LARGE SYMBOL AREAS (Vessel covers ~200x340px, Tank ~140x130px) while YOLO detects SMALL VALVE SYMBOLS (~15-50px). These do not spatially overlap.",
            "Gemini bbox for control valves (PCV, LCV) covers the entire valve+actuator assembly. YOLO bbox covers only the small valve body. Even at same location, IoU is low due to size mismatch.",
            "The two models are complementary, not competing: YOLO covers valve/instrument symbol types absent from Gemini output; Gemini covers large equipment and instrument bubbles absent from YOLO class set.",
            "Only one matched pair found: discovery-001-018 (PCV-002) + pred-0046 (valve.ball.iso), IoU=0.18. Both at lower-center area. Class conflict: PCV vs ball valve. Marginal IoU.",
        ],
        "bboxSizeComparison": {
            "geminiMedianAreaPx": round(sorted([e["bboxAreaPx"] for e in valid_entries])[len(valid_entries)//2], 0),
            "yoloMedianAreaPx": round(sorted([(y["x2"]-y["x1"])*(y["y2"]-y["y1"]) for y in YOLO])[30], 0),
            "note": "Gemini bbox covers larger symbol areas (equipment-level). YOLO bbox is tight around small valve symbols.",
        },
    }

    # count yolo_only by label
    for y in yolo_only:
        comp_doc["yoloOnly"]["byLabel"][y["label"]] = comp_doc["yoloOnly"]["byLabel"].get(y["label"],0)+1

    COMPARISON_PATH.write_text(json.dumps(comp_doc, indent=2))
    print(f"Written: {COMPARISON_PATH}")

print("Done.")
