from tag_parser import TagParser, TagPattern, normalize_text


def test_valid_tags():
    p = TagParser()
    for raw, prefix, number, suffix in [
        ("P-101", "P", "101", None),
        ("P-101A", "P", "101", "A"),
        ("P-101B", "P", "101", "B"),
        ("V-201", "V", "201", None),
        ("FV-101", "FV", "101", None),
        ("XV-102", "XV", "102", None),
        ("FT-301", "FT", "301", None),
        ("PT-302", "PT", "302", None),
        ("TT-303", "TT", "303", None),
        ("LT-304", "LT", "304", None),
    ]:
        r = p.parse(raw)
        assert r.isTag, raw
        assert (r.prefix, r.number, r.suffix) == (prefix, number, suffix), raw


def test_compound_tag():
    r = TagParser().parse("PSV-PDT-11")
    assert r.isTag and r.prefix == "PSV-PDT" and r.number == "11"


def test_lowercase_normalized():
    r = TagParser().parse("p-101a")
    assert r.isTag and r.normalized == "P-101A"


def test_invalid_text_rejected():
    p = TagParser()
    for bad in ["PUMP", "hello world", "", "P-", "-101", "P_101", "PRESSURE VESSEL"]:
        assert not p.parse(bad).isTag, bad


def test_configurable_patterns():
    custom = TagParser([TagPattern("site-extended", r"^AB-(\d{7})$")])
    r = custom.parse("AB-1234567")
    assert r.isTag and r.patternId == "site-extended"
    # Default caps numbers at 6 digits (Phase 8 evidence: real plant tags
    # like VLV-380795 are 6-digit) — 7 digits need a custom pattern.
    assert TagParser().parse("AB-123456").isTag
    assert not TagParser().parse("AB-1234567").isTag
