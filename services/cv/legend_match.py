"""
Detection V2 — deterministic Legend matching (multi-signal, cascaded).

Signals: geometry → Hu/contour → edge/line → template (multi-scale,
rotation-aware per definition flag). Template is ONE signal, never the
sole decision. Output is ranked EVIDENCE for Phase 6, not confidence.

Cascade (cheap first) with instrumentation: attempted / skipped /
full / accepted + timings.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class MatchConfig:
    # Initial engineering parameters ONLY — Phase 6 calibrates (Phase 8 data).
    min_geometry: float = 0.3
    min_contour: float = 0.3
    min_template: float = 0.2
    max_candidates: int = 5
    scales: tuple = (0.7, 0.85, 1.0, 1.2, 1.4)
    rotations: tuple = (0, 90, 180, 270)


@dataclass
class MatchInstrumentation:
    attempted: int = 0
    skipped_geometry: int = 0
    skipped_contour: int = 0
    full_comparisons: int = 0
    accepted: int = 0
    timings: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"attempted": self.attempted, "skippedGeometry": self.skipped_geometry,
                "skippedContour": self.skipped_contour,
                "fullComparisons": self.full_comparisons, "accepted": self.accepted,
                "timings": self.timings}


def geometry_score(aspect: float, var_aspect: float) -> tuple[float, str]:
    if aspect <= 0 or var_aspect <= 0:
        return 0.0, "aspect invalid"
    ratio = min(aspect, var_aspect) / max(aspect, var_aspect)
    return round(ratio, 4), f"aspect compatibility={ratio:.3f}"


# Below this magnitude a moment is raster noise on both sides — incomparable.
HU_NOISE_FLOOR = 1e-9


def contour_score(hu_a: list, hu_b: list) -> tuple[float, str]:
    """Noise-gated relative Hu distance over RAW moments.

    A component contributes only when detectable (≥ floor) on at least one
    side; contribution is |a-b|/max(|a|,|b|) capped at 1. Identical renders
    score ~1 (only hu1 compares); sign-flipping sub-floor noise is ignored
    instead of dominating the distance.
    """
    if not hu_a or not hu_b or len(hu_a) != len(hu_b):
        return 0.0, "hu moments unavailable"
    total, n = 0.0, 0
    for a, b in zip(hu_a, hu_b):
        m = max(abs(float(a)), abs(float(b)))
        if m < HU_NOISE_FLOOR:
            continue
        total += min(1.0, abs(float(a) - float(b)) / m)
        n += 1
    if n == 0:
        return 1.0, "all moments below noise floor (both blank-like)"
    mean_diff = total / n
    score = 1.0 / (1.0 + 3.0 * mean_diff)
    return round(score, 4), f"hu gated-relative-diff={mean_diff:.3f} over {n}/7"


def _rotate(img: np.ndarray, deg: int) -> np.ndarray:
    if deg == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if deg == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    if deg == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img


def template_match(cand: np.ndarray, tmpl: np.ndarray, scales: tuple,
                   rotations: tuple) -> tuple[float, float, int, str]:
    """Best normalized cross-correlation over scales × rotations."""
    best, best_scale, best_rot = -1.0, 1.0, 0
    th, tw = tmpl.shape[:2]
    for scale in scales:
        sw, sh = max(8, int(tw * scale)), max(8, int(th * scale))
        if sw > cand.shape[1] or sh > cand.shape[0]:
            continue
        scaled = cv2.resize(tmpl, (sw, sh), interpolation=cv2.INTER_AREA)
        for rot in rotations:
            r = _rotate(scaled, rot)
            rh, rw = r.shape[:2]
            if rh > cand.shape[0] or rw > cand.shape[1]:
                continue
            res = cv2.matchTemplate(cand, r, cv2.TM_CCOEFF_NORMED)
            v = float(res.max())
            if v > best:
                best, best_scale, best_rot = v, scale, rot
    best = max(0.0, best) if best >= 0 else 0.0
    return round(best, 4), best_scale, best_rot, (
        f"template match at scale {best_scale} rot {best_rot}°" if best > 0
        else "template found no valid scale")


def edge_score(cand_edge: float, var_edge: float,
               cand_lines: int, var_lines: int) -> tuple[float, str]:
    e = 1.0 - min(1.0, abs(cand_edge - var_edge))
    l = 1.0 - min(1.0, abs(cand_lines - var_lines) / max(1, max(cand_lines, var_lines)))
    return round(0.5 * e + 0.5 * l, 4), f"edgeΔ={abs(cand_edge-var_edge):.3f} lineΔ={abs(cand_lines-var_lines)}"


def match_candidate(candidate: dict, definitions: list,
                    cfg: MatchConfig | None = None,
                    instr: MatchInstrumentation | None = None) -> list[dict]:
    """candidate: {id, aspectRatio, huMoments, edgeDensity, lineCount, normCrop}.
    definitions: list of LegendDefinition.to_dict(). Returns ranked matches."""
    import time
    cfg = cfg or MatchConfig()
    instr = instr or MatchInstrumentation()
    matches: list[dict] = []
    for d in definitions:
        for v in d.get("variants", []):
            instr.attempted += 1
            t0 = time.perf_counter()
            g, greason = geometry_score(candidate.get("aspectRatio", 0.0),
                                        v.get("aspectRatio", 0.0))
            if g < cfg.min_geometry:
                instr.skipped_geometry += 1
                continue
            c, creason = contour_score(candidate.get("huMoments", []),
                                       v.get("huMoments", []))
            if c < cfg.min_contour:
                instr.skipped_contour += 1
                continue
            e, ereason = edge_score(candidate.get("edgeDensity", 0.0),
                                    v.get("edgeDensity", 0.0),
                                    candidate.get("lineCount", 0),
                                    v.get("lineCount", 0))
            rotations = cfg.rotations if d.get("rotationInvariant") else (0,)
            tmpl = _decode_norm(v.get("normalizedPng", ""))
            if tmpl is None:
                t, scale, rot, treason = 0.0, 1.0, 0, "template image missing"
            else:
                t, scale, rot, treason = template_match(
                    candidate["normCrop"], tmpl, cfg.scales, rotations)
            instr.full_comparisons += 1
            if t < cfg.min_template:
                continue
            score = round(0.25 * g + 0.30 * c + 0.15 * e + 0.30 * t, 4)
            instr.accepted += 1
            ms = round((time.perf_counter() - t0) * 1000.0, 2)
            instr.timings[d.get("symbolId", "?")] = ms
            matches.append({
                "legendSymbolId": d.get("symbolId"),
                "legendId": d.get("legendId"),
                "label": d.get("label"),
                "variantId": v.get("variantId"),
                "features": {
                    "geometryScore": g, "contourScore": c,
                    "templateScore": t, "edgeScore": e,
                    "scaleScore": round(scale, 3), "rotationScore": rot,
                },
                "score": score,
                "reasons": [greason, creason, ereason, treason],
            })
    # Deterministic ordering: score desc, then symbolId asc (ties stable).
    matches.sort(key=lambda m: (-m["score"], str(m["legendSymbolId"])))
    return matches[: cfg.max_candidates]


def _decode_norm(png_b64: str):
    if not png_b64:
        return None
    try:
        import base64 as _b64
        raw = _b64.b64decode(png_b64)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        return img
    except Exception:
        return None
