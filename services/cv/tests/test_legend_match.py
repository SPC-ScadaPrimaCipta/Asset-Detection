import copy

import numpy as np

from candidate_detection import detect_candidates
from legend_fixtures import legend_canvas, query_canvas, unrelated_canvas
from legend_match import MatchConfig, MatchInstrumentation, match_candidate
from legend_text_match import label_match, normalize_label
from legend_cache import legend_cache_key
from legend_extract import extract_definitions
from legend_model import LegendDefinition
from ocr_providers import OcrBox
from preprocess import PreprocessConfig, preprocess_with_config, to_grayscale
from template_extract import TEMPLATE_SIZE, extract_variant, normalize_crop
from test_legend_extract import legend_inputs


def build_definitions() -> list[dict]:
    gray, work, visual, boxes, _ = legend_inputs()
    defs, _ = extract_definitions(gray, work, visual, boxes, "leg1")
    return [d.to_dict() for d in defs]


def query_features(label: str, **kw) -> dict:
    img = query_canvas(label, **kw)
    gray = to_grayscale(img)
    size = kw.get("size", 120)
    bbox = {"x": 100, "y": 100, "width": size, "height": size}
    v = extract_variant(gray, gray, bbox, "query")
    return {"id": f"q-{label}", "aspectRatio": v["aspectRatio"],
            "huMoments": v["huMoments"], "edgeDensity": v["edgeDensity"],
            "lineCount": v["lineCount"],
            "normCrop": normalize_crop(gray, bbox, TEMPLATE_SIZE)}


def top_label(matches: list) -> str | None:
    return matches[0]["label"] if matches else None


DEFS = None

def defs():
    global DEFS
    if DEFS is None:
        DEFS = build_definitions()
    return DEFS


def test_exact_symbols_rank_first():
    for label in ("Pump", "Valve", "PSV", "Instrument"):
        m = match_candidate(query_features(label), defs())
        assert top_label(m) == label, (label, [x["label"] for x in m])
        assert set(m[0]["features"]) == {"geometryScore", "contourScore",
                                         "templateScore", "edgeScore",
                                         "scaleScore", "rotationScore"}
        assert m[0]["reasons"]


def test_scaled_symbol_still_matches():
    m = match_candidate(query_features("Pump", size=180), defs())
    assert top_label(m) == "Pump"


def test_rotated_symbol_matches_when_allowed():
    rot_defs = copy.deepcopy(defs())
    for d in rot_defs:
        d["rotationInvariant"] = True
    m = match_candidate(query_features("Valve", angle=90), rot_defs)
    assert top_label(m) == "Valve"


def test_noisy_symbol_matches():
    m = match_candidate(query_features("PSV", noise=60), defs())
    assert top_label(m) == "PSV"


def test_unrelated_geometry_has_no_strong_match():
    # Discrimination (not a production threshold — Phase 6 calibrates):
    # unrelated top must stay clearly below EVERY exact-match top,
    # measured in the same run against the same definitions.
    exact_tops = []
    for label in ("Pump", "Valve", "PSV", "Instrument"):
        m = match_candidate(query_features(label), defs())
        assert m, label
        exact_tops.append(m[0]["score"])
    gray = to_grayscale(unrelated_canvas())
    bbox = {"x": 100, "y": 100, "width": 120, "height": 120}
    v = extract_variant(gray, gray, bbox, "query")
    q = {"id": "q-x", "aspectRatio": v["aspectRatio"], "huMoments": v["huMoments"],
         "edgeDensity": v["edgeDensity"], "lineCount": v["lineCount"],
         "normCrop": normalize_crop(gray, bbox, TEMPLATE_SIZE)}
    m = match_candidate(q, defs())
    assert m, "expected at least weak evidence (recall-oriented matcher)"
    assert m[0]["score"] + 0.05 <= min(exact_tops), (
        f"unrelated {m[0]['score']} too close to exact min {min(exact_tops)}")


def test_multiple_matches_ranked_deterministically():
    m1 = match_candidate(query_features("Pump"), defs())
    m2 = match_candidate(query_features("Pump"), defs())
    assert [x["legendSymbolId"] for x in m1] == [x["legendSymbolId"] for x in m2]
    scores = [x["score"] for x in m1]
    assert scores == sorted(scores, reverse=True)


def test_tie_break_by_symbol_id():
    dd = copy.deepcopy(defs())
    dd.append(copy.deepcopy(next(d for d in dd if d["label"] == "Pump")))
    dd[-1]["symbolId"] = "leg1-sym-AAA"
    m = match_candidate(query_features("Pump"), dd)
    tied = [x for x in m if x["score"] == m[0]["score"]]
    ids = [x["legendSymbolId"] for x in tied]
    assert ids == sorted(ids)


def test_cascade_instrumentation_counts():
    instr = MatchInstrumentation()
    match_candidate(query_features("Pump"), defs(), MatchConfig(), instr)
    d = instr.to_dict()
    assert d["attempted"] == sum(len(x["variants"]) for x in defs())
    assert d["fullComparisons"] <= d["attempted"]
    assert d["accepted"] >= 1


def test_label_match_exact_alias_token():
    pump = next(d for d in defs() if d["label"] == "Pump")
    assert label_match("Pump", pump)["match"] is True
    assert label_match("PUMP", pump)["kind"] == "exact-label"
    pump2 = copy.deepcopy(pump)
    pump2["aliases"] = ["Centrifugal Pump"]
    assert label_match("centrifugal pump", pump2)["kind"] == "exact-alias"
    assert label_match("Pump Symbol", pump)["kind"] == "token-overlap"
    no = label_match("Compressor", pump)
    assert no["match"] is False  # similar words never become aliases here


def test_cache_keys():
    a = legend_cache_key(b"pdf", [1], 288, "pre", "ocr", "v2", "legend-v1")
    assert a == legend_cache_key(b"pdf", [1], 288, "pre", "ocr", "v2", "legend-v1")
    assert a != legend_cache_key(b"pdf-CHANGED", [1], 288, "pre", "ocr", "v2", "legend-v1")
    assert a != legend_cache_key(b"pdf", [1], 288, "pre-CHANGED", "ocr", "v2", "legend-v1")
    assert a != legend_cache_key(b"pdf", [1], 288, "pre", "ocr", "v2", "legend-v2")
    assert a != legend_cache_key(b"pdf", [1, 2], 288, "pre", "ocr", "v2", "legend-v1")
