"""
Image preprocessing utilities for the CV service.

All heavy imports are deferred to the first call so that importing this module
at startup does not block the FastAPI worker.
"""
from __future__ import annotations

import base64
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np
    from .schemas import BBox


# ---------------------------------------------------------------------------
# Codec helpers
# ---------------------------------------------------------------------------

def decode_b64_image(b64: str) -> "np.ndarray":
    """
    Decode a base64-encoded PNG/JPEG string to a BGR NumPy array.

    Raises
    ------
    ValueError
        If the bytes cannot be decoded as an image.
    """
    import cv2
    import numpy as np

    # Accept both plain base64 and data-URI strings
    if "," in b64:
        b64 = b64.split(",", 1)[1]

    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image from base64 payload")
    return img


def encode_image_b64(img: "np.ndarray") -> str:
    """
    Encode a BGR NumPy array to a base64 PNG string (no data-URI prefix).
    """
    import cv2

    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("Failed to encode image to PNG")
    return base64.b64encode(buf.tobytes()).decode("utf-8")


# ---------------------------------------------------------------------------
# Preprocessing transforms
# ---------------------------------------------------------------------------

def to_grayscale(img: "np.ndarray") -> "np.ndarray":
    """Convert BGR to grayscale.  Returns the input unchanged if already 2-D."""
    import cv2

    if img.ndim == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def denoise(img: "np.ndarray", *, h: int = 10) -> "np.ndarray":
    """
    Apply Non-Local Means denoising.  Works on both grayscale and BGR.

    Parameters
    ----------
    img :
        Input image (grayscale or BGR).
    h :
        Filter strength — higher removes more noise but blurs detail.
    """
    import cv2

    if img.ndim == 2:
        return cv2.fastNlMeansDenoising(img, h=h)
    return cv2.fastNlMeansDenoisingColored(img, h=h, hColor=h)


def sharpen(img: "np.ndarray") -> "np.ndarray":
    """Apply an unsharp-mask sharpening kernel."""
    import cv2
    import numpy as np

    kernel = np.array(
        [[-1, -1, -1],
         [-1,  9, -1],
         [-1, -1, -1]],
        dtype=np.float32,
    )
    return cv2.filter2D(img, -1, kernel)


def binarize(
    img: "np.ndarray",
    *,
    method: str = "adaptive",
    threshold: int = 127,
) -> "np.ndarray":
    """
    Convert to binary (black/white) image.

    Parameters
    ----------
    img :
        Input image.  Converted to grayscale internally if needed.
    method :
        ``'otsu'`` for Otsu's method, ``'adaptive'`` for adaptive Gaussian
        thresholding, or ``'fixed'`` for a fixed threshold.
    threshold :
        Threshold value used only when *method* is ``'fixed'``.
    """
    import cv2

    gray = to_grayscale(img)
    if method == "otsu":
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    elif method == "adaptive":
        binary = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            blockSize=11,
            C=2,
        )
    else:  # fixed
        _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
    return binary


# ---------------------------------------------------------------------------
# Region helpers
# ---------------------------------------------------------------------------

def crop_region(img: "np.ndarray", bbox: "BBox") -> "np.ndarray":
    """
    Crop *img* to the rectangle described by *bbox*.

    Coordinates are clamped to the image dimensions so out-of-bounds boxes
    never raise exceptions.

    Parameters
    ----------
    img :
        Source image (H×W or H×W×C).
    bbox :
        Bounding box with ``x, y, width, height`` in pixels.

    Returns
    -------
    np.ndarray
        Cropped sub-image.  May be empty (0×0) if *bbox* is degenerate.
    """
    h, w = img.shape[:2]
    x1 = max(0, int(bbox.x))
    y1 = max(0, int(bbox.y))
    x2 = min(w, int(bbox.x + bbox.width))
    y2 = min(h, int(bbox.y + bbox.height))
    return img[y1:y2, x1:x2]


def pad_crop(img: "np.ndarray", padding: int = 10) -> "np.ndarray":
    """
    Add a constant-color (white) border around *img*.

    Useful to give edge-touching symbols some breathing room before OCR or
    contour detection.
    """
    import cv2

    return cv2.copyMakeBorder(
        img,
        padding, padding, padding, padding,
        cv2.BORDER_CONSTANT,
        value=(255, 255, 255),
    )


# ---------------------------------------------------------------------------
# Convenience pipeline
# ---------------------------------------------------------------------------

def prepare_for_ocr(img: "np.ndarray") -> "np.ndarray":
    """
    Standard preprocessing pipeline optimised for OCR:
    denoise → grayscale → sharpen → adaptive binarize → pad.
    """
    img = denoise(img, h=7)
    img = to_grayscale(img)
    img = sharpen(img)
    img = binarize(img, method="adaptive")
    img = pad_crop(img, padding=4)
    return img


def prepare_for_detection(img: "np.ndarray") -> "np.ndarray":
    """
    Light preprocessing for YOLO: denoise only — YOLO works best on colour
    images and does its own normalisation.
    """
    return denoise(img, h=5)
