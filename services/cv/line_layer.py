"""
Phase 9.3 — line-aware candidate splitting (recall for symbols ON process lines).

A valve/pump sitting on a header line merges into one giant connected
component, so contour detection sees the whole pipe instead of the symbol.
Fix (classical, deterministic): detect long straight lines (Hough), remove a
narrow dilated band of them, and detect again on the line-removed layer.
Both layers' candidates are returned with provenance; the caller dedups.

The line mask itself is evidence (which lines were removed, how many).
Nothing is classified here — this only restores symbol geometry.
"""
from __future__ import annotations

import cv2
import numpy as np


def long_line_mask(work: np.ndarray, min_len_ratio: float = 0.12,
                   dilate_px: int = 3) -> tuple[np.ndarray, list]:
    """Returns (mask, lines). Mask is white where long lines were found."""
    H, W = work.shape[:2]
    edges = cv2.Canny(work, 50, 150)
    min_len = max(80, int(max(W, H) * min_len_ratio))
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100,
                            minLineLength=min_len, maxLineGap=12)
    mask = np.zeros_like(work)
    found = []
    if lines is not None:
        for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
            length = float(np.hypot(x2 - x1, y2 - y1))
            if length >= min_len:
                cv2.line(mask, (x1, y1), (x2, y2), 255, 5)
                found.append({"x1": int(x1), "y1": int(y1),
                              "x2": int(x2), "y2": int(y2),
                              "length": round(length, 1)})
    if dilate_px > 0:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (dilate_px, dilate_px))
        mask = cv2.dilate(mask, k)
    return mask, found


def remove_lines(work: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = work.copy()
    out[mask > 0] = 0
    return out


def reunite_split(boxes: list, max_gap_px: int = 24,
                  min_x_overlap: float = 0.8,
                  min_width_ratio: float = 0.5) -> list:
    """Re-merge halves split by line removal (generic proximity reunion).

    Partners must have comparable spans (width ratio >= min_width_ratio) so a
    20px glyph never chains onto a 200px symbol half. Among eligible partners
    the smallest gap merges first (order-independent greedy). No symbol
    assumptions.
    """
    boxes = [dict(b) for b in boxes]
    merged: list[dict] = []
    used = [False] * len(boxes)
    for i, a in enumerate(boxes):
        if used[i]:
            continue
        cur = dict(a)
        did_merge = False
        while True:
            best_j, best_gap = -1, None
            for j, b in enumerate(boxes):
                if used[j] or j == i:
                    continue
                ox0, ox1 = max(cur["x"], b["x"]), min(cur["x"] + cur["width"],
                                                     b["x"] + b["width"])
                overlap = max(0, ox1 - ox0)
                smaller_w = min(cur["width"], b["width"])
                larger_w = max(cur["width"], b["width"])
                gap = (max(cur["y"], b["y"])
                       - min(cur["y"] + cur["height"], b["y"] + b["height"]))
                if smaller_w <= 0:
                    continue
                if overlap / smaller_w < min_x_overlap:
                    continue
                if not (0 < gap <= max_gap_px):
                    continue
                if larger_w > 0 and smaller_w / larger_w < min_width_ratio:
                    continue
                if best_gap is None or gap < best_gap:
                    best_j, best_gap = j, gap
            if best_j < 0:
                break
            b = boxes[best_j]
            cur = {"x": min(cur["x"], b["x"]), "y": min(cur["y"], b["y"]),
                   "width": max(cur["x"] + cur["width"], b["x"] + b["width"])
                   - min(cur["x"], b["x"]),
                   "height": max(cur["y"] + cur["height"], b["y"] + b["height"])
                   - min(cur["y"], b["y"])}
            used[best_j] = True
            did_merge = True
        used[i] = True
        if did_merge:
            cur["reunited"] = True
        merged.append(cur)
    return merged
