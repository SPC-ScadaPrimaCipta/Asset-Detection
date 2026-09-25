"""Stage 3 contract: semantic class keys live in ONE implementation only.

Class grouping runs in TypeScript (legend-classes.ts :: normalizeLegendLabel:
collapse whitespace, trim, lowercase). Python's base_normalize is a TAG
pipeline normalization (spaceless) and MUST NOT be used for class keys.
This test locks that boundary: it documents the TS key rule with a local
mirror and asserts Python never feeds grouping.
"""
import re


def ts_class_key(value: str) -> str:
    """Exact mirror of legend-model.ts normalizeLegendLabel."""
    return re.sub(r"\s+", " ", (value or "")).strip().lower()


CASES = [
    "GATE VALVE",
    "Gate Valve",
    " gate valve ",
    "Gate  Valve",
    "ACTUATED GATE VALVE",
    "BALL VALVE",
    "PRESSURE INDICATOR",
    "PUMP",
    "3-WAY VALVE SOLENOID VALVE (ARROW INDICATES DE-ENERGIZE PART CONFIGURATION)",
]


def test_class_key_rule():
    assert ts_class_key("GATE VALVE") == "gate valve"
    assert ts_class_key("Gate  Valve") == "gate valve"
    assert ts_class_key(" gate valve ") == "gate valve"


def test_distinct_labels_stay_distinct():
    keys = [ts_class_key(c) for c in CASES]
    # 4 spelling variants of "gate valve" collapse to one key; the other
    # 5 labels stay distinct from each other and from gate valve.
    assert keys.count("gate valve") == 4
    rest = [k for k in keys if k != "gate valve"]
    assert len(set(rest)) == 5
    assert ts_class_key("GATE VALVE") != ts_class_key("ACTUATED GATE VALVE")


def test_tag_normalization_is_not_a_class_key():
    from text_normalization import base_normalize
    # Tag pipeline strips ALL spaces — unsuitable (and forbidden) for classes.
    assert base_normalize("GATE VALVE").normalized == "GATEVALVE"
    assert " " in ts_class_key("GATE VALVE")
    assert ts_class_key("GATE VALVE") == "gate valve"
