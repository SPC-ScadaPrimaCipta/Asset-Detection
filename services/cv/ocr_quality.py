"""
Detection V2 — deterministic OCR quality features (evidence only).

No thresholds-as-truth here: features describe the candidate so LATER
stages (association, confidence engine) can weigh them. Never rejects.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass


@dataclass
class OcrQuality:
    charCount: int = 0
    confidence: float = 0.0
    tagPatternMatch: bool = False
    alphanumericRatio: float = 0.0
    normalizationDistance: int = 0  # levenshtein(raw, normalized)
    bboxArea: float = 0.0
    aspectRatio: float = 0.0
    rotation: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        for j in range(1, lb + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1,
                         prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
        prev = cur
    return prev[lb]


def quality_for(raw: str, normalized: str, confidence: float, bbox: dict,
                rotation: int, is_tag: bool) -> OcrQuality:
    alnum = sum(1 for ch in normalized if ch.isalnum())
    area = float(bbox.get("width", 0)) * float(bbox.get("height", 0))
    h = float(bbox.get("height", 0))
    return OcrQuality(
        charCount=len(normalized),
        confidence=float(confidence),
        tagPatternMatch=bool(is_tag),
        alphanumericRatio=(alnum / len(normalized)) if normalized else 0.0,
        normalizationDistance=levenshtein(raw or "", normalized or ""),
        bboxArea=area,
        aspectRatio=(float(bbox.get("width", 0)) / h) if h > 0 else 0.0,
        rotation=int(rotation),
    )
