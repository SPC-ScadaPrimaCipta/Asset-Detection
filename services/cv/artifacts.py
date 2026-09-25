"""
Detection V2 — optional debug artifacts (gated by DEBUG_ARTIFACTS env).

Production pipeline NEVER requires these files. When disabled, every
function is a no-op returning None.
"""
from __future__ import annotations

import os

import cv2
import numpy as np


def enabled() -> bool:
    return os.environ.get("DEBUG_ARTIFACTS", "0") == "1"


def base_dir() -> str:
    return os.environ.get("DEBUG_ARTIFACT_DIR", "./storage/debug/cv")


def _path(kind: str, page: int, tile: int | None, ext: str = "png") -> str | None:
    if not enabled():
        return None
    d = os.path.join(base_dir(), f"p{page}")
    os.makedirs(d, exist_ok=True)
    suffix = f"_t{tile}" if tile is not None else ""
    return os.path.join(d, f"{kind}{suffix}.{ext}")


def save_image(kind: str, image: np.ndarray, page: int, tile: int | None = None) -> str | None:
    p = _path(kind, page, tile)
    if p is None:
        return None
    try:
        cv2.imwrite(p, image)
        return p
    except Exception:
        return None


def save_overlay(
    image: np.ndarray,
    boxes: list[dict],
    kind: str,
    page: int,
    tile: int | None = None,
    color: tuple = (0, 255, 0),
) -> str | None:
    if not enabled():
        return None
    overlay = image.copy()
    if len(overlay.shape) == 2:
        overlay = cv2.cvtColor(overlay, cv2.COLOR_GRAY2BGR)
    for b in boxes:
        cv2.rectangle(
            overlay,
            (int(b["x"]), int(b["y"])),
            (int(b["x"] + b["width"]), int(b["y"] + b["height"])),
            color, 2,
        )
    return save_image(kind, overlay, page, tile)
