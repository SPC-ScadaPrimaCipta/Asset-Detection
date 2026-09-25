"""
Detection V2 — intermediate OCR/tag/association metrics (§16).

These are PIPELINE metrics, NOT asset-detection accuracy:
  ocr_detection_rate, tag_recognition_rate, normalization_accuracy,
  false_tag_rate, duplicate_merge_rate, association_recall.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class OcrMetrics:
    ocr_detection_rate: float = 0.0
    tag_recognition_rate: float = 0.0
    normalization_accuracy: float = 0.0
    false_tag_rate: float = 0.0
    duplicate_merge_rate: float = 0.0
    association_recall: float = 0.0
    n: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def _rate(ok: int, total: int) -> float:
    return round(ok / total, 4) if total else 0.0


def compute_metrics(cases: list[dict]) -> OcrMetrics:
    """Each case: {expected_text|None, detected_text|None, expected_tag|None,
    parsed_is_tag, normalized_ok, merged_ok, associated_ok, ...}."""
    m = OcrMetrics(n=len(cases))
    m.ocr_detection_rate = _rate(sum(1 for c in cases if c.get("detected_text")), len(cases))
    tagged = [c for c in cases if c.get("expected_tag")]
    m.tag_recognition_rate = _rate(
        sum(1 for c in tagged if c.get("parsed_is_tag") and c.get("tag_match")), len(tagged))
    norm_cases = [c for c in cases if c.get("needs_normalization")]
    m.normalization_accuracy = _rate(sum(1 for c in norm_cases if c.get("normalized_ok")),
                                    len(norm_cases))
    non_tag = [c for c in cases if not c.get("expected_tag")]
    m.false_tag_rate = _rate(sum(1 for c in non_tag if c.get("parsed_is_tag")), len(non_tag))
    dupes = [c for c in cases if c.get("is_duplicate")]
    m.duplicate_merge_rate = _rate(sum(1 for c in dupes if c.get("merged_ok")), len(dupes))
    assoc = [c for c in cases if c.get("expected_symbol")]
    m.association_recall = _rate(sum(1 for c in assoc if c.get("associated_ok")), len(assoc))
    return m


# §15 — deterministic OCR fixture set (expected behavior documented per item).
EVAL_FIXTURES: list[dict] = [
    {"name": "clean P-101", "raw": "P-101", "expected_tag": "P-101"},
    {"name": "clean P-102A", "raw": "P-102A", "expected_tag": "P-102A"},
    {"name": "clean FV-201", "raw": "FV-201", "expected_tag": "FV-201"},
    {"name": "ocr-error P-10l", "raw": "P-10l", "expected_tag": "P-101",
     "needs_normalization": True},
    {"name": "ocr-error P-IO1", "raw": "P-IO1", "expected_tag": "P-101",
     "needs_normalization": True},
    {"name": "ocr-error FV-2O1", "raw": "FV-2O1", "expected_tag": "FV-201",
     "needs_normalization": True},
    {"name": "compound PSV-PDT-11", "raw": "psv-pdt-11", "expected_tag": "PSV-PDT-11"},
    {"name": "false-positive PAGE 11", "raw": "PAGE 11", "expected_tag": None},
    {"name": "false-positive DRAWING", "raw": "DRAWING", "expected_tag": None},
    {"name": "false-positive REV A", "raw": "REV A", "expected_tag": None},
    {"name": "false-positive DATE", "raw": "DATE", "expected_tag": None},
]
