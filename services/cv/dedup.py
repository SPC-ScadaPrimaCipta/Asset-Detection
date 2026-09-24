"""
Detection V2 — deterministic tile-boundary deduplication.

Same visual candidate can appear in overlapping tiles. Merge rule (NOT naive
x/y equality): IoU above threshold (default 0.5) → same candidate.
Provenance is retained: canonical candidate lists every source tile and the
merged bbox (union) so debugging/evaluation can trace it back.
"""
from __future__ import annotations

from schemas import Candidate, CandidateEvidence


def iou(a: dict, b: dict) -> float:
    ix0 = max(a["x"], b["x"])
    iy0 = max(a["y"], b["y"])
    ix1 = min(a["x"] + a["width"], b["x"] + b["width"])
    iy1 = min(a["y"] + a["height"], b["y"] + b["height"])
    iw = max(0, ix1 - ix0)
    ih = max(0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / union if union > 0 else 0.0


def center_distance(a: dict, b: dict) -> float:
    ax, ay = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    bx, by = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


def _union(a: dict, b: dict) -> dict:
    x0 = min(a["x"], b["x"])
    y0 = min(a["y"], b["y"])
    x1 = max(a["x"] + a["width"], b["x"] + b["width"])
    y1 = max(a["y"] + a["height"], b["y"] + b["height"])
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def deduplicate(
    candidates: list[Candidate],
    iou_threshold: float = 0.5,
    page_number: int = 1,
) -> list[Candidate]:
    """Merge page-space candidates. Only same-page items merge."""
    kept: list[Candidate] = []
    for cand in candidates:
        merged_into = None
        for k in kept:
            if k.pageNumber != cand.pageNumber:
                continue
            if k.candidateType != cand.candidateType:
                continue
            if iou(k.bbox, cand.bbox) < iou_threshold:
                continue
            merged_into = k
            break
        if merged_into is None:
            cand.evidence.sourceTiles = list(
                dict.fromkeys(cand.evidence.sourceTiles + [cand.tileId])
            )
            cand.provenance = list(
                dict.fromkeys(cand.provenance + [f"tile:{cand.tileId}"])
            )
            kept.append(cand)
        else:
            merged_into.bbox = _union(merged_into.bbox, cand.bbox)
            merged_into.evidence.sourceTiles = list(
                dict.fromkeys(merged_into.evidence.sourceTiles + [cand.tileId])
            )
            merged_into.provenance = list(
                dict.fromkeys(
                    merged_into.provenance
                    + [f"tile:{cand.tileId}"]
                    + [f"merged:{cand.candidateId}"]
                )
            )
            merged_into.evidence.notes = list(
                dict.fromkeys(
                    merged_into.evidence.notes
                    + [f"dedup-merged {cand.candidateId} (IoU>={iou_threshold})"]
                )
            )
            # Keep the richer OCR/tag payload when the duplicate has one.
            if cand.ocr is not None and merged_into.ocr is None:
                merged_into.ocr = cand.ocr
            if cand.tag is not None and merged_into.tag is None:
                merged_into.tag = cand.tag
    # Refresh geometry centers after union merges.
    for k in kept:
        k.geometry.centerX = k.bbox["x"] + k.bbox["width"] / 2
        k.geometry.centerY = k.bbox["y"] + k.bbox["height"] / 2
    return kept
