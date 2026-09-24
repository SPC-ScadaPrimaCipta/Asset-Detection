"""
Detection V2 — deterministic tag parser.

Separates OCR text RECOGNITION from TAG CLASSIFICATION:
  OCR: "P-101A"  →  parser: {isTag, prefix=P, number=101, suffix=A}

Patterns are configurable (list of {id, regex}); defaults cover common
ISA-style instrument/equipment tags. NEVER concludes asset type — that
belongs to association/legend stages.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from schemas import TagParse


@dataclass
class TagPattern:
    id: str
    regex: str
    _compiled: re.Pattern | None = field(default=None, repr=False)

    def compile(self) -> re.Pattern:
        if self._compiled is None:
            self._compiled = re.compile(self.regex)
        return self._compiled


DEFAULT_PATTERNS: list[TagPattern] = [
    # NOTE (Phase 8 evidence): real P&ID uses 6-digit numbers (VLV-380795,
    # PI-380082, P-380126). {1,6} covers plant numbering; {1,5} rejected them.
    TagPattern("std-prefix-number-suffix", r"^([A-Z]{1,6})-(\d{1,6})([A-Z]{0,2})$"),
    TagPattern("std-compound", r"^([A-Z]{1,6})-([A-Z]{1,6})-(\d{1,6})([A-Z]{0,2})$"),
]


def normalize_text(text: str) -> str:
    """Uppercase + trim + collapse whitespace. No char substitution here."""
    return re.sub(r"\s+", "", (text or "").strip().upper())


class TagParser:
    def __init__(self, patterns: list[TagPattern] | None = None) -> None:
        self.patterns = patterns or [TagPattern(p.id, p.regex) for p in DEFAULT_PATTERNS]

    def matches(self, normalized: str) -> bool:
        """True when normalized text satisfies any configured pattern."""
        return any(pat.compile().match(normalized or "") for pat in self.patterns)

    def parse(self, text: str) -> TagParse:
        raw = text or ""
        normalized = normalize_text(raw)
        if not normalized:
            return TagParse(raw=raw, normalized=normalized, isTag=False)
        for pat in self.patterns:
            m = pat.compile().match(normalized)
            if not m:
                continue
            groups = m.groups()
            if pat.id == "std-compound" and len(groups) == 4:
                prefix, mid, number, suffix = groups
                return TagParse(
                    raw=raw, normalized=normalized, isTag=True,
                    prefix=f"{prefix}-{mid}", number=number,
                    suffix=suffix or None, patternId=pat.id,
                    components=[prefix, mid],
                )
            if len(groups) == 3:
                prefix, number, suffix = groups
                return TagParse(
                    raw=raw, normalized=normalized, isTag=True,
                    prefix=prefix, number=number,
                    suffix=suffix or None, patternId=pat.id,
                    components=[prefix],
                )
            return TagParse(
                raw=raw, normalized=normalized, isTag=True, patternId=pat.id
            )
        return TagParse(raw=raw, normalized=normalized, isTag=False)
