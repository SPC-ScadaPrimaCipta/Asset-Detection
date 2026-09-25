"""
Detection V2 — deterministic confidence engine (Phase 6).

PRINCIPLES (do not violate):
  1. Evidence vector is preserved — every component score survives in the
     output. The engine NEVER collapses to a bare `confidence: 0.87`.
  2. Margin is first-class evidence: topScore alone cannot distinguish
     (Pump 0.86 vs Valve 0.63) from (Pump 0.86 vs Valve 0.84).
  3. Missing evidence is NOT negative evidence. An unavailable signal
     (e.g. OCR failed) is EXCLUDED from weighting (renormalized), plus a
     small explicit missingEvidencePenalty — never scored as 0.
  4. decisionBand (HIGH/REVIEW/LOW) is ROUTING, not a final asset decision.
     HIGH → continue pipeline; REVIEW/LOW → later Gemini verification /
     human review (Phase 7+).
  5. No AI calls here. Pure, reproducible, auditable.

Weights and thresholds are INITIAL engineering values — Phase 8 calibrates
them against ground truth. They live in ConfidenceConfig, not in logic.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field


@dataclass
class ConfidenceConfig:
    # Group weights (renormalized over AVAILABLE groups only).
    w_visual: float = 0.25
    w_geometry: float = 0.15
    w_legend: float = 0.30
    w_ocr: float = 0.15
    w_spatial: float = 0.15
    # Band thresholds (routing only).
    # Calibrated 2026-09-25 (precision pass): HIGH 0.90→0.80, mirrors
    # HIGH_CONFIDENCE_THRESHOLD in lib/env.ts (was unreachable).
    high_threshold: float = 0.80
    low_threshold: float = 0.70
    # Explicit, visible penalties (not hidden score manipulation).
    ambiguity_penalty_scale: float = 0.15  # × (1 - margin), applied when margin small
    missing_penalty_per_group: float = 0.02  # per unavailable group, capped
    missing_penalty_cap: float = 0.06

    @staticmethod
    def from_env() -> "ConfidenceConfig":
        def f(name: str, default: float) -> float:
            try:
                return float(os.environ.get(name, default))
            except (TypeError, ValueError):
                return default

        return ConfidenceConfig(
            high_threshold=f("HIGH_CONFIDENCE_THRESHOLD", 0.80),
            low_threshold=f("LOW_CONFIDENCE_THRESHOLD", 0.70),
        )

    @staticmethod
    def from_dict(raw: dict | None) -> "ConfidenceConfig":
        base = ConfidenceConfig.from_env()
        if not raw:
            return base
        allowed = set(ConfidenceConfig.__dataclass_fields__)
        for k, v in raw.items():
            if k in allowed:
                try:
                    setattr(base, k, float(v))
                except (TypeError, ValueError):
                    pass
        return base


@dataclass
class ConfidenceEvidence:
    geometryScore: float | None = None
    contourScore: float | None = None
    templateScore: float | None = None
    edgeScore: float | None = None
    scaleScore: float | None = None
    rotationScore: float | None = None
    legendMatchScore: float | None = None
    legendMargin: float | None = None
    tagRecognitionScore: float | None = None
    spatialAssociationScore: float | None = None
    spatialMargin: float | None = None
    ambiguityPenalty: float = 0.0
    missingEvidencePenalty: float = 0.0
    unavailable: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ConfidenceOutput:
    candidateId: str = ""
    confidence: float = 0.0
    decisionBand: str = "REVIEW"  # HIGH | REVIEW | LOW
    topMatch: dict = field(default_factory=dict)  # {symbolId, label}
    margin: float = 0.0
    evidence: ConfidenceEvidence = field(default_factory=ConfidenceEvidence)
    reasons: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    configVersion: str = "confidence-v1"

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _mean(values: list) -> float | None:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def compute_confidence(candidate_id: str, signals: dict,
                       legend_matches: list | None = None,
                       spatial_ranked: list | None = None,
                       ocr: dict | None = None,
                       cfg: ConfidenceConfig | None = None) -> ConfidenceOutput:
    """Assemble evidence → confidence + band + audit trail.

    signals: {geometryScore, contourScore, templateScore, edgeScore,
              scaleScore, rotationScore} (any may be None = unavailable).
    legend_matches: ranked [{legendSymbolId, label, score}] (top-first).
    spatial_ranked: ranked [{symbolId, score}] (top-first).
    ocr: {isTag, confidence} — None means OCR unavailable (NOT zero).
    """
    cfg = cfg or ConfidenceConfig.from_env()
    ev = ConfidenceEvidence()
    reasons: list[str] = []
    warnings: list[str] = []

    # ── Visual group (contour/template/edge; scale+rotation informational) ──
    visual = _mean([signals.get("contourScore"), signals.get("templateScore"),
                    signals.get("edgeScore")])
    ev.contourScore = signals.get("contourScore")
    ev.templateScore = signals.get("templateScore")
    ev.edgeScore = signals.get("edgeScore")
    ev.scaleScore = signals.get("scaleScore")
    ev.rotationScore = signals.get("rotationScore")

    # ── Geometry group ──
    geometry = _mean([signals.get("geometryScore"), signals.get("scaleScore")])
    ev.geometryScore = signals.get("geometryScore")

    # ── Legend group (+ margin) ──
    legend_matches = legend_matches or []
    top_score = legend_matches[0]["score"] if legend_matches else None
    second_score = legend_matches[1]["score"] if len(legend_matches) > 1 else None
    legend_margin = (top_score - second_score) if (
        top_score is not None and second_score is not None) else None
    ev.legendMatchScore = top_score
    ev.legendMargin = legend_margin
    top_match = {}
    if legend_matches:
        top_match = {"symbolId": legend_matches[0].get("legendSymbolId"),
                     "label": legend_matches[0].get("label")}
        reasons.append(
            f"Top Legend match {top_match.get('label')} score={top_score:.3f}")
        if legend_margin is not None:
            reasons.append(f"Legend margin={legend_margin:.3f} "
                           f"(second {legend_matches[1].get('label')} {second_score:.3f})")

    # ── OCR/tag group (missing ≠ zero) ──
    tag_score = None
    if ocr is not None:
        if ocr.get("isTag"):
            tag_score = max(0.0, min(1.0, float(ocr.get("confidence", 0.5))))
            reasons.append(f"Tag recognized (confidence {tag_score:.2f})")
        else:
            tag_score = 0.25  # text present but not tag-like: weak, not zero
            warnings.append("OCR text present but not tag-like")
    ev.tagRecognitionScore = tag_score

    # ── Spatial group (+ margin) ──
    spatial_ranked = spatial_ranked or []
    spat_top = spatial_ranked[0]["score"] if spatial_ranked else None
    spat_second = spatial_ranked[1]["score"] if len(spatial_ranked) > 1 else None
    spat_margin = (spat_top - spat_second) if (
        spat_top is not None and spat_second is not None) else None
    ev.spatialAssociationScore = spat_top
    ev.spatialMargin = spat_margin
    if spat_top is not None:
        reasons.append(f"Spatial association score={spat_top:.3f}")

    # ── Dynamic weighting over AVAILABLE groups only ──
    groups: list[tuple[str, float | None, float]] = [
        ("visual", visual, cfg.w_visual),
        ("geometry", geometry, cfg.w_geometry),
        ("legend", top_score, cfg.w_legend),
        ("ocr", tag_score, cfg.w_ocr),
        ("spatial", spat_top, cfg.w_spatial),
    ]
    active = [(n, v, w) for n, v, w in groups if v is not None]
    missing = [n for n, v, w in groups if v is None]
    ev.unavailable = missing
    for n in missing:
        warnings.append(f"{n} evidence unavailable — excluded from weighting")
    if not active:
        return ConfidenceOutput(
            candidateId=candidate_id, confidence=0.0, decisionBand="LOW",
            topMatch=top_match, margin=legend_margin or 0.0,
            evidence=ev,
            reasons=reasons + ["No evidence available"],
            warnings=warnings + ["empty evidence vector"],
        )
    wsum = sum(w for _, _, w in active)
    base = sum(v * (w / wsum) for _, v, w in active)

    # ── Ambiguity penalty (margin-driven, explicit) ──
    margins = [m for m in (legend_margin, spat_margin) if m is not None]
    ambiguity = 0.0
    if margins:
        worst_margin = min(margins)
        ev_val = max(0.0, min(1.0, worst_margin))
        ambiguity = cfg.ambiguity_penalty_scale * (1.0 - ev_val)
        if worst_margin < 0.15:
            warnings.append(f"Low match margin ({worst_margin:.3f}) — ambiguous")
            reasons.append(f"Ambiguity penalty applied ({ambiguity:.3f})")
    ev.ambiguityPenalty = round(ambiguity, 4)

    # ── Missing-evidence penalty (small, capped, visible) ──
    missing_pen = min(cfg.missing_penalty_cap,
                      len(missing) * cfg.missing_penalty_per_group)
    ev.missingEvidencePenalty = round(missing_pen, 4)
    if missing_pen > 0:
        reasons.append(f"Missing-evidence penalty ({missing_pen:.3f} "
                       f"for: {', '.join(missing)})")

    confidence = _clamp01(base - ambiguity - missing_pen)
    margin = legend_margin if legend_margin is not None else 0.0
    if confidence >= cfg.high_threshold:
        band = "HIGH"
        reasons.append(f"Band HIGH (≥ {cfg.high_threshold}) → continue pipeline")
    elif confidence >= cfg.low_threshold:
        band = "REVIEW"
        reasons.append(f"Band REVIEW → Gemini verification later (Phase 7)")
    else:
        band = "LOW"
        reasons.append(f"Band LOW (< {cfg.low_threshold}) → review queue")
        warnings.append("Low confidence — needs human review")

    return ConfidenceOutput(
        candidateId=candidate_id,
        confidence=round(confidence, 4),
        decisionBand=band,
        topMatch=top_match,
        margin=round(margin, 4),
        evidence=ev,
        reasons=reasons,
        warnings=warnings,
    )
