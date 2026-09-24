"""
Phase 3 integration: synthetic drawing (symbol + nearby tag + line + noise)
→ visual candidate exists, OCR/text candidate exists, both map to page
coordinates. No Gemini. Endpoint functions called in-process (no server).
"""
import base64

import cv2
import numpy as np

from fixtures import blank
from tiling import tile_to_page


def synthetic_page() -> np.ndarray:
    img = blank(640, 480)
    cv2.rectangle(img, (200, 150), (280, 230), (0, 0, 0), 2)  # symbol
    cv2.line(img, (0, 400), (640, 400), (0, 0, 0), 2)          # process line
    rng = np.random.default_rng(11)
    for _ in range(30):
        img[int(rng.integers(0, 480)), int(rng.integers(0, 640))] = (0, 0, 0)
    return img


def to_b64(img: np.ndarray) -> str:
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _content(resp) -> dict:
    import json
    return json.loads(resp.body.decode())


def test_candidates_endpoint_visual_path():
    from app import candidates_endpoint
    resp = candidates_endpoint({"pngBase64": to_b64(synthetic_page()), "pageNumber": 3})
    assert resp.status_code == 200
    data = _content(resp)
    visuals = [c for c in data["candidates"] if c["candidateType"] == "visual"]
    assert len(visuals) >= 1
    # Symbol rect should be covered by some candidate bbox.
    assert any(c["bbox"]["x"] <= 200 and c["bbox"]["y"] <= 150
               and c["bbox"]["x"] + c["bbox"]["width"] >= 280
               and c["bbox"]["y"] + c["bbox"]["height"] >= 230 for c in visuals)
    assert data["pipelineVersion"]
    assert isinstance(data["timings"], list) and len(data["timings"]) >= 3
    assert data["tile"]["pageWidth"] == 640


def test_candidates_endpoint_tile_echo_and_page_mapping():
    from app import candidates_endpoint
    tile = {"tileX": 100, "tileY": 50, "tileIndex": 4, "pageWidth": 640,
            "pageHeight": 480, "overlap": 0.2}
    resp = candidates_endpoint({"pngBase64": to_b64(synthetic_page()),
                                "pageNumber": 3, "tile": tile})
    data = _content(resp)
    assert data["tile"]["tileX"] == 100 and data["tile"]["tileIndex"] == 4
    # Every tile-local candidate maps into page space inside the page.
    for c in data["candidates"]:
        page = tile_to_page(c["bbox"], {"x": 100, "y": 50})
        assert 0 <= page["x"] < 640 and 0 <= page["y"] < 480


def test_ocr_and_tag_path_with_mock_fixture(monkeypatch):
    import app as appmod
    from ocr_providers import OcrBox
    fx = [OcrBox(text="P-101A", bbox={"x": 200, "y": 120, "width": 60, "height": 22},
                 confidence=0.9)]
    monkeypatch.setattr(appmod, "get_provider", lambda name, **kw: MockProvider(fx))
    resp = appmod.candidates_endpoint({"pngBase64": to_b64(synthetic_page()), "pageNumber": 1})
    data = _content(resp)
    texts = [c for c in data["candidates"] if c["candidateType"] == "text"]
    assert len(texts) == 1
    assert texts[0]["ocr"]["text"] == "P-101A"
    assert texts[0]["tag"]["isTag"] is True
    assert (texts[0]["tag"]["prefix"], texts[0]["tag"]["number"], texts[0]["tag"]["suffix"]) == ("P", "101", "A")


class MockProvider:
    def __init__(self, fx):
        self._fx = fx
        self.available = True
    def recognize(self, image):
        return list(self._fx)


def test_structured_errors_not_tracebacks():
    from app import candidates_endpoint, ocr_endpoint
    for resp in (candidates_endpoint({}),
                 candidates_endpoint({"pngBase64": "!!!not-base64!!!"}),
                 ocr_endpoint({"pngBase64": to_b64(blank()), "ocrProvider": "nope"})):
        assert resp.status_code in (400, 415)
        data = _content(resp)
        assert "error" in data and "message" in data and "pipelineVersion" in data
        assert "Traceback" not in data["message"]
