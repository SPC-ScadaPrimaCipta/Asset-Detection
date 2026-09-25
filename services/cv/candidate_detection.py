"""
Detection V2 — deterministic visual candidate extraction (classical CV).

Output is a VISUAL CANDIDATE, never a confirmed asset. Every candidate
carries geometry + evidence metadata for later stages (spatial association,
legend matching, confidence engine, Gemini verification).

Primitives: contours, connected components, Hough line count, morphology.
Geometric filtering is recall-oriented: obvious noise is dropped, everything
else passes through with evidence attached.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from schemas import Candidate, CandidateEvidence, CandidateGeometry


@dataclass
class DetectorConfig:
    min_area: float = 64.0          # below this: speckle/noise
    max_area_ratio: float = 0.25    # above this fraction of tile: title block / border
    min_aspect: float = 0.05        # extremely thin slivers are dimension lines
    max_aspect: float = 20.0


def _geometry_from_contour(cnt: np.ndarray) -> tuple[dict, CandidateGeometry]:
    x, y, w, h = cv2.boundingRect(cnt)
    area = float(cv2.contourArea(cnt))
    perimeter = float(cv2.arcLength(cnt, True))
    circularity = (4 * np.pi * area / (perimeter * perimeter)) if perimeter > 0 else 0.0
    hull = cv2.convexHull(cnt)
    hull_area = float(cv2.contourArea(hull))
    convexity = (area / hull_area) if hull_area > 0 else 0.0
    geo = CandidateGeometry(
        area=area,
        aspectRatio=(w / h) if h > 0 else 0.0,
        centerX=float(x + w / 2),
        centerY=float(y + h / 2),
        perimeter=perimeter,
        circularity=float(min(1.0, max(0.0, circularity))),
        convexity=float(min(1.0, max(0.0, convexity))),
    )
    return {"x": int(x), "y": int(y), "width": int(w), "height": int(h)}, geo


def count_lines(binary: np.ndarray) -> int:
    """Hough line count — distinguishes line-heavy regions from symbols."""
    edges = cv2.Canny(binary, 50, 150)
    lines = cv2.HoughLinesP(
        edges, rho=1, theta=np.pi / 180, threshold=80,
        minLineLength=60, maxLineGap=10,
    )
    return 0 if lines is None else int(len(lines))


def detect_candidates(
    work: np.ndarray,
    page_number: int = 1,
    tile_id: int | None = None,
    cfg: DetectorConfig | None = None,
) -> list[Candidate]:
    """Extract visual candidates from a binarized work image (tile-LOCAL coords)."""
    cfg = cfg or DetectorConfig()
    h, w = work.shape[:2]
    tile_area = float(w * h)
    max_area = tile_area * cfg.max_area_ratio

    # Connected components give a stable region id + area per blob.
    num, labels, stats, _ = cv2.connectedComponentsWithStats(work, connectivity=8)
    cc_area: dict[int, float] = {
        i: float(stats[i, cv2.CC_STAT_AREA]) for i in range(1, num)
    }

    contours, _ = cv2.findContours(work, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    lines = count_lines(work)

    out: list[Candidate] = []
    for idx, cnt in enumerate(contours):
        bbox, geo = _geometry_from_contour(cnt)
        notes: list[str] = []
        if geo.area < cfg.min_area:
            continue  # speckle / raster noise — drop silently (recall-safe floor)
        if geo.area > max_area:
            notes.append("large-region: possible border/title-block")
        if not (cfg.min_aspect <= geo.aspectRatio <= cfg.max_aspect):
            notes.append("extreme-aspect: possible dimension/process line")
        # Nearest CC area as corroborating evidence (sample at bbox center).
        cx = int(min(w - 1, max(0, geo.centerX)))
        cy = int(min(h - 1, max(0, geo.centerY)))
        label = int(labels[cy, cx])
        cc = cc_area.get(label, 0.0)
        out.append(
            Candidate(
                candidateId=f"p{page_number}t{tile_id if tile_id is not None else 0}c{idx}",
                pageNumber=page_number,
                tileId=tile_id,
                bbox=bbox,
                candidateType="visual",
                geometry=geo,
                evidence=CandidateEvidence(
                    contourArea=geo.area,
                    connectedComponentArea=cc,
                    lineCount=lines,
                    notes=notes,
                ),
                source="cv",
            )
        )
    return out
