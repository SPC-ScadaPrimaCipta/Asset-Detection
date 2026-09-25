import numpy as np

from candidate_detection import DetectorConfig, count_lines, detect_candidates
from fixtures import blank, line_heavy, symbol_drawing
from preprocess import PreprocessConfig, preprocess_with_config


def work_of(img, **kw):
    cfg = PreprocessConfig(**kw)
    return preprocess_with_config(img, cfg)["work"]


def test_simple_geometric_candidates_found():
    cands = detect_candidates(work_of(symbol_drawing()))
    assert len(cands) >= 2  # rect + circle (+ line fragments allowed)
    for c in cands:
        assert c.candidateType == "visual"
        assert c.source == "cv"
        assert c.bbox["width"] > 0 and c.bbox["height"] > 0
        assert c.geometry.area > 0
        assert c.pipelineVersion  # version stamped


def test_blank_page_yields_no_candidates():
    assert detect_candidates(work_of(blank())) == []


def test_line_heavy_drawing_reports_lines():
    work = work_of(line_heavy())
    assert count_lines(work) > 0
    cands = detect_candidates(work)
    assert all(c.evidence.lineCount > 0 for c in cands) or cands == []


def test_speckle_filtered_but_symbol_kept():
    rng = np.random.default_rng(3)
    img = blank(200, 200)
    for _ in range(120):  # isolated 1px speckle
        img[int(rng.integers(0, 200)), int(rng.integers(0, 200))] = (0, 0, 0)
    import cv2
    cv2.rectangle(img, (50, 50), (120, 120), (0, 0, 0), 2)
    cands = detect_candidates(work_of(img))
    assert len(cands) >= 1
    assert all(c.geometry.area >= DetectorConfig().min_area for c in cands)


def test_very_large_component_flagged_not_dropped():
    import cv2
    img = blank(400, 400)
    cv2.rectangle(img, (5, 5), (395, 300), (0, 0, 0), 3)  # border-like, >25% area
    cands = detect_candidates(work_of(img))
    assert len(cands) >= 1
    assert any("large-region" in " ".join(c.evidence.notes) for c in cands)


def test_candidate_ids_encode_page_and_tile():
    cands = detect_candidates(work_of(symbol_drawing()), page_number=7, tile_id=2)
    assert all(c.candidateId.startswith("p7t2c") for c in cands)
    assert all(c.pageNumber == 7 and c.tileId == 2 for c in cands)


def test_global_binary_variant_also_detects():
    cands = detect_candidates(work_of(symbol_drawing(), variant="binary"))
    assert len(cands) >= 2
