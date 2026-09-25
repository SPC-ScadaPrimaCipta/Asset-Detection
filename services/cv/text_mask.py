"""
Phase 9.1 — text-aware candidate suppression (FP reduction, NOT hard deletion).

A visual candidate fully inside an OCR text region that is MUCH BIGGER than
itself is almost certainly a glyph fragment (letter/punctuation blob), not a
symbol. Suppression rules (all auditable, all configurable):

  suppress iff containment(candidate, textbox) >= contain_thr
            AND textboxArea > candidateArea * text_bigger_factor
            AND NOT keep-signals

Keep-signals (a real symbol next to/with text is never deleted for overlap):
  - closed large geometry (area >= keep_area_min AND convexity >= min_convexity)
  - restore pass: top legend match score >= restore_score (handled by caller,
    which owns matching; this module only marks suppression with reasons)

Suppressed items are RETURNED with reasons (debug/ablation), never dropped
silently. Symbols merely NEAR text (containment ~0) are untouched.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class MaskConfig:
    contain_thr: float = 0.6
    text_bigger_factor: float = 2.0
    keep_area_min: float = 1500.0
    min_convexity: float = 0.85

    @staticmethod
    def from_dict(raw: dict | None) -> "MaskConfig":
        base = MaskConfig()
        if not raw:
            return base
        allowed = set(MaskConfig.__dataclass_fields__)
        for k, v in raw.items():
            if k in allowed:
                try:
                    setattr(base, k, float(v))
                except (TypeError, ValueError):
                    pass
        return base


@dataclass
class Suppressed:
    candidateId: str = ""
    reason: str = ""
    containment: float = 0.0
    candidateArea: float = 0.0
    textArea: float = 0.0

    def to_dict(self) -> dict:
        return {"candidateId": self.candidateId, "reason": self.reason,
                "containment": round(self.containment, 3),
                "candidateArea": self.candidateArea, "textArea": self.textArea}


def _containment(inner: dict, outer: dict) -> float:
    ix0, iy0 = max(inner["x"], outer["x"]), max(inner["y"], outer["y"])
    ix1 = min(inner["x"] + inner["width"], outer["x"] + outer["width"])
    iy1 = min(inner["y"] + inner["height"], outer["y"] + outer["height"])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    area = inner["width"] * inner["height"]
    return inter / area if area > 0 else 0.0


def _convexity_of(candidate) -> float:
    geo = getattr(candidate, "geometry", None)
    if geo is not None and getattr(geo, "convexity", None) is not None:
        return float(geo.convexity)
    if isinstance(candidate, dict):
        return float(candidate.get("convexity", 0.0))
    return 0.0


def suppress_glyphs(candidates: list, ocr_boxes: list,
                    cfg: MaskConfig | None = None) -> tuple[list, list[Suppressed]]:
    """Split candidates into (kept, suppressed-with-reasons).

    ocr_boxes: list of {bbox} (OcrBox or dict with .bbox/['bbox']).
    """
    cfg = cfg or MaskConfig()
    kept, suppressed = [], []
    boxes = []
    for ob in ocr_boxes:
        b = ob.bbox if hasattr(ob, "bbox") else ob.get("bbox", {})
        if b.get("width") and b.get("height"):
            boxes.append(b)
    for cand in candidates:
        cb = cand.bbox if hasattr(cand, "bbox") else cand.get("bbox", {})
        cid = cand.candidateId if hasattr(cand, "candidateId") else cand.get("candidateId", "?")
        area = float(cb.get("width", 0)) * float(cb.get("height", 0))
        verdict = None
        for tb in boxes:
            cont = _containment(cb, tb)
            tarea = float(tb["width"]) * float(tb["height"])
            if cont >= cfg.contain_thr and tarea > area * cfg.text_bigger_factor:
                conv = _convexity_of(cand)
                if area >= cfg.keep_area_min and conv >= cfg.min_convexity:
                    verdict = (f"kept: closed large geometry "
                               f"(area {area:.0f}, convexity {conv:.2f}) despite "
                               f"text containment {cont:.2f}")
                    break
                verdict = None
                suppressed.append(Suppressed(
                    candidateId=cid,
                    reason=(f"glyph fragment: containment {cont:.2f} in text region "
                            f"(cand {area:.0f}px² vs text {tarea:.0f}px²)"),
                    containment=cont, candidateArea=area, textArea=tarea))
                break
            elif cont >= cfg.contain_thr:
                verdict = (f"kept: text-sized overlap only "
                           f"(containment {cont:.2f}, areas comparable)")
                break
        if verdict is not None or not any(
                s.candidateId == cid for s in suppressed):
            if verdict is None:
                verdict = "kept: no text-region containment"
            if hasattr(cand, "evidence") and getattr(cand.evidence, "notes", None) is not None:
                cand.evidence.notes = list(cand.evidence.notes) + [f"text-mask: {verdict}"]
            kept.append(cand)
    return kept, suppressed
