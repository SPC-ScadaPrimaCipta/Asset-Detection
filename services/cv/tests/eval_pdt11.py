"""
Phase 8 measurement page: faithful vector reconstruction of the user-provided
PDT-11 rev-cloud snippet (2026-09-24) at 2000px width.

HUMAN GT = design intent recorded below (placements decided while DRAWING,
before any pipeline output — independent by construction). Predictions come
from the REAL deterministic chain (CV + Tesseract + legend + confidence).

Covers: 6-digit tags (VLV-380795…), tagless vessel, NC markers, pipe specs
(negatives), reducers (ambiguous), clouded tags, dense piping.
"""
import cv2
import numpy as np

W, H = 2000, 950
GT = {"page": 1, "source": "pdt11-reconstruction-v1 (vector redraw of user snippet)",
      "coordMethod": "cad-measured", "version": "gt-v1",
      "conditions": {"scanQuality": "clean-vector", "dpi": 200, "rotation": 0,
                     "noise": "low", "lineDensity": "high", "symbolSize": "medium",
                     "ocrDifficulty": "medium"},
      "annotator": "human-analyst", "assets": [], "negatives": []}

CLOUD = (0, 0, 0)


def _cloud_rect(img, x, y, w, h, r=14, thick=2):
    cv2.ellipse(img, (x + r, y + r), (r, r), 0, 180, 270, (0, 0, 0), thick)
    cv2.ellipse(img, (x + w - r, y + r), (r, r), 0, 270, 360, (0, 0, 0), thick)
    cv2.ellipse(img, (x + r, y + h - r), (r, r), 0, 90, 180, (0, 0, 0), thick)
    cv2.ellipse(img, (x + w - r, y + h - r), (r, r), 0, 0, 90, (0, 0, 0), thick)
    cv2.line(img, (x + r, y), (x + w - r, y), CLOUD, thick)
    cv2.line(img, (x + r, y + h), (x + w - r, y + h), CLOUD, thick)
    cv2.line(img, (x, y + r), (x, y + h - r), CLOUD, thick)
    cv2.line(img, (x + w, y + r), (x + w, y + h - r), CLOUD, thick)


def _tag(img, x, y, text, scale=1.1):
    cv2.putText(img, text, (x + 12, y + 34), cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), 2, cv2.LINE_AA)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
    _cloud_rect(img, x, y, tw + 24, th + 22)
    return {"x": x, "y": y, "width": tw + 24, "height": th + 22}


