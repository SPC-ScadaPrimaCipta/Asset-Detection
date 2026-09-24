from tag_parser import TagParser
from text_normalization import base_normalize, contextual_correct


def test_base_normalization_records_steps():
    n = base_normalize(" P-10lA ")
    assert n.normalized == "P-10LA"
    assert "whitespace normalization" in n.transformations
    # No char substitution at this layer.
    assert "10L" in n.normalized


def test_contextual_correction_repairs_ocr_typo():
    p = TagParser()
    # P-10LA is pattern-valid as (10 + suffix LA) — correction requires
    # known-tag context, never blind guessing.
    assert contextual_correct("P-10LA", p.matches).normalized == "P-10LA"
    out = contextual_correct("P-10LA", p.matches, known_tags={"P-101A"})
    assert out.normalized == "P-101A"
    assert any("L→1" in t for t in out.transformations)
    # Pattern-INVALID typos need no context: P-IO1 cannot parse as-is.
    out2 = contextual_correct("P-IO1", p.matches)
    assert out2.normalized == "P-101"


def test_contextual_correction_never_rewrites_arbitrary_text():
    p = TagParser()
    for raw in ["DRAWING", "PAGE 11", "REV A", "PUMP STATION"]:
        out = contextual_correct(base_normalize(raw).normalized, p.matches)
        assert out.normalized == base_normalize(raw).normalized
        assert out.transformations == []


def test_already_valid_tag_untouched():
    p = TagParser()
    out = contextual_correct("P-101A", p.matches)
    assert out.normalized == "P-101A" and out.transformations == []


def test_compound_normalization_flow():
    p = TagParser()
    base = base_normalize("psv-pdt-11")
    assert base.normalized == "PSV-PDT-11"
    tag = p.parse(base.normalized)
    assert tag.isTag and tag.components == ["PSV", "PDT"] and tag.number == "11"
