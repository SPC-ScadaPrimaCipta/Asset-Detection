import numpy as np
import pytest

from fixtures import blank
from ocr_providers import MockOCRProvider, OcrBox, TesseractProvider, get_provider


def test_mock_returns_fixtures_without_binaries():
    fx = [OcrBox(text="P-101", bbox={"x": 10, "y": 20, "width": 60, "height": 22}, confidence=0.9)]
    assert MockOCRProvider(fx).recognize(blank()) == fx


def test_mock_empty_defaults_to_no_text():
    assert MockOCRProvider().recognize(blank()) == []


def test_mock_never_raises_on_bad_input():
    assert MockOCRProvider().recognize(None) == []  # type: ignore[arg-type]


def test_bbox_preserved_in_input_coordinates():
    fx = [OcrBox(text="V-201", bbox={"x": 5, "y": 6, "width": 7, "height": 8})]
    out = MockOCRProvider(fx).recognize(np.zeros((100, 100, 3), dtype=np.uint8))
    assert out[0].bbox == {"x": 5, "y": 6, "width": 7, "height": 8}


def test_unknown_provider_rejected():
    with pytest.raises(ValueError):
        get_provider("nope")


def test_tesseract_degrades_gracefully():
    p = TesseractProvider()
    assert isinstance(p.available, bool)
    # recognize must never raise even when engine is missing
    assert isinstance(p.recognize(blank()), list)
