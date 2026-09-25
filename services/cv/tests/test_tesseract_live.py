"""Production OCR smoke: real Tesseract 5 on rendered engineering text.

Skipped gracefully when the binary is absent (provider.available False).
"""
import numpy as np
import pytest

from fixtures import blank
from ocr_config import OcrConfig
from ocr_providers import TesseractProvider


def render_text(text: str, scale: int = 3) -> np.ndarray:
    import cv2
    img = blank(600, 150)
    cv2.putText(img, text, (40, 100), cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), max(2, scale), cv2.LINE_AA)
    return img


def test_tesseract_reads_clean_tag():
    provider = TesseractProvider(config=OcrConfig(psm=7))
    if not provider.available:
        pytest.skip("tesseract binary absent")
    boxes = provider.recognize(render_text("P-101A"))
    texts = [b.text.strip().upper() for b in boxes]
    assert any("P-101A" in t.replace(" ", "") for t in texts), texts


def test_tesseract_unavailable_degrades_not_raises():
    provider = TesseractProvider()
    if provider.available:
        pytest.skip("tesseract present — degradation path covered by mock tests")
    assert provider.recognize(blank()) == []
