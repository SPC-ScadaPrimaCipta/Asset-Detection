"""
Multi-scale OpenCV template matching for legend-symbol detection.

Key design decisions
--------------------
* Multi-scale (0.5 × – 1.5 × in 0.1 steps) to handle slight size variation
  between legend crops and their occurrences on a P&ID page.
* NMS applied after collecting all scale candidates so that overlapping
  matches from different scales collapse to a single best hit.
* Works in grayscale; edge maps (Canny) improve robustness on engineering
  drawings compared to raw pixel matching.
"""
from __future__ import annotations

import logging
import time
from typing import List, Tuple

logger = logging.getLogger(__name__)

# Scales to try — 0.5 → 1.5 in steps of 0.1 (11 values)
_SCALES: List[float] = [round(s * 0.1, 1) for s in range(5, 16)]  # 0.5 … 1.5


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_gray_edge(img) -> "np.ndarray":  # noqa: F821
    """Convert BGR image to a Canny edge map for robust matching."""
    import cv2

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img.copy()
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, threshold1=50, threshold2=150)
    return edges


def _nms_matches(
    candidates: List[Tuple[float, float, float, float, float]],
    iou_threshold: float = 0.4,
) -> List[Tuple[float, float, float, float, float]]:
    """
    Greedy NMS on template-match candidates.

    Each candidate is (score, x, y, w, h).
    Returns the de-duplicated list sorted by score descending.
    """
    import numpy as np

    if not candidates:
        return []

    arr = np.array(candidates, dtype=np.float32)
    scores = arr[:, 0]
    x1 = arr[:, 1]
    y1 = arr[:, 2]
    x2 = x1 + arr[:, 3]
    y2 = y1 + arr[:, 4]
    areas = (x2 - x1) * (y2 - y1)

    order = scores.argsort()[::-1]
    keep: List[int] = []

    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        rest = order[1:]
        ix1 = np.maximum(x1[i], x1[rest])
        iy1 = np.maximum(y1[i], y1[rest])
        ix2 = np.minimum(x2[i], x2[rest])
        iy2 = np.minimum(y2[i], y2[rest])
        inter = np.maximum(0.0, ix2 - ix1) * np.maximum(0.0, iy2 - iy1)
        iou = inter / (areas[i] + areas[rest] - inter + 1e-6)
        order = rest[iou <= iou_threshold]

    return [
        (float(arr[k, 0]), float(arr[k, 1]), float(arr[k, 2]), float(arr[k, 3]), float(arr[k, 4]))
        for k in keep
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def match_template(
    page_img,
    template_img,
    *,
    threshold: float = 0.7,
    max_matches: int = 20,
    use_edges: bool = True,
) -> List:
    """
    Find all occurrences of *template_img* in *page_img* above *threshold*.

    Parameters
    ----------
    page_img :
        Full-page BGR image (NumPy uint8 array).
    template_img :
        Small legend-symbol crop (NumPy uint8 array).
    threshold :
        Minimum normalised cross-correlation score to keep.
    max_matches :
        Maximum number of matches returned (after NMS, sorted by score desc).
    use_edges :
        If ``True`` (default), match on Canny edge maps which is more robust
        on line-art / engineering drawings.

    Returns
    -------
    List[TemplateMatch]
    """
    import cv2
    import numpy as np
    from .schemas import BBox, TemplateMatch

    page_h, page_w = page_img.shape[:2]
    tmpl_h, tmpl_w = template_img.shape[:2]

    if tmpl_h == 0 or tmpl_w == 0:
        logger.warning("Empty template image — skipping template match")
        return []

    page_proc = _to_gray_edge(page_img) if use_edges else (
        cv2.cvtColor(page_img, cv2.COLOR_BGR2GRAY) if page_img.ndim == 3 else page_img
    )

    tmpl_proc = _to_gray_edge(template_img) if use_edges else (
        cv2.cvtColor(template_img, cv2.COLOR_BGR2GRAY) if template_img.ndim == 3 else template_img
    )

    candidates: List[Tuple[float, float, float, float, float]] = []  # (score, x, y, w, h)

    for scale in _SCALES:
        new_w = max(1, int(tmpl_w * scale))
        new_h = max(1, int(tmpl_h * scale))

        # Skip if template would be larger than the page
        if new_w >= page_w or new_h >= page_h:
            continue
        # Skip degenerate sizes
        if new_w < 4 or new_h < 4:
            continue

        scaled_tmpl = cv2.resize(tmpl_proc, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        try:
            result = cv2.matchTemplate(page_proc, scaled_tmpl, cv2.TM_CCOEFF_NORMED)
        except cv2.error as exc:
            logger.debug("matchTemplate failed at scale=%.1f: %s", scale, exc)
            continue

        # Collect all locations above threshold at this scale
        loc_y, loc_x = np.where(result >= threshold)
        for x, y in zip(loc_x.tolist(), loc_y.tolist()):
            score = float(result[y, x])
            candidates.append((score, float(x), float(y), float(new_w), float(new_h)))

    # NMS across all scales
    kept = _nms_matches(candidates, iou_threshold=0.4)
    # Sort descending by score, take top-N
    kept = sorted(kept, key=lambda c: c[0], reverse=True)[:max_matches]

    return [
        TemplateMatch(
            score=s,
            bbox=BBox(x=x, y=y, width=w, height=h),
        )
        for s, x, y, w, h in kept
    ]


def run_template_match(
    page_img,
    template_img,
    *,
    threshold: float = 0.7,
    max_matches: int = 20,
) -> Tuple[List, float]:
    """
    Convenience wrapper that also returns elapsed milliseconds.

    Returns
    -------
    (matches, duration_ms)
    """
    t0 = time.perf_counter()
    matches = match_template(
        page_img,
        template_img,
        threshold=threshold,
        max_matches=max_matches,
    )
    duration_ms = (time.perf_counter() - t0) * 1000.0
    return matches, duration_ms
