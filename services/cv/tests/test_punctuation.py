"""Phase 9.2 — punctuation trim cases (edges only, compounds safe)."""
from tag_parser import TagParser
from text_normalization import base_normalize


def norm(raw: str) -> str:
    return base_normalize(raw).normalized


def test_seven_punctuation_cases():
    assert norm("(VLV-380795") == "VLV-380795"
    assert norm("VLV-380795)") == "VLV-380795"
    assert norm("(VLV-380795)") == "VLV-380795"
    assert norm("[VLV-380795]") == "VLV-380795"
    assert norm("VLV-380795,") == "VLV-380795"
    assert norm("VLV-380795.") == "VLV-380795"
    assert norm("VLV-380795:") == "VLV-380795"


def test_compounds_and_internals_untouched():
    assert norm("PSV-PDT-11") == "PSV-PDT-11"
    assert norm("WF-204-A013-1\"") == "WF-204-A013-1"  # inch mark trimmed, recorded
    assert norm("P-101A") == "P-101A"


def test_trim_recorded_auditable():
    n = base_normalize("(VLV-380795")
    assert n.raw == "(VLV-380795"
    assert n.normalized == "VLV-380795"
    assert any("edge punctuation trim" in t for t in n.transformations)


def test_trimmed_tags_parse():
    p = TagParser()
    assert p.parse(norm("(VLV-380795")).isTag
    assert p.parse(norm("[PI-380082]")).prefix == "PI"
