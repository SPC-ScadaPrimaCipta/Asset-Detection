import cv2
import numpy as np

from legend_fixtures import query_canvas, unrelated_canvas
from template_extract import TEMPLATE_SIZE, extract_variant, hu_moments, normalize_crop
from preprocess import to_grayscale


def crop_of(img, size=120):
    gray = to_grayscale(img)
    return gray, {"x": 100, "y": 100, "width": size, "height": size}


def test_normalization_fixed_size_aspect():
    gray, _ = crop_of(query_canvas("Pump"))
    norm = normalize_crop(gray, {"x": 100, "y": 100, "width": 120, "height": 60})
    assert norm.shape == (TEMPLATE_SIZE, TEMPLATE_SIZE)


def test_crop_outside_image_safe():
    gray, _ = crop_of(query_canvas("Pump"))
    norm = normalize_crop(gray, {"x": 5000, "y": 5000, "width": 50, "height": 50})
    assert norm.shape == (TEMPLATE_SIZE, TEMPLATE_SIZE)
    assert norm.sum() == 0


def test_scale_invariance_of_hu():
    g1, b = crop_of(query_canvas("Pump", size=120))
    g2, _ = crop_of(query_canvas("Pump", size=120), 120)
    _, bin1 = cv2.threshold(g1[100:220, 100:220], 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    big = query_canvas("Pump", size=180)
    gb = to_grayscale(big)
    _, bin2 = cv2.threshold(gb[100:280, 100:280], 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    import numpy as _np
    d = _np.linalg.norm(_np.asarray(hu_moments(bin1)) - _np.asarray(hu_moments(bin2)))
    assert d < 1.5  # same shape, different scale → close in Hu space


def test_noise_robustness():
    g1, _ = crop_of(query_canvas("Valve"))
    g2, _ = crop_of(query_canvas("Valve", noise=40))
    n1 = normalize_crop(g1, {"x": 100, "y": 100, "width": 120, "height": 120})
    n2 = normalize_crop(g2, {"x": 100, "y": 100, "width": 120, "height": 120})
    diff = float(np.abs(n1.astype(int) - n2.astype(int)).mean())
    assert diff < 12.0  # 40 speckle px on 14k template → small mean shift


def test_variant_carries_all_fields():
    gray, bbox = crop_of(query_canvas("PSV"))
    v = extract_variant(gray, gray, bbox, "v1")
    for k in ("variantId", "bbox", "aspectRatio", "area", "normalizedPng",
              "huMoments", "edgeDensity", "lineCount", "contourCount",
              "componentCount", "source"):
        assert k in v, k
    assert v["aspectRatio"] == 1.0
