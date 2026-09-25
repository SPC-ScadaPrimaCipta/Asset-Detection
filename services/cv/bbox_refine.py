"""
Phase 10 — tight bbox refinement (generic, matcher-stage).

A candidate bbox often carries pipe stubs / padding that depress IoU and
pollute match features (diamond 0.496 vs 0.50 gate). Refine: expand slightly,
re-threshold locally, take the largest external contour's bbox, clip to the
expanded window. Never expands beyond pad px per side — no geometry invention.
Returns None when degenerate (caller keeps the original box).
"""
from __future__ import annotations

import cv2
import numpy as np


def refine_tight(gray: np.ndarray, bbox: dict, pad: int = 6,
                 min_side: int = 6, close_px: int = 9,
                 max_area_ratio: float = 1.0) -> dict | None:
    H, W = gray.shape[:2]
    x0 = max(0, int(bbox["x"]) - pad)
    y0 = max(0, int(bbox["y"]) - pad)
    x1 = min(W, int(bbox["x"] + bbox["width"]) + pad)
    y1 = min(H, int(bbox["y"] + bbox["height"]) + pad)
    if x1 - x0 < min_side or y1 - y0 < min_side:
        return None
    crop = gray[y0:y1, x0:x1]
    _, bw = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    if close_px > 0:
        # Bridge internal gaps (e.g. line-removal bands) so a split symbol
        # still yields ONE largest contour instead of its halves.
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (close_px, close_px))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    if cv2.contourArea(cnt) < 9:
        return None
    rx, ry, rw, rh = cv2.boundingRect(cnt)
    if rw < min_side or rh < min_side:
        return None
    # Guard: tightening must shrink, never capture neighbors. If the
    # largest contour exceeds the input area, keep the original (None).
    orig_area = max(1, int(bbox["width"]) * int(bbox["height"]))
    if (rw * rh) > orig_area * max_area_ratio:
        return None
    return {"x": x0 + rx, "y": y0 + ry, "width": rw, "height": rh,
            "refined": True}
