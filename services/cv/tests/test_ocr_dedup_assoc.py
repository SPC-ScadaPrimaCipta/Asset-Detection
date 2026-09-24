from association import rank_associations
from ocr_dedup import dedup_texts
from ocr_metrics import EVAL_FIXTURES, compute_metrics
from schemas import Candidate, OcrResult, TagParse
from tag_parser import TagParser
from text_normalization import base_normalize, contextual_correct


def tcid(cid, text, x, y, w=60, h=22, tile=0, page=1):
    return Candidate(candidateId=cid, pageNumber=page, tileId=tile,
                     bbox={"x": x, "y": y, "width": w, "height": h},
                     candidateType="text",
                     ocr=OcrResult(text=text),
                     tag=TagParse(raw=text, normalized=text, isTag=True),
                     provenance=[f"tile:{tile}"])


def test_same_text_same_place_merges():
    out = dedup_texts([tcid("a", "P-101", 100, 100, tile=0),
                       tcid("b", "P-101", 102, 101, tile=1)])
    assert len(out) == 1
    assert out[0].provenance == ["tile:0", "tile:1", "merged:b"]


def test_repeated_legitimate_tags_stay_separate():
    out = dedup_texts([tcid("a", "P-101", 100, 100),
                       tcid("b", "P-101", 900, 700)])
    assert len(out) == 2


def test_different_texts_never_merge():
    out = dedup_texts([tcid("a", "P-101", 100, 100),
                       tcid("b", "P-102", 102, 101)])
    assert len(out) == 2


def test_higher_confidence_ocr_survives_merge():
    a = tcid("a", "P-101", 100, 100, tile=0)
    a.ocr.confidence = 0.5
    b = tcid("b", "P-101", 102, 101, tile=1)
    b.ocr.confidence = 0.9
    out = dedup_texts([a, b])
    assert out[0].ocr.confidence == 0.9


def test_ranked_associations_return_all_in_gate():
    text = {"id": "t1", "bbox": {"x": 1800, "y": 1120, "width": 60, "height": 22},
            "isTag": True}
    syms = [{"id": "near", "bbox": {"x": 1840, "y": 1220, "width": 96, "height": 88}},
            {"id": "mid", "bbox": {"x": 2100, "y": 1220, "width": 96, "height": 88}},
            {"id": "far", "bbox": {"x": 4000, "y": 3000, "width": 96, "height": 88}}]
    ranked = rank_associations(text, syms, {"pageWidth": 5100, "pageHeight": 3600})
    assert [r.symbolId for r in ranked] == ["near", "mid"]  # far gated out
    assert ranked[0].score >= ranked[1].score
    assert ranked[0].features.tagPatternScore == 1.0
    assert ranked[0].reasons  # explainable


def test_invalid_geometry_rejected():
    text = {"id": "t1", "bbox": {"x": 10, "y": 10, "width": 0, "height": 5}, "isTag": True}
    syms = [{"id": "s", "bbox": {"x": 10, "y": 10, "width": 50, "height": 50}}]
    assert rank_associations(text, syms, {"pageWidth": 100, "pageHeight": 100}) == []


def test_eval_fixture_pipeline_metrics():
    """End-to-end over §15 fixtures: normalize → parse → metric cases."""
    parser = TagParser()
    cases = []
    for fx in EVAL_FIXTURES:
        base = base_normalize(fx["raw"])
        known = {fx["expected_tag"]} if fx.get("needs_normalization") else None
        fixed = contextual_correct(base.normalized, parser.matches, known_tags=known)
        tag = parser.parse(fixed.normalized)
        tag.raw, tag.normalized = fx["raw"], fixed.normalized
        cases.append({
            "detected_text": fixed.normalized,
            "expected_tag": fx.get("expected_tag"),
            "parsed_is_tag": tag.isTag,
            "tag_match": tag.isTag and tag.normalized == fx.get("expected_tag"),
            "needs_normalization": bool(fx.get("needs_normalization")),
            "normalized_ok": (not fx.get("needs_normalization")
                              or fixed.normalized == fx.get("expected_tag")),
        })
    m = compute_metrics(cases)
    assert m.tag_recognition_rate == 1.0
    assert m.normalization_accuracy == 1.0
    assert m.false_tag_rate == 0.0
    assert m.ocr_detection_rate == 1.0
