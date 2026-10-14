"""
Bounding-box refinement via contour detection.

Given a coarse YOLO bounding box, this module:
  1. Expands the crop by ~10 % on each side (so edge-touching contours are captured).
  2. Converts the crop to a binary image.
  3. Finds contours and picks the one that best matches the expected aspect ratio /
     area of the original box.
  4. Returns the refined bbox in original image coordinates.

If no suitable contour is found the original bbox is returned with a lower
confidence penalty.
"""
from __future__ import annotations

import logging
from typing import Tuple

logger = logging.getLogger(__name__)

# Minimum ratio of bounding-contour area to crop area for a valid refinement
_MIN_AREA_RATIO: float = 0.02
# Maximum ratio (contours that fill almost the whole crop are probably noise)
_MAX_AREA_RATIO: float = 0.95
# Confidence returned when no contour is found
_FALLBACK_CONFIDENCE: float = 0.5


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _expand_bbox(
    bbox,
    *,
    page_w: int,
    page_h: int,
    expand_ratio: float = 0.10,
) -> Tuple[int, int, int, int]:
    """
    Expand *bbox* by *expand_ratio* on each side, clamped to image bounds.

    Returns
    -------
    (x1, y1, x2, y2) in integer pixels.
    """
    dx = bbox.width  * expand_ratio
    dy = bbox.height * expand_ratio

    x1 = max(0,      int(bbox.x - dx))
    y1 = max(0,      int(bbox.y - dy))
    x2 = min(page_w, int(bbox.x + bbox.width  + dx))
    y2 = min(page_h, int(bbox.y + bbox.height + dy))
    return x1, y1, x2, y2


def _best_contour(contours, crop_area: float):
    """
    Return the contour whose bounding rect area is closest to *crop_area* ×
    [_MIN_AREA_RATIO, _MAX_AREA_RATIO].  Returns ``None`` if none qualify.
    """
    import cv2

    best = None
    best_score = float("inf")

    for cnt in contours:
        area = cv2.contourArea(cnt)
        ratio = area / (crop_area + 1e-6)
        if not (_MIN_AREA_RATIO <= ratio <= _MAX_AREA_RATIO):
            continue
        # Prefer contours whose area is closest to 30% of the crop
        score = abs(ratio - 0.30)
        if score < best_score:
            best_score = score
            best = cnt

    return best


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def refine_bbox(
    page_img,
    bbox,
    *,
    page_width: int,
    page_height: int,
) -> Tuple[object, float, str]:
    """
    Refine *bbox* using contour detection on the expanded crop of *page_img*.

    Parameters
    ----------
    page_img :
        Full page BGR image (NumPy uint8 array).
    bbox :
        Initial coarse bounding box (``schemas.BBox``).
    page_width / page_height :
        Declared page dimensions (used for clamping).

    Returns
    -------
    (refined_bbox, confidence, method)
        *method* is ``'contour'`` if refinement succeeded, ``'original'`` if
        the original box is returned unchanged.
    """
    import cv2
    import numpy as np
    from .schemas import BBox

    h, w = page_img.shape[:2]
    pw = page_width  or w
    ph = page_height or h

    # --- expand crop ---
    x1, y1, x2, y2 = _expand_bbox(bbox, page_w=pw, page_h=ph, expand_ratio=0.10)
    crop = page_img[y1:y2, x1:x2]

    if crop.size == 0:
        logger.debug("Empty crop for bbox refinement — returning original")
        return bbox, _FALLBACK_CONFIDENCE, "original"

    crop_area = float((x2 - x1) * (y2 - y1))

    # --- binarise ---
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop.copy()
    # Adaptive threshold is better than Otsu for line-art
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,   # dark objects on white background
        blockSize=11,
        C=2,
    )

    # Small morphological close to connect near-adjacent pixels
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

    # --- find contours ---
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        logger.debug("No contours found — returning original bbox")
        return bbox, _FALLBACK_CONFIDENCE, "original"

    best = _best_contour(contours, crop_area)
    if best is None:
        logger.debug("No suitable contour — returning original bbox")
        return bbox, _FALLBACK_CONFIDENCE, "original"

    # --- convert contour rect back to page coordinates ---
    rx, ry, rw, rh = cv2.boundingRect(best)
    # rx/ry are relative to the *expanded* crop origin (x1, y1)
    abs_x = float(x1 + rx)
    abs_y = float(y1 + ry)
    abs_w = float(rw)
    abs_h = float(rh)

    # Sanity: refined box should not be massively different from original
    orig_area = max(bbox.width * bbox.height, 1.0)
    ref_area  = max(abs_w * abs_h, 1.0)
    area_change = max(orig_area, ref_area) / min(orig_area, ref_area)

    if area_change > 4.0:
        # Contour is implausibly different in size — keep original
        logger.debug(
            "Refined bbox area change %.1f× too large — returning original", area_change
        )
        return bbox, _FALLBACK_CONFIDENCE, "original"

    refined = BBox(x=abs_x, y=abs_y, width=abs_w, height=abs_h)
    # Confidence based on how tightly the contour filled the crop
    fill_ratio = min(ref_area / crop_area, 1.0)
    confidence = 0.7 + 0.3 * fill_ratio  # 0.70 – 1.00

    logger.debug(
        "Refined bbox (%.0f,%.0f,%.0f,%.0f) → (%.0f,%.0f,%.0f,%.0f) conf=%.2f",
        bbox.x, bbox.y, bbox.width, bbox.height,
        abs_x, abs_y, abs_w, abs_h,
        confidence,
    )
    return refined, confidence, "contour"
