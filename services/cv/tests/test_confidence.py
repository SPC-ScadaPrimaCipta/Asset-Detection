"""Phase 6 — confidence engine behavior (evidence, margin, missing, bands)."""
from confidence_engine import ConfidenceConfig, compute_confidence

STRONG = {"geometryScore": 0.91, "contourScore": 0.84, "templateScore": 0.77,
          "edgeScore": 0.81, "scaleScore": 0.95, "rotationScore": 1.0}
LEGEND_CLEAR = [{"legendSymbolId": "pump-01", "label": "Pump", "score": 0.86},
                {"legendSymbolId": "valve-02", "label": "Valve", "score": 0.63},
                {"legendSymbolId": "psv-03", "label": "PSV", "score": 0.41}]
LEGEND_TIED = [{"legendSymbolId": "pump-01", "label": "Pump", "score": 0.86},
               {"legendSymbolId": "valve-02", "label": "Valve", "score": 0.84},
               {"legendSymbolId": "psv-03", "label": "PSV", "score": 0.41}]
SPATIAL = [{"symbolId": "s42", "score": 0.88}, {"symbolId": "s57", "score": 0.60}]
OCR_GOOD = {"isTag": True, "confidence": 0.93}


def test_evidence_vector_preserved_not_collapsed():
    out = compute_confidence("cv-042", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD)
    d = out.to_dict()
    ev = d["evidence"]
    for k in ("geometryScore", "contourScore", "templateScore", "edgeScore",
              "scaleScore", "rotationScore", "legendMatchScore", "legendMargin",
              "tagRecognitionScore", "spatialAssociationScore", "spatialMargin",
              "ambiguityPenalty", "missingEvidencePenalty", "unavailable"):
        assert k in ev, k
    assert ev["legendMatchScore"] == 0.86
    assert ev["unavailable"] == []


def test_margin_distinguishes_clear_from_ambiguous():
    clear = compute_confidence("a", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD)
    tied = compute_confidence("b", STRONG, LEGEND_TIED, SPATIAL, OCR_GOOD)
    assert clear.margin == 0.23  # 0.86 - 0.63
    assert tied.margin == 0.02  # 0.86 - 0.84
    assert tied.confidence < clear.confidence  # ambiguity penalized
    assert any("margin" in r.lower() for r in tied.reasons)


def test_missing_ocr_is_not_negative():
    full = compute_confidence("a", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD)
    no_ocr = compute_confidence("b", STRONG, LEGEND_CLEAR, SPATIAL, None)
    assert no_ocr.evidence.tagRecognitionScore is None
    assert "ocr" in no_ocr.evidence.unavailable
    # Strong visual+legend must NOT collapse: small explicit penalty only.
    assert no_ocr.confidence > 0.70, no_ocr.confidence
    assert full.confidence - no_ocr.confidence < 0.15
    assert no_ocr.evidence.missingEvidencePenalty > 0


def test_empty_evidence_vector_safe():
    out = compute_confidence("x", {}, [], [], None)
    assert out.confidence == 0.0
    assert out.decisionBand == "LOW"
    assert "empty evidence" in " ".join(out.warnings).lower()


def test_bands_are_routing_not_decisions():
    cfg = ConfidenceConfig()
    hi = compute_confidence("h", {"geometryScore": 1.0, "contourScore": 1.0,
                                  "templateScore": 1.0, "edgeScore": 1.0,
                                  "scaleScore": 1.0, "rotationScore": 1.0},
                            [{"legendSymbolId": "p", "label": "Pump", "score": 1.0}],
                            [{"symbolId": "s", "score": 1.0}],
                            {"isTag": True, "confidence": 1.0}, cfg)
    assert hi.decisionBand == "HIGH"
    lo = compute_confidence("l", {"geometryScore": 0.2}, [], [], None, cfg)
    assert lo.decisionBand == "LOW"
    mid = compute_confidence("m", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD, cfg)
    assert mid.decisionBand in ("HIGH", "REVIEW", "LOW")
    assert any("Band" in r for r in mid.reasons)


def test_audit_shape_matches_contract():
    out = compute_confidence("cv-042", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD)
    d = out.to_dict()
    assert d["candidateId"] == "cv-042"
    assert d["topMatch"] == {"symbolId": "pump-01", "label": "Pump"}
    assert isinstance(d["confidence"], float) and 0 <= d["confidence"] <= 1
    assert d["decisionBand"] in ("HIGH", "REVIEW", "LOW")
    assert d["reasons"] and isinstance(d["reasons"], list)


def test_deterministic_repeated_calls():
    a = compute_confidence("c", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD).to_dict()
    b = compute_confidence("c", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD).to_dict()
    assert a == b


def test_config_overrides_respected():
    cfg = ConfidenceConfig.from_dict({"high_threshold": 0.5, "low_threshold": 0.2,
                                      "w_legend": 0.9})
    assert cfg.high_threshold == 0.5 and cfg.w_legend == 0.9
    out = compute_confidence("c", STRONG, LEGEND_CLEAR, SPATIAL, OCR_GOOD, cfg)
    assert out.decisionBand == "HIGH"  # lower bar routes HIGH


def test_non_tag_text_is_weak_not_zero():
    out = compute_confidence("c", STRONG, LEGEND_CLEAR, SPATIAL,
                             {"isTag": False, "confidence": 0.8})
    assert out.evidence.tagRecognitionScore == 0.25
    assert any("not tag-like" in w for w in out.warnings)
