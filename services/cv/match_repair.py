"""
Phase 10 — matcher-aware local reconstruction (NOT global linesplit).

When a direct legend match is weak, the matcher may try ONE local repair:
gather nearby fragment boxes (within an expansion window of the candidate),
reunite them, re-extract features, and re-match. Both evidences are kept:

  {directMatch, reconstructedMatch|None, reconstruction{used, reason}}

Selection is deterministic and auditable: the reconstructed ranking wins
only when its top score exceeds the direct top by >= win_margin. Thresholds
are config, not tuned here (defaults = engineering starting points).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from legend_match import MatchConfig, match_candidate
from line_layer import reunite_split
from template_extract import TEMPLATE_SIZE, extract_variant, normalize_crop


@dataclass
class RepairConfig:
    enabled: bool = True
    direct_thr: float = 0.55     # attempt repair only below this direct top
    win_margin: float = 0.10     # reconstructed must beat direct by this
    expand_ratio: float = 0.5    # neighbor search window per side
    max_gap_px: int = 24
    min_x_overlap: float = 0.6

    @staticmethod
    def from_dict(raw: dict | None) -> "RepairConfig":
        base = RepairConfig()
        if not raw:
            return base
        allowed = set(RepairConfig.__dataclass_fields__)
        for k, v in raw.items():
            if k in allowed:
                try:
                    setattr(base, k, type(getattr(base, k))(v))
                except (TypeError, ValueError):
                    pass
        return base


def _expanded(bbox: dict, ratio: float, gap_margin: int = 0) -> dict:
    dx, dy = bbox["width"] * ratio, bbox["height"] * ratio
    return {"x": bbox["x"] - dx, "y": bbox["y"] - dy - gap_margin,
            "width": bbox["width"] + 2 * dx,
            "height": bbox["height"] + 2 * dy + 2 * gap_margin}


def _overlaps(a: dict, b: dict) -> bool:
    return (a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]
            and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"])


def candidate_query(gray, bbox: dict, cid: str) -> dict:
    v = extract_variant(gray, gray, bbox, cid)
    return {"id": cid, "aspectRatio": v["aspectRatio"],
            "huMoments": v["huMoments"], "edgeDensity": v["edgeDensity"],
            "lineCount": v["lineCount"],
            "normCrop": normalize_crop(gray, bbox, TEMPLATE_SIZE),
            "variant": v}


def rematch_with_reconstruction(gray, candidate_bbox: dict, candidate_id: str,
                                neighbor_boxes: list, definitions: list,
                                match_cfg=None,
                                repair_cfg: RepairConfig | None = None,
                                instr=None) -> dict:
    """Returns {direct, reconstructed, reconstruction, selected, selectedFrom}."""
    repair_cfg = repair_cfg or RepairConfig()
    match_cfg = match_cfg or MatchConfig()
    q = candidate_query(gray, candidate_bbox, candidate_id)
    direct = match_candidate(q, definitions, match_cfg, instr)
    out = {"direct": direct, "reconstructed": None,
           "reconstruction": {"used": False, "reason": "direct sufficient"},
           "selected": direct, "selectedFrom": "direct",
           "queryBox": dict(candidate_bbox)}
    top = direct[0]["score"] if direct else 0.0
    if not repair_cfg.enabled or top >= repair_cfg.direct_thr:
        return out
    window = _expanded(candidate_bbox, repair_cfg.expand_ratio,
                       repair_cfg.max_gap_px)
    frags = [dict(candidate_bbox)] + [b for b in neighbor_boxes
                                      if _overlaps(b, window)]
    if len(frags) < 2:
        out["reconstruction"] = {"used": False, "reason": "no neighbor fragments"}
        return out
    reunited = reunite_split(frags, max_gap_px=repair_cfg.max_gap_px,
                             min_x_overlap=repair_cfg.min_x_overlap)
    # Pick the reunited box containing the candidate center.
    cx, cy = (candidate_bbox["x"] + candidate_bbox["width"] / 2,
              candidate_bbox["y"] + candidate_bbox["height"] / 2)
    hosts = [b for b in reunited
             if b["x"] <= cx <= b["x"] + b["width"] and b["y"] <= cy <= b["y"] + b["height"]]
    if not hosts:
        out["reconstruction"] = {"used": False, "reason": "reunion found no container"}
        return out
    merged = max(hosts, key=lambda b: b["width"] * b["height"])
    if (merged["width"] * merged["height"]
            <= candidate_bbox["width"] * candidate_bbox["height"]):
        out["reconstruction"] = {"used": False, "reason": "reunion added no area"}
        return out
    q2 = candidate_query(gray, merged, candidate_id + "+R")
    rec_matches = match_candidate(q2, definitions, match_cfg, instr)
    rtop = rec_matches[0]["score"] if rec_matches else 0.0
    if rtop >= top + repair_cfg.win_margin:
        out.update({"reconstructed": rec_matches,
                    "reconstruction": {"used": True, "reason": "fragmented_geometry",
                                       "mergedBox": {k: int(merged[k]) for k in
                                                     ("x", "y", "width", "height")}},
                    "selected": rec_matches, "selectedFrom": "reconstructed",
                    "queryBox": {k: int(merged[k]) for k in ("x", "y", "width", "height")}})
    else:
        out.update({"reconstructed": rec_matches,
                    "reconstruction": {"used": False,
                                       "reason": f"reconstructed {rtop:.3f} did not beat "
                                                 f"direct {top:.3f} + margin"}})
    return out
