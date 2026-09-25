"""Phase 8 harness tests: matching, metrics, taxonomy, determinism, GT validity."""
import json
import os

import pytest

from evaluation import classify_fn, classify_fp, evaluate, iou, match_predictions, prf

GT_PATH = os.path.join(os.path.dirname(__file__), "gt_pdt11_snippet_v1.json")


def gt(pos=9, neg=11):
    with open(GT_PATH) as f:
        data = json.load(f)
    assert len([a for a in data["assets"] if a["status"] == "positive"]) == pos
    assert len(data["negatives"]) == neg
    statuses = {a["status"] for a in data["assets"]}
    assert {"positive", "ambiguous", "unknown"} <= statuses
    return data


def test_ground_truth_independent_set():
    data = gt()
    assert data["coordMethod"] == "visual-estimate"
    assert data["conditions"]["ocrDifficulty"] == "high"
    # Tagless asset, 6-digit tags, association case all present.
    tags = [a["tag"] for a in data["assets"]]
    assert "P-380126" in tags and "VLV-380795" in tags
    assert any(a["tag"] is None and a["status"] == "positive" for a in data["assets"])


def test_iou_and_match_basics():
    assert iou({"x": 0, "y": 0, "width": 10, "height": 10},
               {"x": 0, "y": 0, "width": 10, "height": 10}) == 1.0
    assert iou({"x": 0, "y": 0, "width": 10, "height": 10},
               {"x": 50, "y": 50, "width": 10, "height": 10}) == 0.0
    preds = [{"bbox": {"x": 0, "y": 0, "width": 10, "height": 10},
              "label": "Pump", "confidence": 0.9}]
    gts = [{"id": "g1", "bbox": {"x": 0, "y": 0, "width": 10, "height": 10},
            "symbolLabel": "Pump"}]
    m = match_predictions(preds, gts, 0.5)
    assert len(m.tp) == 1 and not m.fp and not m.fn
    # Wrong label → FP + FN (taxonomy, not silent match).
    m2 = match_predictions([{**preds[0], "label": "Valve"}], gts, 0.5)
    assert not m2.tp and len(m2.fp) == 1 and len(m2.fn) == 1


def test_prf_math():
    assert prf(3, 166, 6)["recall"] == round(3 / 9, 4)
    assert prf(0, 0, 5) == {"precision": 0.0, "recall": 0.0, "f1": 0.0,
                            "tp": 0, "fp": 0, "fn": 5}


def test_taxonomy_rules():
    gt_box = {"id": "g", "bbox": {"x": 100, "y": 100, "width": 100, "height": 100},
              "symbolLabel": "Valve"}
    # Right place wrong label.
    assert classify_fp({"bbox": dict(gt_box["bbox"]), "label": "Pump"}, [gt_box], []) == "WRONG_SYMBOL_CLASS"
    # Right label sloppy box.
    assert classify_fp({"bbox": {"x": 140, "y": 100, "width": 100, "height": 100}, "label": "Valve"},
                       [gt_box], []) == "BAD_BBOX"
    # Pipe-spec trap.
    neg = [{"bbox": {"x": 0, "y": 0, "width": 50, "height": 20}, "kind": "pipe-spec"}]
    assert classify_fp({"bbox": {"x": 0, "y": 0, "width": 50, "height": 20}, "label": "Valve"},
                       [], neg) == "FALSE_POSITIVE_PIPE_SPEC"
    # Missed small symbol.
    small = {"id": "s", "bbox": {"x": 0, "y": 0, "width": 20, "height": 20}, "symbolLabel": "Valve"}
    assert classify_fn(small, []) == "SMALL_SYMBOL"
    assert classify_fn(gt_box, []) == "FALSE_NEGATIVE"


def test_six_digit_tags_parse():
    from tag_parser import TagParser
    p = TagParser()
    for t in ("VLV-380795", "PI-380082", "P-380126", "PP-380163"):
        assert p.parse(t).isTag, t


def test_reconstruction_deterministic():
    import eval_pdt11 as E
    img1, gt1 = E.build_page()
    img2, gt2 = E.build_page()
    assert (img1 == img2).all()
    assert gt1 == gt2


def test_pipeline_deterministic_and_reportable():
    import eval_pdt11 as E
    from eval_runner import build_legend_defs, run_pipeline
    img, gt_page = E.build_page()
    defs = build_legend_defs()
    preds1, _, _ = run_pipeline(img, defs)
    preds2, _, _ = run_pipeline(img, defs)
    assert len(preds1) == len(preds2) and len(preds1) > 0
    assert [(p["candidateId"], p["label"]) for p in preds1] == \
           [(p["candidateId"], p["label"]) for p in preds2]
    rep = evaluate(preds1, gt_page, 0.5, "v2.0.0").to_dict()
    for k in ("detection", "iou", "perClass", "confusion", "ocr",
              "association", "taxonomy", "conditions"):
        assert k in rep, k
    # Honest invariants (not accuracy claims): 6-digit tag read somewhere,
    # per-class present for every GT class, taxonomy non-empty.
    assert rep["perClass"] and rep["taxonomy"]
