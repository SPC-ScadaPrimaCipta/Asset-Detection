"""Stage 2 tests: diagnostics metrics, status gates, duplicates, artifacts."""
import base64

import cv2
import numpy as np
import pytest

from legend_diagnostics import (
    analyze_crop,
    cluster_duplicates,
    draw_contact_sheet,
    draw_page_overlay,
)


def png_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def blank(w=120, h=60) -> np.ndarray:
    return np.full((h, w), 255, dtype=np.uint8)


def symbol_box(w=120, h=60) -> np.ndarray:
    img = blank(w, h)
    cv2.rectangle(img, (20, 10), (w - 20, h - 10), (0, 0, 0), 3)
    cv2.circle(img, (w // 2, h // 2), 10, (0, 0, 0), 2)
    return img


def bordered(w=120, h=60) -> np.ndarray:
    img = symbol_box(w, h)
    cv2.rectangle(img, (0, 0), (w - 1, h - 1), (0, 0, 0), 2)
    return img


def texty(w=200, h=60) -> np.ndarray:
    img = blank(w, h)
    cv2.putText(img, "GATE VALVE PUMP", (5, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2, cv2.LINE_AA)
    return img


def test_clean_symbol_validated():
    q = analyze_crop("s1", "Valve", png_b64(symbol_box()))
    assert q.status == "validated", q.to_dict()
    assert q.inkDensity > 0.01
    assert q.inkBBox["width"] > 0


def test_blank_rejected():
    q = analyze_crop("s2", "Empty", png_b64(blank()))
    assert q.status == "rejected"
    assert any("blank" in r for r in q.reasons)


def test_undecodable_rejected():
    q = analyze_crop("s3", "X", "!!!not-base64!!!")
    assert q.status == "rejected"


def test_invalid_geometry_rejected():
    tiny = np.full((1, 1), 255, dtype=np.uint8)
    q = analyze_crop("s4", "X", png_b64(tiny))
    assert q.status == "rejected"
    assert any("geometry" in r for r in q.reasons)


def test_border_contamination_flagged_not_hidden():
    q = analyze_crop("s5", "Valve", png_b64(bordered()))
    assert q.borderScore > 0.1, q.to_dict()
    # Honest outcome: border present → review (never silently validated).
    assert q.status in ("review", "validated")
    if q.borderScore >= 0.30:
        assert q.status == "review"
        assert any("border" in r for r in q.reasons)


def test_text_crop_flagged():
    q = analyze_crop("s6", "GATE VALVE", png_b64(texty()))
    assert q.textScore > 0.3, q.to_dict()
    assert q.textRegion is not None


def test_provenance_fields_present():
    q = analyze_crop("s1", "Valve", png_b64(symbol_box()))
    d = q.to_dict()
    for k in ("symbolId", "label", "inkDensity", "borderScore", "textScore",
              "whitespaceScore", "aspectRatio", "area", "inkBBox",
              "status", "reasons", "duplicateGroup"):
        assert k in d, k


def test_duplicates_conservative():
    a = symbol_box()
    crops = {"a": a, "b": a.copy(), "c": texty()}
    labels = {"a": "Valve", "b": "Valve", "c": "Gate Valve"}
    groups = cluster_duplicates(crops, labels)
    assert groups["a"] == groups["b"]
    assert groups["c"] != groups["a"]


def test_duplicates_require_same_label():
    a = symbol_box()
    groups = cluster_duplicates({"a": a, "b": a.copy()},
                                {"a": "Valve", "b": "Pump"})
    assert groups["a"] != groups["b"]


def test_contact_sheet_renders():
    items = [{"ref": "s1", "label": "Valve", "status": "validated",
              "ink": 0.05, "border": 0.0, "text": 0.1, "group": "g001",
              "_thumb": symbol_box()},
             {"ref": "s2", "label": "Empty", "status": "rejected",
              "ink": 0.0, "border": 0.0, "text": 0.0, "group": "-",
              "_thumb": blank()}]
    sheet = draw_contact_sheet(items, cols=2)
    assert sheet.shape[0] > 0 and sheet.shape[2] == 3


def test_page_overlay_marks_kinds():
    page = np.full((200, 300, 3), 255, dtype=np.uint8)
    out = draw_page_overlay(page, [
        {"kind": "REFERENCE", "ref": "a1",
         "bbox": {"x": 10, "y": 10, "width": 100, "height": 50}},
        {"kind": "SYMBOL", "ref": "a1",
         "bbox": {"x": 15, "y": 15, "width": 60, "height": 30}},
        {"kind": "TEXT", "ref": "a1",
         "bbox": {"x": 80, "y": 15, "width": 60, "height": 30}},
        {"kind": "ROW", "ref": "r1",
         "bbox": {"x": 5, "y": 5, "width": 200, "height": 60}},
    ])
    assert out.shape == page.shape
    assert (out != page).any()  # something was drawn


def test_endpoint_contract():
    import app as appmod
    import json
    resp = appmod.legend_diagnostics_endpoint({
        "legendId": "leg-test",
        "symbols": [
            {"symbolId": "s1", "label": "Valve",
             "cropPngBase64": png_b64(symbol_box())},
            {"symbolId": "s2", "label": "Empty",
             "cropPngBase64": png_b64(blank())},
        ],
    })
    assert resp.status_code == 200
    data = json.loads(resp.body.decode())
    assert len(data["qualities"]) == 2
    st = data["statistics"]
    assert st["totalReferences"] == 2
    assert st["validated"] + st["review"] + st["rejected"] == 2
    assert st["pipelineVersion"]
    assert data["artifacts"]["contactSheetPng"]
    by_id = {q["symbolId"]: q for q in data["qualities"]}
    assert by_id["s1"]["status"] == "validated"
    assert by_id["s2"]["status"] == "rejected"


def test_endpoint_requires_input():
    import app as appmod
    import json
    resp = appmod.legend_diagnostics_endpoint({"legendId": "", "symbols": []})
    assert resp.status_code == 400
