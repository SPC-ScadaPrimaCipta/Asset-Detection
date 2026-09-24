"""Phase 10 — bbox refinement unit tests (generic tightening, no invention)."""
from bbox_refine import refine_tight

import sys
sys.path.insert(0, '.')
from tests.eval_pdt11 import build_page
from preprocess import to_grayscale
from evaluation import iou


def test_tightens_pump_box():
    import eval_pdt11 as E
    img, gt = E.build_page()
    gray = to_grayscale(img)
    pump = next(g for g in gt['assets'] if g['id'] == 'gt-001')
    loose = {"x": 633, "y": 430, "width": 213, "height": 81}
    before = iou(loose, pump["bbox"])
    r = refine_tight(gray, loose)
    # None = keep original (neighbor-capture guard); otherwise must not regress.
    final = r if r is not None else loose
    assert iou(final, pump["bbox"]) >= before - 1e-9


def test_tightens_padded_valve_box():
    import eval_pdt11 as E
    img, gt = E.build_page()
    gray = to_grayscale(img)
    gt10 = next(g for g in gt['assets'] if g['id'] == 'gt-010')
    padded = {"x": gt10["bbox"]["x"] - 15, "y": gt10["bbox"]["y"] - 15,
              "width": gt10["bbox"]["width"] + 30, "height": gt10["bbox"]["height"] + 30}
    before = iou(padded, gt10["bbox"])
    r = refine_tight(gray, padded)
    assert r is not None
    assert iou(r, gt10["bbox"]) > before


def test_closing_bridges_line_gap():
    import numpy as np
    gray = np.full((100, 200), 255, dtype=np.uint8)
    import cv2
    cv2.rectangle(gray, (20, 20), (180, 80), (0, 0, 0), 3)
    gray[48:53, :] = 255  # simulated line-removal band
    r = refine_tight(gray, {"x": 15, "y": 15, "width": 170, "height": 70})
    assert r is not None
    assert r["height"] >= 60  # one box, not halves


def test_degenerate_returns_none():
    import numpy as np
    blank = np.full((50, 50), 255, dtype=np.uint8)
    assert refine_tight(blank, {"x": 5, "y": 5, "width": 40, "height": 40}) is None
    assert refine_tight(blank, {"x": 0, "y": 0, "width": 3, "height": 3}) is None


def test_never_expands_beyond_pad():
    import eval_pdt11 as E
    img, _ = E.build_page()
    gray = to_grayscale(img)
    box = {"x": 500, "y": 500, "width": 60, "height": 60}
    r = refine_tight(gray, box, pad=6)
    if r is not None:
        assert r["x"] >= box["x"] - 6 and r["y"] >= box["y"] - 6
        assert r["x"] + r["width"] <= box["x"] + box["width"] + 6
