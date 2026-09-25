"""
Detection V2 — OCR execution with controlled variant strategy.

Runs the PRIMARY variant first; retries the next variant ONLY when the
previous one yields no usable text. Never blindly runs every variant.
Each variant attempt is timed separately (cost measurement for §3).
"""
from __future__ import annotations

import numpy as np

from ocr_config import OcrConfig
from ocr_providers import OcrBox, OCRProvider
from preprocess import PreprocessConfig, preprocess_with_config
from schemas import StageTiming
from timing import Timer


def _render_variant(image: np.ndarray, variant: str) -> np.ndarray:
    layers = preprocess_with_config(image, PreprocessConfig(variant=variant))
    work = layers["work"]
    if len(work.shape) == 2:
        import cv2
        return cv2.cvtColor(work, cv2.COLOR_GRAY2BGR)
    return work


def run_ocr(
    image: np.ndarray,
    provider: OCRProvider,
    config: OcrConfig,
    timer: Timer | None = None,
) -> tuple[list[OcrBox], list[dict], list[str]]:
    """Returns (boxes, variant_attempts, warnings). Never raises."""
    attempts: list[dict] = []
    warnings: list[str] = []
    boxes: list[OcrBox] = []
    try:
        for variant in config.variants:
            try:
                rendered = _render_variant(image, variant)
            except Exception as exc:
                attempts.append({"variant": variant, "boxes": 0, "error": str(exc)[:120]})
                continue
            import time
            start = time.perf_counter()
            try:
                got = provider.recognize(rendered)
            except Exception as exc:  # noqa: BLE001 — provider must never break pipeline
                warnings.append(f"OCR variant {variant} failed ({exc})")
                attempts.append({"variant": variant, "boxes": 0, "error": "provider-error"})
                continue
            ms = round((time.perf_counter() - start) * 1000.0, 2)
            attempts.append({"variant": variant, "boxes": len(got), "ms": ms})
            if timer is not None:
                timer.stages.append(
                    StageTiming(name="ocr-variant", ms=ms,
                                detail={"variant": variant, "boxes": len(got)})
                )
            if got:
                boxes = got
                break  # primary succeeded — stop, don't burn more variants
        if not boxes and attempts:
            warnings.append(
                f"OCR found no text on {len(attempts)} variant(s) "
                f"({'+'.join(a['variant'] for a in attempts)})"
            )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"OCR runner failed ({exc})")
    return boxes, attempts, warnings
