"""
Detection V2 — normalized template extraction.

Scale-independent representation per symbol crop:
  - normalized grayscale crop (longest side 128px, aspect preserved, padded)
  - log-scaled Hu moments (translation/scale/rotation invariants)
  - edge density, Hough line count, component/contour counts
Raw pixels are reference data, NOT the decision signal.
"""
from __future__ import annotations

import base64

import cv2
import numpy as np

TEMPLATE_SIZE = 128


def normalize_crop(gray: np.ndarray, bbox: dict, size: int = TEMPLATE_SIZE) -> np.ndarray:
    x, y = int(bbox["x"]), int(bbox["y"])
    w, h = int(bbox["width"]), int(bbox["height"])
    H, W = gray.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return np.zeros((size, size), dtype=np.uint8)
    crop = gray[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    scale = size / max(ch, cw)
    resized = cv2.resize(crop, (max(1, int(cw * scale)), max(1, int(ch * scale))),
                         interpolation=cv2.INTER_AREA)
    canvas = np.zeros((size, size), dtype=np.uint8)
    rh, rw = resized.shape[:2]
    canvas[:rh, :rw] = resized
    return canvas


def hu_moments(binary: np.ndarray) -> list[float]:
    """RAW Hu moments (no log scaling here).

    Comparison happens in legend_match.contour_score with noise-floor
    gating: log-scaling turns sub-1e-9 raster noise into ±12 sign-flipping
    pseudo-signal. Raw values keep genuine asymmetric signal comparable.
    """
    moments = cv2.moments(binary)
    hu = cv2.HuMoments(moments).flatten()
    return [float(v) for v in hu]


def edge_density(gray_norm: np.ndarray) -> float:
    edges = cv2.Canny(gray_norm, 50, 150)
    return round(float((edges > 0).mean()), 4)


def line_count(gray_norm: np.ndarray) -> int:
    edges = cv2.Canny(gray_norm, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=30,
                            minLineLength=20, maxLineGap=5)
    return 0 if lines is None else int(len(lines))


def png_base64(gray: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", gray)
    return base64.b64encode(buf.tobytes()).decode() if ok else ""


def extract_variant(gray: np.ndarray, binary: np.ndarray, bbox: dict,
                    variant_id: str, source: str = "extract") -> dict:
    norm = normalize_crop(gray, bbox)
    _, norm_bin = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(norm_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    num, _, _, _ = cv2.connectedComponentsWithStats(norm_bin, connectivity=8)
    w, h = int(bbox["width"]), int(bbox["height"])
    return {
        "variantId": variant_id,
        "bbox": {k: int(bbox.get(k, 0)) for k in ("x", "y", "width", "height")},
        "aspectRatio": round(w / h, 4) if h > 0 else 0.0,
        "area": float(w * h),
        "normalizedPng": png_base64(norm),
        "huMoments": hu_moments(norm_bin),
        "edgeDensity": edge_density(norm),
        "lineCount": line_count(norm),
        "contourCount": len(contours),
        "componentCount": int(num) - 1,
        "source": source,
    }
