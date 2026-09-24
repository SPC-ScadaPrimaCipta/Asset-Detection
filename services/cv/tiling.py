"""
Detection V2 — tile grid planner (Python port).

CANONICAL implementation for the Node path is computeTileGrid in
lib/pdf-render.ts. This port implements the IDENTICAL algorithm for
service-side use and unit tests; the shared vector in
tests/test_tiling.py pins both to the same expectations.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class TilePlan:
    index: int
    tileX: int
    tileY: int
    width: int
    height: int


def compute_tile_grid(
    page_width: int, page_height: int, tile_size: int, overlap: float
) -> list[TilePlan]:
    step = max(1, round(tile_size * (1 - overlap)))
    cols = max(1, math.ceil((page_width - tile_size) / step) + 1)
    rows = max(1, math.ceil((page_height - tile_size) / step) + 1)
    tiles: list[TilePlan] = []
    index = 0
    for r in range(rows):
        for c in range(cols):
            tile_x = max(0, page_width - tile_size) if c == cols - 1 else c * step
            tile_y = max(0, page_height - tile_size) if r == rows - 1 else r * step
            tiles.append(
                TilePlan(
                    index=index,
                    tileX=tile_x,
                    tileY=tile_y,
                    width=min(tile_size, page_width - tile_x),
                    height=min(tile_size, page_height - tile_y),
                )
            )
            index += 1
    return tiles


def tile_to_page(bbox: dict, origin: dict) -> dict:
    """Tile-local bbox → page-space bbox (mirror of TS tileToPage)."""
    return {
        "x": bbox["x"] + origin["x"],
        "y": bbox["y"] + origin["y"],
        "width": bbox["width"],
        "height": bbox["height"],
    }
