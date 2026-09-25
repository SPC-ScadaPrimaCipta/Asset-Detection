"""
Detection V2 — OCR abstraction layer.

Pipeline code depends ONLY on OCRProvider. Concrete engines plug in behind
it; unit tests use MockOCRProvider (no external binaries required).

Each result bbox is in the SAME coordinate space as the input image
(tile-local when the input is a tile) — conversion to page space happens
in TypeScript via tileToPage.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np


@dataclass
class OcrBox:
    text: str
    bbox: dict  # {x,y,width,height} in input-image pixels
    confidence: float = 0.0
    rotation: int = 0


class OCRProvider(ABC):
    name: str = "base"

    @abstractmethod
    def recognize(self, image: np.ndarray) -> list[OcrBox]:
        """Return text boxes found in image. Must never raise on bad input."""
        raise NotImplementedError

    @property
    def available(self) -> bool:
        return True


class MockOCRProvider(OCRProvider):
    """Deterministic fixture provider for tests and offline dev."""

    name = "mock"

    def __init__(self, fixtures: list[OcrBox] | None = None) -> None:
        self.fixtures: list[OcrBox] = fixtures or []

    def recognize(self, image: np.ndarray) -> list[OcrBox]:
        if image is None or not hasattr(image, "shape"):
            return []
        return list(self.fixtures)


class TesseractProvider(OCRProvider):
    """pytesseract-backed provider driven by OcrConfig. Never raises."""

    name = "tesseract"

    def __init__(self, config=None) -> None:
        from ocr_config import OcrConfig, tesseract_cmd

        self.config: OcrConfig = config or OcrConfig()
        self._cmd = tesseract_cmd()
        self._ok = self._cmd is not None
        self._tess = None
        self._pil = None
        if self._ok:
            try:
                import pytesseract  # type: ignore
                from PIL import Image as PILImage

                pytesseract.pytesseract.tesseract_cmd = self._cmd
                self._tess = pytesseract
                self._pil = PILImage
            except Exception:
                self._ok = False

    @property
    def available(self) -> bool:
        return self._ok and self._tess is not None

    def _run_psm(self, gray, psm: int) -> list[OcrBox]:
        cfg = (
            f"--oem {self.config.oem} --psm {psm} "
            f"-l {self.config.language} -c tessedit_char_whitelist={self.config.whitelist}"
        )
        data = self._tess.image_to_data(
            self._pil.fromarray(gray),
            config=cfg,
            output_type=self._tess.Output.DICT,
            timeout=self.config.timeout_sec,
        )
        out: list[OcrBox] = []
        n = len(data.get("text", []))
        for i in range(n):
            text = (data["text"][i] or "").strip()
            if not text:
                continue
            try:
                conf = float(data["conf"][i])
            except (ValueError, TypeError):
                conf = -1.0
            if conf < 0:
                continue
            if conf / 100.0 < self.config.min_confidence:
                continue
            out.append(
                OcrBox(
                    text=text,
                    bbox={
                        "x": int(data["left"][i]),
                        "y": int(data["top"][i]),
                        "width": int(data["width"][i]),
                        "height": int(data["height"][i]),
                    },
                    confidence=round(conf / 100.0, 3),
                    rotation=0,
                )
            )
        return out

    def recognize(self, image: np.ndarray) -> list[OcrBox]:
        if not self.available or image is None:
            return []
        try:
            import cv2

            gray = image if len(image.shape) == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape[:2]
            if max(h, w) > self.config.max_image_dim:
                scale = self.config.max_image_dim / max(h, w)
                gray = cv2.resize(gray, (int(w * scale), int(h * scale)),
                                  interpolation=cv2.INTER_AREA)
            boxes = self._run_psm(gray, self.config.psm)
            if not boxes and self.config.fallback_psm != self.config.psm:
                boxes = self._run_psm(gray, self.config.fallback_psm)
            return boxes
        except Exception:
            return []


def get_provider(name: str, fixtures: list[OcrBox] | None = None,
                 config=None) -> OCRProvider:
    if name == "mock":
        return MockOCRProvider(fixtures)
    if name == "tesseract":
        return TesseractProvider(config=config)
    raise ValueError(f"unknown OCR provider {name!r}")
