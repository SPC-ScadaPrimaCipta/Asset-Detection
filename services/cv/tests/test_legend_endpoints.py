"""Endpoint-level Legend tests + §20 OCR-context behavior.

/legend/extract runs real Tesseract on the synthetic legend (production path).
"""
import base64
import io
import json

import pytest

from legend_fixtures import legend_canvas, query_canvas


def png_b64(img) -> str:
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def content(resp) -> dict:
    return json.loads(resp.body.decode())


def test_legend_extract_endpoint_production_path():
    import app as appmod
    from ocr_providers import TesseractProvider
    if not TesseractProvider().available:
        pytest.skip("tesseract binary absent")
    img, _ = legend_canvas()
    resp = appmod.legend_extract_endpoint({
        "legendId": "leg-synth", "pdfSha256": "fixture-sha",
        "pages": [{"pageNumber": 1, "pngBase64": png_b64(img)}],
        "ocrProvider": "tesseract",
    })
    assert resp.status_code == 200
    data = content(resp)
    labels = sorted(d["label"] for d in data["definitions"])
    assert labels == ["Instrument", "PSV", "Pump", "Valve"], labels
    assert data["timings"]
    # Cache: second identical call hits.
    resp2 = appmod.legend_extract_endpoint({
        "legendId": "leg-synth", "pdfSha256": "fixture-sha",
        "pages": [{"pageNumber": 1, "pngBase64": png_b64(img)}],
        "ocrProvider": "tesseract",
    })
    assert content(resp2)["legendCache"]["hits"] >= 1


def test_legend_match_endpoint_ranks_and_provenance():
    import app as appmod
    from test_legend_match import build_definitions
    defs = build_definitions()
    img = query_canvas("Valve")
    resp = appmod.legend_match_endpoint({
        "selectedLegendId": "leg1",
        "pngBase64": png_b64(img), "pageNumber": 1,
        "candidates": [{"id": "q1", "bbox": {"x": 100, "y": 100, "width": 120, "height": 120}}],
        "definitions": defs,
    })
    assert resp.status_code == 200
    data = content(resp)
    assert data["selectedLegendId"] == "leg1"
    top = data["results"][0]["matches"][0]
    assert top["label"] == "Valve"
    assert top["selectedLegendId"] == "leg1"
    assert set(top["features"]) == {"geometryScore", "contourScore", "templateScore",
                                    "edgeScore", "scaleScore", "rotationScore"}
    assert data["instrumentation"]["attempted"] >= 4


def test_legend_match_unavailable_without_definitions():
    import app as appmod
    img = query_canvas("Valve")
    resp = appmod.legend_match_endpoint({
        "selectedLegendId": "leg1",
        "pngBase64": png_b64(img), "pageNumber": 1,
        "candidates": [{"id": "q1", "bbox": {"x": 100, "y": 100, "width": 120, "height": 120}}],
        "definitions": [],
    })
    assert resp.status_code == 200
    r = content(resp)["results"][0]
    assert r["matches"] == [] and "LEGEND_UNAVAILABLE" in r["warning"]


def test_label_match_endpoint():
    import app as appmod
    pump = {"label": "Pump", "aliases": []}
    assert content(appmod.legend_label_match_endpoint(
        {"query": "pump", "definition": pump}))["match"] is True
    assert content(appmod.legend_label_match_endpoint(
        {"query": "Compressor", "definition": pump}))["match"] is False


def _render_tag(text: str):
    import cv2
    import numpy as np
    img = np.full((120, 400, 3), 255, dtype=np.uint8)
    cv2.putText(img, text, (40, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 3, cv2.LINE_AA)
    return img


def test_known_tags_do_not_blindly_overwrite():
    import app as appmod
    from ocr_providers import TesseractProvider
    if not TesseractProvider().available:
        pytest.skip("tesseract binary absent")
    body = {"pngBase64": png_b64(_render_tag("P-10L")), "pageNumber": 1,
            "ocrProvider": "tesseract"}
    # No context: pattern-valid raw is preserved.
    plain = content(appmod.candidates_endpoint(dict(body)))
    texts = [c for c in plain["candidates"] if c["candidateType"] == "text"]
    assert texts and texts[0]["ocr"]["normalizedText"] == "P-10L"
    assert texts[0]["ocr"]["knownTagEvidence"] is None
    # Legend LABELS as knownTags: no effect (labels are not tags).
    with_labels = content(appmod.candidates_endpoint(
        dict(body, knownTags=["Pump", "Valve"])))
    t2 = [c for c in with_labels["candidates"] if c["candidateType"] == "text"][0]
    assert t2["ocr"]["normalizedText"] == "P-10L"
    # Genuine project known-tag context: corrected + auditable.
    with_known = content(appmod.candidates_endpoint(
        dict(body, knownTags=["P-101"])))
    t3 = [c for c in with_known["candidates"] if c["candidateType"] == "text"][0]
    assert t3["ocr"]["normalizedText"] == "P-101", t3["ocr"]
    assert t3["ocr"]["rawText"] == "P-10L"
    assert t3["ocr"]["knownTagEvidence"] is not None
    assert t3["ocr"]["correctionReason"] is not None
