"""
Detection V2 — deterministic OCR cache.

Key = sha256(image bytes + provider + provider version + config + variant +
pipeline version). NEVER page number alone — same page at different DPI or
settings must not collide. In-memory LRU; optional disk spillover.
"""
from __future__ import annotations

import hashlib
import os
from collections import OrderedDict
from typing import Any


def cache_key(image_bytes: bytes, provider: str, provider_version: str,
              config_key: str, variant: str, pipeline_version: str) -> str:
    h = hashlib.sha256()
    h.update(image_bytes)
    for part in (provider, provider_version, config_key, variant, pipeline_version):
        h.update(b"\x00")
        h.update(str(part).encode("utf-8", "replace"))
    return h.hexdigest()


class OcrCache:
    def __init__(self, capacity: int = 256) -> None:
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


# Process-wide default cache (keyed fully — safe across pages/DPIs).
default_cache = OcrCache()
