"""Detection V2 — lightweight stage timing (no optimization, just measurement)."""
from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from schemas import StageTiming


class Timer:
    def __init__(self) -> None:
        self.stages: list[StageTiming] = []

    @contextmanager
    def stage(self, name: str, **detail) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            ms = (time.perf_counter() - start) * 1000.0
            self.stages.append(StageTiming(name=name, ms=round(ms, 2), detail=detail))

    def total_ms(self) -> float:
        return round(sum(s.ms for s in self.stages), 2)

    def as_dicts(self) -> list[dict]:
        return [
            {"name": s.name, "ms": s.ms, "detail": s.detail} for s in self.stages
        ]
