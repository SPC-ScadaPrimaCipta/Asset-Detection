"""
Detection V2 — deterministic OCR text deduplication (page space).

Merge rule: same page + same NORMALIZED text + (high bbox IoU OR tiny
center distance relative to text size). Provenance from all tiles retained.

Critical: identical strings at DIFFERENT locations stay separate — only
spatially coincident repeats merge.
"""
from __future__ import annotations

from dedup import center_distance, iou
from schemas import Candidate


def dedup_texts(
    candidates: list[Candidate],
    iou_threshold: float = 0.5,
    max_center_factor: float = 0.5,
) -> list[Candidate]:
    """Dedup text-type page-space candidates. Visuals pass through untouched."""
    kept: list[Candidate] = []
    for cand in candidates:
        if cand.candidateType != "text":
            kept.append(cand)
            continue
        norm = (cand.tag.normalized if cand.tag else "") or ""
        merged = None
        for k in kept:
            if k.candidateType != "text" or k.pageNumber != cand.pageNumber:
                continue
            knorm = (k.tag.normalized if k.tag else "") or ""
            if not norm or norm != knorm:
                continue
            same_place = iou(k.bbox, cand.bbox) >= iou_threshold
            if not same_place:
                size = max(k.bbox["width"], k.bbox["height"], 1)
                same_place = center_distance(k.bbox, cand.bbox) <= size * max_center_factor
            if same_place:
                merged = k
                break
        if merged is None:
            kept.append(cand)
            continue
        # Merge: union bbox, keep higher-confidence OCR, retain provenance.
        x0 = min(merged.bbox["x"], cand.bbox["x"])
        y0 = min(merged.bbox["y"], cand.bbox["y"])
        x1 = max(merged.bbox["x"] + merged.bbox["width"], cand.bbox["x"] + cand.bbox["width"])
        y1 = max(merged.bbox["y"] + merged.bbox["height"], cand.bbox["y"] + cand.bbox["height"])
        merged.bbox = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
        if cand.ocr and merged.ocr and cand.ocr.confidence > merged.ocr.confidence:
            merged.ocr = cand.ocr
        merged.provenance = list(dict.fromkeys(
            merged.provenance + cand.provenance + [f"merged:{cand.candidateId}"]))
        merged.evidence.sourceTiles = list(dict.fromkeys(
            merged.evidence.sourceTiles + cand.evidence.sourceTiles))
        merged.evidence.notes = list(dict.fromkeys(
            merged.evidence.notes + [f"ocr-dedup-merged {cand.candidateId}"]))
    return kept
