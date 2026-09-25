"""Synthetic Legend fixture: Pump / Valve / PSV / Instrument + labels.

Each symbol is structurally distinct; labels pair spatially (right side).
P&ID query canvases reuse the SAME drawing routines at other scales —
never pixel copies, so matches must be structural, not trivial.
"""
import cv2
import numpy as np


def draw_pump(img, x, y, s, thick=3):
    c = (x + s // 2, y + s // 2)
    cv2.circle(img, c, s // 2, (0, 0, 0), thick)
    cv2.circle(img, c, max(2, s // 10), (0, 0, 0), -1)


def draw_valve(img, x, y, s, thick=3):
    pts1 = np.array([[x, y], [x, y + s], [x + s, y + s // 2]], np.int32)
    pts2 = np.array([[x + s, y], [x + s, y + s], [x, y + s // 2]], np.int32)
    cv2.polylines(img, [pts1], True, (0, 0, 0), thick)
    cv2.polylines(img, [pts2], True, (0, 0, 0), thick)


def draw_psv(img, x, y, s, thick=3):
    cv2.rectangle(img, (x, y), (x + s, y + s), (0, 0, 0), thick)
    cv2.line(img, (x, y), (x + s, y + s), (0, 0, 0), thick)


def draw_instrument(img, x, y, s, thick=3):
    c = (x + s // 2, y + s // 2)
    cv2.circle(img, c, s // 2, (0, 0, 0), thick)
    cv2.line(img, (x + s // 2, y + 4), (x + s // 2, y + s - 4), (0, 0, 0), thick)
    cv2.line(img, (x + 4, y + s // 2), (x + s - 4, y + s // 2), (0, 0, 0), thick)


SYMBOLS = {"Pump": draw_pump, "Valve": draw_valve, "PSV": draw_psv,
           "Instrument": draw_instrument}


def legend_canvas(size: int = 120, gap: int = 60) -> tuple:
    """Legend page: 4 symbols in a row with labels. Returns (img, items)."""
    n = len(SYMBOLS)
    W = n * (size + 200) + gap
    H = size + 2 * gap
    img = np.full((H, W, 3), 255, dtype=np.uint8)
    items = []
    x = gap // 2
    for label, fn in SYMBOLS.items():
        fn(img, x, gap // 2, size)
        items.append({"label": label,
                      "bbox": {"x": x, "y": gap // 2, "width": size, "height": size},
                      "textBbox": {"x": x + size + 10, "y": gap // 2 + size // 3,
                                   "width": 150, "height": 40}})
        cv2.putText(img, label, (x + size + 10, gap // 2 + size // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2, cv2.LINE_AA)
        x += size + 200
    return img, items


def query_canvas(label: str, size: int = 120, angle: int = 0,
                 noise: int = 0, seed: int = 5) -> np.ndarray:
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    tmp = np.full((size, size, 3), 255, dtype=np.uint8)
    SYMBOLS[label](tmp, 0, 0, size)
    if angle:
        c = (size // 2, size // 2)
        m = cv2.getRotationMatrix2D(c, angle, 1.0)
        tmp = cv2.warpAffine(tmp, m, (size, size), borderValue=(255, 255, 255))
    if noise:
        rng = np.random.default_rng(seed)
        ys, xs = rng.integers(0, size, size=(2, noise))
        tmp[ys, xs] = (0, 0, 0)
    img[100:100 + size, 100:100 + size] = tmp
    return img


def unrelated_canvas(seed: int = 9) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    for _ in range(6):
        p1 = tuple(int(v) for v in rng.integers(50, 350, size=2))
        p2 = tuple(int(v) for v in rng.integers(50, 350, size=2))
        cv2.line(img, p1, p2, (0, 0, 0), 2)
    return img
