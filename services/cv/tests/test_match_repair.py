"""Phase 10 — local reconstruction mechanism tests (dual evidence kept)."""
from match_repair import RepairConfig, rematch_with_reconstruction

import sys
sys.path.insert(0, '.')
from tests.eval_pdt11 import build_page
from preprocess import PreprocessConfig, preprocess_with_config, to_grayscale
from candidate_detection import detect_candidates
from line_layer import long_line_mask, remove_lines
from legend_match import MatchConfig
from tests.eval_runner import build_legend_defs
from evaluation import iou


def _halves_ctx():
    import eval_pdt11 as E
    img, gt = E.build_page()
    gray = to_grayscale(img)
    work = preprocess_with_config(img, PreprocessConfig())["work"]
    mask, _ = long_line_mask(work)
    cands = detect_candidates(remove_lines(work, mask), page_number=1)
    pump = next(g for g in gt["assets"] if g["id"] == "gt-001")
    halves = [c for c in cands if iou(c.bbox, pump["bbox"]) > 0.05]
    assert halves, "fixture must yield pump halves"
    h = max(halves, key=lambda c: iou(c.bbox, pump["bbox"]))
    return gray, dict(h.bbox), [dict(c.bbox) for c in cands], build_legend_defs()


def test_weak_direct_triggers_reconstruction_with_dual_evidence():
    gray, half, neighbors, defs = _halves_ctx()
    # Force the repair path (direct_thr above any direct score here).
    res = rematch_with_reconstruction(gray, half, "h", neighbors, defs,
                                      MatchConfig(),
                                      RepairConfig(direct_thr=0.99))
    assert res["reconstruction"]["used"] is True
    assert res["reconstruction"]["reason"] == "fragmented_geometry"
    assert res["direct"] is not None and res["reconstructed"] is not None
    assert res["selectedFrom"] == "reconstructed"
    assert "mergedBox" in res["reconstruction"]


def test_strong_direct_skips_repair():
    gray, half, neighbors, defs = _halves_ctx()
    res = rematch_with_reconstruction(
        gray, half, "h", neighbors, defs, MatchConfig(),
        RepairConfig(direct_thr=0.0))  # everything counts as strong
    assert res["reconstruction"]["used"] is False
    assert res["selectedFrom"] == "direct"


def test_no_neighbors_gives_reason():
    gray, half, _, defs = _halves_ctx()
    res = rematch_with_reconstruction(gray, half, "h", [], defs,
                                      MatchConfig(),
                                      RepairConfig(direct_thr=0.99))
    assert res["reconstruction"]["used"] is False
    assert res["reconstruction"]["reason"] == "no neighbor fragments"


def test_disabled_config_never_repairs():
    gray, half, neighbors, defs = _halves_ctx()
    res = rematch_with_reconstruction(gray, half, "h", neighbors, defs,
                                      MatchConfig(),
                                      RepairConfig(enabled=False))
    assert res["reconstruction"]["used"] is False
    assert res["selectedFrom"] == "direct"
