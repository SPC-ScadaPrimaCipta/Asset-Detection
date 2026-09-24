"""
Detection V2 — deterministic Legend label ↔ OCR text matching.

Rules:
  - exact normalized match (case/whitespace/punct folded) → strong
  - token overlap against label + EXPLICIT aliases only
  - generic fuzzy similarity is NEVER the sole decision: below-threshold
    pairs are reported as non-matches with their score, not aliases.
Aliases must come from Legend config / human curation, not invented here.
"""
from __future__ import annotations

import re
import unicodedata


def normalize_label(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "")
    t = re.sub(r"\s+", " ", t.strip()).upper()
    return re.sub(r"[‐‑‒–—―−]", "-", t)


def token_set(text: str) -> set:
    return {tok for tok in re.split(r"[^A-Z0-9]+", normalize_label(text)) if tok}


def label_match(query: str, definition: dict, token_threshold: float = 0.5) -> dict:
    """definition: LegendDefinition dict (label + aliases)."""
    q = normalize_label(query)
    label = normalize_label(definition.get("label", ""))
    aliases = [normalize_label(a) for a in (definition.get("aliases") or [])]
    if q and q == label:
        return {"match": True, "kind": "exact-label", "score": 1.0,
                "reasons": [f'exact label match "{definition.get("label")}"']}
    if q and q in aliases:
        return {"match": True, "kind": "exact-alias", "score": 0.9,
                "reasons": ["exact alias match"]}
    qt, lt = token_set(q), token_set(label)
    overlap = (len(qt & lt) / max(1, len(qt | lt)))
    if qt and lt and overlap >= token_threshold:
        return {"match": True, "kind": "token-overlap",
                "score": round(0.5 + 0.4 * overlap, 3),
                "reasons": [f"token overlap={overlap:.2f} (threshold {token_threshold})"]}
    for a in aliases:
        at = token_set(a)
        ov = len(qt & at) / max(1, len(qt | at))
        if qt and at and ov >= token_threshold:
            return {"match": True, "kind": "token-alias",
                    "score": round(0.4 + 0.4 * ov, 3),
                    "reasons": [f"alias token overlap={ov:.2f}"]}
    return {"match": False, "kind": "none",
            "score": round(overlap if (qt and lt) else 0.0, 3),
            "reasons": ["below token threshold — not an alias"]}
