"""Phase 9.3 — line layer unit tests (mask, removal, reunion)."""
from line_layer import long_line_mask, remove_lines, reunite_split
from preprocess import PreprocessConfig, preprocess_with_config

import sys
sys.path.insert(0, '.')
from tests.eval_pdt11 import build_page


def test_long_lines_found_on_header():
    import eval_pdt11 as E
    img, _ = E.build_page()
    work = preprocess_with_config(img, PreprocessConfig())["work"]
    mask, lines = long_line_mask(work)
    assert len(lines) >= 1
    assert any(L["length"] > 1000 for L in lines)  # main header
    assert mask.sum() > 0


def test_remove_lines_zeros_band():
    import numpy as np
    work = np.zeros((100, 200), dtype=np.uint8)
    work[48:52, :] = 255
    mask, _ = long_line_mask(work, min_len_ratio=0.1, dilate_px=1)
    out = remove_lines(work, mask)
    assert out[50, 100] == 0


def test_reunite_split_halves():
    boxes = [{"x": 639, "y": 436, "width": 201, "height": 27},
             {"x": 639, "y": 477, "width": 201, "height": 28}]
    out = reunite_split(boxes)
    assert len(out) == 1
    assert out[0]["y"] == 436 and out[0]["height"] == 69
    assert out[0]["reunited"] is True


def test_reunite_ignores_distant_boxes():
    boxes = [{"x": 0, "y": 0, "width": 50, "height": 50},
             {"x": 500, "y": 500, "width": 50, "height": 50}]
    out = reunite_split(boxes)
    assert len(out) == 2 and not any(b.get("reunited") for b in out)


def test_reunite_ignores_overlapping_boxes():
    boxes = [{"x": 0, "y": 0, "width": 100, "height": 100},
             {"x": 10, "y": 10, "width": 100, "height": 100}]
    out = reunite_split(boxes)
    assert len(out) == 2  # overlap, not a split gap → untouched
