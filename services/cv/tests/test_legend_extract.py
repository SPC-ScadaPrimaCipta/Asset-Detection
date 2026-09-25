import numpy as np

from candidate_detection import detect_candidates
from fixtures import blank
from legend_extract import extract_definitions
from legend_fixtures import legend_canvas
from legend_model import LegendDefinition
from ocr_providers import OcrBox
from preprocess import PreprocessConfig, preprocess_with_config, to_grayscale


def legend_inputs(mock_texts: bool = True):
    img, items = legend_canvas()
    gray = to_grayscale(img)
    work = preprocess_with_config(img, PreprocessConfig())["work"]
    visual = detect_candidates(work, page_number=1)
    boxes = [OcrBox(text=it["label"], bbox=it["textBbox"], confidence=0.95)
             for it in items] if mock_texts else []
    return gray, work, visual, boxes, items


def test_symbol_text_pairs_form_definitions():
    gray, work, visual, boxes, items = legend_inputs()
    assert len(visual) >= 4
    defs, debug = extract_definitions(gray, work, visual, boxes, "leg1")
    assert len(defs) == 4
    assert sorted(d.label for d in defs) == ["Instrument", "PSV", "Pump", "Valve"]
    for d in defs:
        assert d.legendId == "leg1"
        assert len(d.variants) == 1
        assert len(d.visualFeatures.huMoments) == 7
        assert d.provenance  # assoc evidence retained


def test_missing_text_yields_no_definition_for_symbol():
    gray, work, visual, _, _ = legend_inputs(mock_texts=False)
    defs, _ = extract_definitions(gray, work, visual, [], "leg1")
    assert defs == []


def test_invalid_bbox_text_skipped():
    gray, work, visual, boxes, _ = legend_inputs()
    boxes = boxes + [OcrBox(text="Ghost", bbox={"x": -50, "y": -50, "width": 10, "height": 10})]
    defs, debug = extract_definitions(gray, work, visual, boxes, "leg1")
    assert len(defs) == 4
    assert any(d.get("skipped") == "invalid-bbox" for d in debug)


def test_second_text_becomes_alias_not_definition():
    gray, work, visual, boxes, _ = legend_inputs()
    dup = OcrBox(text="PUMP SYMBOL", bbox=dict(boxes[0].bbox))
    dup.bbox["x"] += 5
    defs, _ = extract_definitions(gray, work, visual, boxes + [dup], "leg1")
    assert len(defs) == 4
    pump = next(d for d in defs if d.label == "Pump")
    assert "PUMP SYMBOL" in pump.aliases


def test_definitions_round_trip_model():
    gray, work, visual, boxes, _ = legend_inputs()
    defs, _ = extract_definitions(gray, work, visual, boxes, "leg1")
    for d in defs:
        d2 = LegendDefinition.from_dict(d.to_dict())
        assert d2.label == d.label and d2.symbolId == d.symbolId
