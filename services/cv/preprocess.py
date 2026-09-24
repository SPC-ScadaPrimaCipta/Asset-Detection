"""
Detection V2 — image preprocessing (deterministic, debuggable).

Produces derived layers WITHOUT destroying the original:
  original -> grayscale -> contrast normalization -> adaptive threshold
         -> line-mask / text-mask / candidate-mask (candidate_detection fills masks)

Variant outputs (config-driven, see PreprocessConfig):
  original | grayscale | binary (global Otsu) | adaptive_binary

All coordinates in/out are natural page pixels (§8).
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


def to_grayscale(image: np.ndarray) -> np.ndarray:
    if len(image.shape) == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image


def normalize_contrast(gray: np.ndarray, clip_limit: float = 2.0) -> np.ndarray:
    return cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8)).apply(gray)


def adaptive_binarize(
    gray: np.ndarray, block_size: int = 51, c: int = 9
) -> np.ndarray:
    if block_size % 2 == 0:
        block_size += 1
    return cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        block_size, c,
    )


def global_binarize(gray: np.ndarray) -> np.ndarray:
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary


def denoise(binary: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)


def preprocess(image: np.ndarray) -> dict:
    """Full deterministic preprocess chain. Returns intermediate layers for debug."""
    gray = to_grayscale(image)
    norm = normalize_contrast(gray)
    binary = adaptive_binarize(norm)
    clean = denoise(binary)
    return {
        "grayscale": gray,
        "normalized": norm,
        "binary": binary,
        "denoised": clean,
    }


@dataclass
class PreprocessConfig:
    """Configuration-driven variant selection (Fase 3 §2).

    variant: which binarization the candidate detector should consume.
      - "adaptive_binary" (default): best for mixed thin-line + text drawings.
      - "binary": global Otsu — better for clean vector-rendered PDFs.
      - "grayscale": skip binarization (detector thresholds internally).
    denoise: apply morphological open to suppress scan/speckle noise.
    clahe_clip: contrast clip limit; 0 disables CLAHE.
    """

    variant: str = "adaptive_binary"
    denoise: bool = True
    clahe_clip: float = 2.0
    block_size: int = 51
    threshold_c: int = 9

    def __post_init__(self) -> None:
        allowed = {"adaptive_binary", "binary", "grayscale"}
        if self.variant not in allowed:
            raise ValueError(f"unknown variant {self.variant!r}, expected one of {sorted(allowed)}")


def preprocess_with_config(image: np.ndarray, cfg: PreprocessConfig) -> dict:
    """Run the configured chain; always returns all representations for comparison."""
    gray = to_grayscale(image)
    norm = normalize_contrast(gray, clip_limit=cfg.clahe_clip) if cfg.clahe_clip > 0 else gray
    binary = global_binarize(norm)
    adaptive = adaptive_binarize(norm, block_size=cfg.block_size, c=cfg.threshold_c)

    if cfg.variant == "binary":
        work = binary
    elif cfg.variant == "grayscale":
        work = norm
    else:
        work = adaptive
    if cfg.denoise and cfg.variant != "grayscale":
        work = denoise(work)

    return {
        "original": image,
        "grayscale": gray,
        "normalized": norm,
        "binary": binary,
        "adaptive_binary": adaptive,
        "work": work,  # the representation the detector consumes
        "variant": cfg.variant,
    }
