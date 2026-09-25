"""
Detection V2 — ranked text↔symbol association evidence (Python mirror).

TS authoritative implementation: lib/detection/geometry/spatial-association.ts.
This module implements the SAME evidence model service-side for metrics and
endpoint enrichment. It NEVER decides winners: every text returns a RANKED
list; later phases (legend, confidence) resolve.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

from dedup import center_distance, iou


@dataclass
class AssociationFeatures:
    tagPatternScore: float = 0.0   # 1.0 valid tag, 0.5 tag-like, else 0
    distanceScore: float = 0.0     # 1 - normalizedDistance/maxNorm
    overlapScore: float = 0.0      # IoU (0..1)
    directionScore: float = 0.0    # neutral adjacent prior
    sizeScore: float = 0.0         # text/symbol size plausibility

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RankedAssociation:
    textId: str = ""
    symbolId: str = ""
    distance: float = 0.0
    normalizedDistance: float = 0.0
    edgeDistance: float = 0.0
    overlap: float = 0.0
    direction: str = ""
    features: AssociationFeatures = field(default_factory=AssociationFeatures)
    score: float = 0.0
    reasons: list = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _direction(sbbox: dict, tbbox: dict, overlap: float) -> str:
    if overlap > 0:
        return "OVERLAP"
    sx, sy = sbbox["x"] + sbbox["width"] / 2, sbbox["y"] + sbbox["height"] / 2
    tx, ty = tbbox["x"] + tbbox["width"] / 2, tbbox["y"] + tbbox["height"] / 2
    import math
    angle = math.degrees(math.atan2(-(ty - sy), tx - sx))
    for lo, hi, name in [(-22.5, 22.5, "E"), (22.5, 67.5, "NE"), (67.5, 112.5, "N"),
                         (112.5, 157.5, "NW"), (-157.5, -112.5, "SW"),
                         (-112.5, -67.5, "S"), (-67.5, -22.5, "SE")]:
        if lo <= angle < hi:
            return name
    return "W" if abs(angle) >= 157.5 else "SE"


def _valid_box(b: dict) -> bool:
    try:
        return (b["width"] > 0 and b["height"] > 0
                and all(v == v and abs(v) != float("inf")
                        for v in (b["x"], b["y"], b["width"], b["height"])))
    except (KeyError, TypeError):
        return False


def rank_associations(text: dict, symbols: list,
                      page: dict, max_norm: float = 0.15) -> list[RankedAssociation]:
    """Rank ALL in-gate symbols for one text (page-space dicts)."""
    diag = (page["pageWidth"] ** 2 + page["pageHeight"] ** 2) ** 0.5
    out: list[RankedAssociation] = []
    tb = text["bbox"]
    if not _valid_box(tb) or diag <= 0:
        return out
    for sym in symbols:
        sb = sym["bbox"]
        if not _valid_box(sb):
            continue
        dist = center_distance(tb, sb)
        norm = dist / diag
        if norm > max_norm:
            continue
        ov = iou(tb, sb)
        feats = AssociationFeatures(
            tagPatternScore=1.0 if text.get("isTag") else (0.5 if text.get("tagLike") else 0.0),
            distanceScore=max(0.0, 1 - norm / max_norm),
            overlapScore=ov,
            directionScore=max(0.0, 1 - norm / max_norm) * 0.5 + 0.5 * min(1.0, ov + 0.5),
        )
        # Size plausibility: text height vs symbol height within 64x band.
        th, sh = tb["height"], sb["height"]
        ratio = (th / sh) if sh > 0 else 0.0
        feats.sizeScore = 1.0 if 0.02 <= ratio <= 2.0 else max(0.0, 1.0 - abs(ratio - 1.0) / 8.0)
        score = (0.35 * feats.distanceScore + 0.25 * feats.tagPatternScore
                 + 0.15 * feats.overlapScore + 0.10 * feats.directionScore
                 + 0.15 * feats.sizeScore)
        reasons = [
            f"normalizedDistance={norm:.4f} (gate {max_norm})",
            f"tagPattern={'valid' if text.get('isTag') else 'weak/absent'}",
            f"direction={_direction(sb, tb, ov)}",
            f"sizeRatio={ratio:.3f}",
        ]
        ex = ((max(tb["x"], sb["x"]) - min(tb["x"] + tb["width"], sb["x"] + sb["width"])) )
        ey = ((max(tb["y"], sb["y"]) - min(tb["y"] + tb["height"], sb["y"] + sb["height"])))
        import math
        edge = math.hypot(max(0, ex), max(0, ey))
        out.append(RankedAssociation(
            textId=text["id"], symbolId=sym["id"], distance=dist,
            normalizedDistance=norm, edgeDistance=edge, overlap=ov,
            direction=_direction(sb, tb, ov), features=feats,
            score=round(score, 4), reasons=reasons,
        ))
    out.sort(key=lambda a: a.score, reverse=True)
    return out
