"""
Detection V2 — deterministic OCR text normalization (auditable).

Every step records its transformation. Character substitutions (O↔0, l↔1,
S↔5, B↔8) are CONTEXTUAL ONLY: applied inside numeric tag segments and ONLY
when the result matches a configured tag pattern. Arbitrary text is never
silently rewritten.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


@dataclass
class NormalizedText:
    raw: str = ""
    normalized: str = ""
    transformations: list = field(default_factory=list)


# Confusion pairs applied ONLY inside digit-expected segments.
NUMERIC_FIXES: tuple = (
    ("O", "0", "O→0"), ("o", "0", "o→0"),
    ("I", "1", "I→1"), ("i", "1", "i→1"), ("l", "1", "l→1"), ("L", "1", "L→1"),
    ("S", "5", "S→5"), ("s", "5", "s→5"),
    ("B", "8", "B→8"), ("b", "8", "b→8"), ("G", "6", "G→6"), ("Z", "2", "Z→2"),
)


def base_normalize(raw: str) -> NormalizedText:
    """Unicode + whitespace + case + punctuation. No char substitution."""
    out = NormalizedText(raw=raw or "")
    t = unicodedata.normalize("NFKC", out.raw)
    if t != out.raw:
        out.transformations.append("unicode NFKC normalization")
    t2 = re.sub(r"\s+", "", t.strip())
    if t2 != t:
        out.transformations.append("whitespace normalization")
        t = t2
    # Punctuation: normalize common OCR artifacts around hyphens.
    t2 = re.sub(r"[‐‑‒–—―−]", "-", t)
    t2 = re.sub(r"-{2,}", "-", t2)
    if t2 != t:
        out.transformations.append("punctuation normalization")
        t = t2
    # Phase 9: edge punctuation trim — cloud/rev-markup artifacts wrap tags:
    # (VLV-390795  VLV-390795)  [VLV-390795]  VLV-390795,  "1in suffix.
    # EDGES ONLY (compounds like PSV-PDT-11 and internals never touched).
    # Inch marks (WF-204-A013-1") are trimmed as parsing noise and recorded.
    EDGE_STRIP = "()[]{}\"'.,;:!?"
    lead = t[:len(t) - len(t.lstrip(EDGE_STRIP))]
    trail = t[len(t.rstrip(EDGE_STRIP)):]
    t3 = t.strip(EDGE_STRIP)
    if t3 != t and t3:
        out.transformations.append(f"edge punctuation trim ({lead!r}…{trail!r})")
        t = t3
    u = t.upper()
    if u != t:
        out.transformations.append("uppercase normalization")
        t = u
    out.normalized = t
    return out


def _apply_numeric_fixes(segment: str) -> tuple[str, list]:
    fixed = segment
    applied: list[str] = []
    for src, dst, label in NUMERIC_FIXES:
        if src in fixed:
            fixed = fixed.replace(src, dst)
            applied.append(f"contextual {label} correction")
    return fixed, applied


def _reinterpretations(normalized: str) -> list[tuple[str, list]]:
    """All single-fix + full-fix candidates for the numeric tail segment."""
    if "-" not in normalized:
        return []
    head, _, tail = normalized.rpartition("-")
    out: list[tuple[str, list]] = []
    for src, dst, label in NUMERIC_FIXES:
        if src not in tail:
            continue
        out.append((head + "-" + tail.replace(src, dst), [f"contextual {label} correction"]))
    fixed_tail, applied = _apply_numeric_fixes(tail)
    if fixed_tail != tail:
        out.append((head + "-" + fixed_tail, applied))
    return out


def contextual_correct(normalized: str, matches_pattern,
                       known_tags: set | None = None) -> NormalizedText:
    """Try confusion fixes inside numeric segments; keep ONLY pattern-valid results.

    matches_pattern: callable(str) -> bool (TagParser-backed).
    known_tags: optional set of valid tags (Legend/project context).
      - pattern-INVALID input → fix accepted when result is pattern-valid.
      - pattern-VALID input → untouched, UNLESS a reinterpretation hits
        known_tags while the raw form does not (genuine ambiguity like
        P-10L vs P-101 resolved by context, never by guessing).
    """
    out = NormalizedText(raw=normalized, normalized=normalized)
    valid = matches_pattern(normalized)
    if valid and (not known_tags or normalized in known_tags):
        return out  # valid and no contradicting context — touch nothing
    for cand, applied in _reinterpretations(normalized):
        if not matches_pattern(cand):
            continue
        if valid:
            # Raw was already pattern-valid: only switch on known-tag evidence.
            if known_tags is not None and cand in known_tags and normalized not in known_tags:
                out.normalized, out.transformations = cand, applied
            return out
        out.normalized, out.transformations = cand, applied
        return out
    return out