def _gate_valve(img, x, y, s=44):
    cv2.line(img, (x, y + s // 2), (x + s, y + s // 2), (0, 0, 0), 3)
    cv2.line(img, (x + s // 2, y), (x + s // 2, y + s // 2), (0, 0, 0), 3)
    cv2.circle(img, (x + s // 2, y + 6), 5, (0, 0, 0), 2)
    return {"x": x, "y": y, "width": s, "height": s}


def _check_valve(img, x, y, s=44):
    p1 = np.array([[x, y], [x, y + s], [x + s, y + s // 2]], np.int32)
    p2 = np.array([[x + s, y], [x + s, y + s], [x, y + s // 2]], np.int32)
    cv2.polylines(img, [p1], True, (0, 0, 0), 3)
    cv2.polylines(img, [p2], True, (0, 0, 0), 3)
    return {"x": x, "y": y, "width": s, "height": s}


def _instrument_circle(img, x, y, d=64):
    cv2.circle(img, (x + d // 2, y + d // 2), d // 2, (0, 0, 0), 3)
    return {"x": x, "y": y, "width": d, "height": d}


def _instrument_diamond(img, x, y, s=30):
    c = np.array([[x + s // 2, y], [x + s, y + s // 2],
                  [x + s // 2, y + s], [x, y + s // 2]], np.int32)
    cv2.polylines(img, [c], True, (0, 0, 0), 3)
    return {"x": x, "y": y, "width": s, "height": s}


def _pump_capsule(img, x, y, w=230, h=64):
    # Horizontal capsule: two end caps + body lines.
    cv2.ellipse(img, (x + h // 2, y + h // 2), (h // 2, h // 2), 0, 90, 270, (0, 0, 0), 3)
    cv2.ellipse(img, (x + w - h // 2, y + h // 2), (h // 2, h // 2), 0, 270, 90, (0, 0, 0), 3)
    cv2.line(img, (x + h // 2, y), (x + w - h // 2, y), (0, 0, 0), 3)
    cv2.line(img, (x + h // 2, y + h), (x + w - h // 2, y + h), (0, 0, 0), 3)
    return {"x": x, "y": y, "width": w, "height": h}


def _vessel(img, x, y, w=64, h=150):
    cv2.rectangle(img, (x, y + w // 2), (x + w, y + h - w // 2), (0, 0, 0), 3)
    cv2.ellipse(img, (x + w // 2, y + w // 2), (w // 2, w // 2), 0, 180, 360, (0, 0, 0), 3)
    cv2.ellipse(img, (x + w // 2, y + h - w // 2), (w // 2, w // 2), 0, 0, 180, (0, 0, 0), 3)
    return {"x": x, "y": y, "width": w, "height": h}


def build_page() -> tuple:
    """Returns (image, gt_page_dict). GT recorded = human design intent."""
    img = np.full((H, W, 3), 255, dtype=np.uint8)
    assets, negatives = [], []

    def asset(id, bbox, label, tag=None, tagbox=None, status="positive", notes=""):
        assets.append({"id": id, "bbox": bbox, "symbolLabel": label, "symbolId": "",
                       "tag": tag, "tagRaw": tag, "tagBBox": tagbox,
                       "status": status, "notes": notes})

    def neg(id, bbox, kind, text, notes=""):
        negatives.append({"id": id, "bbox": bbox, "kind": kind, "text": text, "notes": notes})

    Y = 470  # main pipe centerline
    cv2.line(img, (0, Y), (W, Y), (0, 0, 0), 4)  # main header

    # VLV-380795 NC gate (left)
    b = _gate_valve(img, 165, Y - 44)
    t = _tag(img, 40, 250, "VLV-380795")
    cv2.putText(img, "NC", (168, 420), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, "1/2\"D2S", (120, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-004", b, "Valve", "VLV-380795", t, notes="NC gate")
    neg("ng-007", {"x": 120, "y": 282, "width": 110, "height": 24}, "pipe-spec", '1/2"D2S')
    neg("ng-009", {"x": 168, "y": 402, "width": 44, "height": 22}, "marker", "NC")

    # PI-380082 diamond
    b = _instrument_diamond(img, 225, Y + 30)
    t = _tag(img, 140, 560, "PI-380082")
    cv2.line(img, (240, Y), (240, Y + 30), (0, 0, 0), 2)
    asset("gt-006", b, "Instrument", "PI-380082", t)

    # VLV-380796 check
    b = _check_valve(img, 390, Y - 44)
    t = _tag(img, 330, 330, "VLV-380796")
    cv2.putText(img, '6"B2R', (480, 390), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-005", b, "Valve", "VLV-380796", t)
    neg("ng-001", {"x": 480, "y": 372, "width": 110, "height": 24}, "pipe-spec", '6"B2R')

    # Reducer 2"x1"
    cv2.line(img, (520, Y - 20), (560, Y), (0, 0, 0), 3)
    cv2.line(img, (520, Y + 20), (560, Y), (0, 0, 0), 3)
    cv2.putText(img, '2"x1"', (520, 560), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-011", {"x": 520, "y": Y - 20, "width": 40, "height": 40},
          "Reducer", None, None, status="ambiguous", notes="fitting or asset?")
    neg("ng-002", {"x": 520, "y": 542, "width": 90, "height": 24}, "pipe-spec", '2"x1"')

    # PDT-11 pump capsule + vessel + EM (capsule aspect 2.5 = legend entry)
    b = _pump_capsule(img, 640, Y - 40, 200, 80)
    t = _tag(img, 690, 700, "P-380126")
    cv2.putText(img, "PDT-11", (710, 640), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, "VERTICAL PUMP", (660, 672), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-001", b, "Vertical Pump", "P-380126", t)
    neg("ng-011", {"x": 660, "y": 610, "width": 190, "height": 66}, "title-text", "PDT-11 VERTICAL PUMP")
    bv = _vessel(img, 723, 180)
    asset("gt-002", bv, "Vessel", None, None, notes="tagless asset must still exist")
    cv2.rectangle(img, (735, 120), (775, 160), (0, 0, 0), 3)
    cv2.putText(img, "EM", (738, 112), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-003", {"x": 735, "y": 120, "width": 40, "height": 40},
          "Motor", "EM", None, status="ambiguous", notes="package part or asset?")

    # VLV-380797 + PI PDT-11 instrument
    b = _gate_valve(img, 1400, Y - 44)
    t = _tag(img, 1290, 320, "VLV-380797")
    cv2.putText(img, '3/4"D2S', (1290, 390), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-008", b, "Valve", "VLV-380797", t)
    neg("ng-004", {"x": 1290, "y": 372, "width": 130, "height": 24}, "pipe-spec", '3/4"D2S')
    bi = _instrument_circle(img, 1390, 190)
    _tag(img, 1540, 70, "PI-380085")
    cv2.putText(img, "PI", (1408, 232), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, "PDT-11", (1388, 258), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.line(img, (1422, 254), (1422, Y - 44), (0, 0, 0), 2)
    asset("gt-007", bi, "Instrument", "PI-380085",
          {"x": 1540, "y": 70, "width": 200, "height": 56},
          notes="circle labeled PI PDT-11; cloud tag above")

    # VLV-380798 check + VLV-380799 gate
    b = _check_valve(img, 1610, Y - 44)
    t = _tag(img, 1500, 620, "VLV-380798")
    cv2.putText(img, '3"B5R', (1620, 540), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-009", b, "Valve", "VLV-380798", t, notes="NC check")
    neg("ng-005", {"x": 1620, "y": 522, "width": 110, "height": 24}, "pipe-spec", '3"B5R')
    b = _gate_valve(img, 1700, Y - 44)
    t = _tag(img, 1760, 320, "VLV-380799")
    cv2.putText(img, '3"B2R', (1760, 390), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-010", b, "Valve", "VLV-380799", t)
    neg("ng-006", {"x": 1760, "y": 372, "width": 110, "height": 24}, "pipe-spec", '3"B2R')

    # Reducer 3"x2"x1"
    cv2.line(img, (1240, Y - 22), (1280, Y), (0, 0, 0), 3)
    cv2.line(img, (1240, Y + 22), (1280, Y), (0, 0, 0), 3)
    cv2.putText(img, '3"x2"x1"', (1230, 560), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-012", {"x": 1240, "y": Y - 22, "width": 40, "height": 44},
          "Reducer", None, None, status="ambiguous")
    neg("ng-003", {"x": 1230, "y": 542, "width": 150, "height": 24}, "pipe-spec", '3"x2"x1"')

    # FROM WATER POND + unknown PP tag
    cv2.putText(img, "FROM", (40, 640), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, "WATER POND", (20, 672), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    neg("ng-008", {"x": 20, "y": 610, "width": 170, "height": 66}, "title-text", "FROM WATER POND")
    t = _tag(img, 1150, 730, "PP-380163")
    cv2.putText(img, 'WF-204-A013-1"', (1150, 810), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    asset("gt-013", t, "", "PP-380163", None, status="unknown",
          notes="off-page connector or drain? unclassifiable here")
    neg("ng-010", {"x": 1150, "y": 792, "width": 220, "height": 24}, "pipe-spec", 'WF-204-A013-1"')

    gt = dict(GT)
    gt["assets"] = assets
    gt["negatives"] = negatives
    return img, gt


def build_legend() -> tuple:
    """Mini legend canvas (vector) with entries matching GT vocabulary.

    Labels sit immediately beside their symbol (realistic legend layout,
    inside the 0.15 association gate).
    """
    img = np.full((700, 560, 3), 255, dtype=np.uint8)
    items = []

    def entry(label, draw_fn, row, sym_w=90, sym_h=90):
        y = 60 + row * 150
        x = 40
        draw_fn(img, x, y, sym_w, sym_h)
        tx = x + sym_w + 15
        cv2.putText(img, label, (tx, y + 55), cv2.FONT_HERSHEY_SIMPLEX,
                    1.0, (0, 0, 0), 2, cv2.LINE_AA)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1.0, 2)
        items.append({"label": label,
                      "symBbox": {"x": x, "y": y, "width": sym_w, "height": sym_h},
                      "textBbox": {"x": tx, "y": y + 10,
                                   "width": tw + 12, "height": th + 18}})

    entry("Valve", lambda im, x, y, w, h: _gate_valve(im, x, y + 15, 60), 0)
    entry("Instrument", lambda im, x, y, w, h: _instrument_circle(im, x, y + 5, 80), 1)
    entry("Vertical Pump",
          lambda im, x, y, w, h: _pump_capsule(im, x - 30, y + 15, 150, 60), 2)
    entry("Vessel", lambda im, x, y, w, h: _vessel(im, x + 15, y - 30, 60, 150), 3)
    return img, items
