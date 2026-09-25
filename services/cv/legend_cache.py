"""
Detection V2 — Legend extraction cache.

Key = sha256(pdf bytes + pages + render DPI + preproc config + OCR config +
pipeline version + extractor version). Any relevant input change => miss.
Filename is NEVER part of the key.
"""
from __future__ import annotations

import hashlib
from collections import OrderedDict
from typing import Any


def legend_cache_key(pdf_bytes: bytes, pages: list, render_dpi: int,
                     preproc_key: str, ocr_key: str,
                     pipeline_version: str, extractor_version: str) -> str:
    h = hashlib.sha256()
    h.update(pdf_bytes)
    for part in (",".join(str(p) for p in pages), str(render_dpi), preproc_key,
                 ocr_key, pipeline_version, extractor_version):
        h.update(b"\x00")
        h.update(str(part).encode("utf-8", "replace"))
    return h.hexdigest()


class LegendCache:
    def __init__(self, capacity: int = 32) -> None:
        self._mem: OrderedDict[str, Any] = OrderedDict()
        self.capacity = capacity
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Any | None:
        if key in self._mem:
            self.hits += 1
            self._mem.move_to_end(key)
            return self._mem[key]
        self.misses += 1
        return None

    def put(self, key: str, value: Any) -> None:
        self._mem[key] = value
        self._mem.move_to_end(key)
        while len(self._mem) > self.capacity:
            self._mem.popitem(last=False)

    def stats(self) -> dict:
        total = self.hits + self.misses
        return {"hits": self.hits, "misses": self.misses,
                "hitRate": round(self.hits / total, 3) if total else 0.0,
                "size": len(self._mem)}


default_legend_cache = LegendCache()
