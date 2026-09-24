"""Shared synthetic drawing builders (no external assets)."""
import cv2
import numpy as np


def blank(w: int = 640, h: int = 480) -> np.ndarray:
    return np.full((h, w, 3), 255, dtype=np.uint8)


def symbol_drawing() -> np.ndarray:
    """Simple symbol (rect + circle) + process line + speckle noise."""
    img = blank()
    cv2.rectangle(img, (100, 100), (180, 180), (0, 0, 0), 2)   # vessel-like
    cv2.circle(img, (400, 300), 40, (0, 0, 0), 2)               # pump-like
    cv2.line(img, (0, 300), (640, 300), (0, 0, 0), 2)           # process line
    rng = np.random.default_rng(42)
    pts = rng.integers(0, 640, size=(60, 2))
    for x, y in pts:
        if 0 <= y < 480:
            img[int(y), int(x)] = (0, 0, 0)                     # speckle
    return img


def line_heavy() -> np.ndarray:
    # 2px lines = realistic for 360 DPI renders (1px lines are legitimately
    # removed by morphological denoise as scan speckle).
    img = blank()
    for y in range(20, 480, 20):
        cv2.line(img, (0, y), (640, y), (0, 0, 0), 2)
    for x in range(20, 640, 40):
        cv2.line(img, (x, 0), (x, 480), (0, 0, 0), 2)
    return img


def noisy_scan() -> np.ndarray:
    rng = np.random.default_rng(7)
    noise = rng.integers(200, 255, size=(480, 640), dtype=np.uint8)
    gray = cv2.cvtColor(blank(), cv2.COLOR_BGR2GRAY)
    mixed = np.minimum(gray, noise)
    return cv2.cvtColor(mixed, cv2.COLOR_GRAY2BGR)
