"""Phase 6 endpoint + full-evidence integration (no Gemini)."""
import json


def content(resp) -> dict:
    return json.loads(resp.body.decode())


def test_confidence_endpoint_contract():
    import app as appmod
    resp = appmod.confidence_score_endpoint({
        "candidateId": "cv-042",
        "signals": {"geometryScore": 0.91, "contourScore": 0.84,
                    "templateScore": 0.77, "edgeScore": 0.81,
                    "scaleScore": 0.95, "rotationScore": 1.0},
        "legendMatches": [
            {"legendSymbolId": "pump-01", "label": "Pump", "score": 0.86},
            {"legendSymbolId": "valve-02", "label": "Valve", "score": 0.63}],
        "spatialRanked": [{"symbolId": "s42", "score": 0.88}],
        "ocr": {"isTag": True, "confidence": 0.93},
    })
    assert resp.status_code == 200
    d = content(resp)
    assert d["candidateId"] == "cv-042"
    assert d["topMatch"]["label"] == "Pump"
    assert d["margin"] == 0.23
    assert d["evidence"]["legendMatchScore"] == 0.86
    assert d["decisionBand"] in ("HIGH", "REVIEW", "LOW")
    assert d["timings"] and d["pipelineVersion"]


def test_confidence_endpoint_requires_candidate():
    import app as appmod
    resp = appmod.confidence_score_endpoint({"signals": {}})
    assert resp.status_code == 400
    assert content(resp)["error"]


def test_full_evidence_pipeline_fixture():
    """Legend match output feeds confidence directly (contract check)."""
    import app as appmod
    from test_legend_endpoints import png_b64
    from test_legend_match import build_definitions
    from legend_fixtures import query_canvas
    defs = build_definitions()
    match_data = content(appmod.legend_match_endpoint({
        "selectedLegendId": "leg1",
        "pngBase64": png_b64(query_canvas("Pump")), "pageNumber": 1,
        "candidates": [{"id": "q1", "bbox": {"x": 100, "y": 100, "width": 120, "height": 120}}],
        "definitions": defs,
    }))
    top2 = match_data["results"][0]["matches"][:2]
    assert top2[0]["label"] == "Pump"
    first = top2[0]
    conf = content(appmod.confidence_score_endpoint({
        "candidateId": "q1",
        "signals": {"geometryScore": first["features"]["geometryScore"],
                    "contourScore": first["features"]["contourScore"],
                    "templateScore": first["features"]["templateScore"],
                    "edgeScore": first["features"]["edgeScore"],
                    "scaleScore": first["features"]["scaleScore"],
                    "rotationScore": 0.0},
        "legendMatches": [{"legendSymbolId": m["legendSymbolId"],
                           "label": m["label"], "score": m["score"]} for m in top2],
        "spatialRanked": [{"symbolId": "s1", "score": 0.8}],
        "ocr": {"isTag": True, "confidence": 0.9},
    }))
    assert conf["topMatch"]["label"] == "Pump"
    assert conf["evidence"]["unavailable"] == []
    assert conf["reasons"] and conf["decisionBand"] in ("HIGH", "REVIEW", "LOW")
