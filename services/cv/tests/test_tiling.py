"""Tile grid vectors — MUST match TS computeTileGrid expectations 1:1."""
from tiling import compute_tile_grid, tile_to_page


def test_single_tile_small_page():
    tiles = compute_tile_grid(800, 600, 1280, 0.2)
    assert len(tiles) == 1
    assert (tiles[0].tileX, tiles[0].tileY, tiles[0].width, tiles[0].height) == (0, 0, 800, 600)


def test_horizontal_split_with_overlap_and_edge_snap():
    tiles = compute_tile_grid(3000, 600, 1280, 0.2)
    assert len(tiles) == 3
    assert tiles[1].tileX < tiles[0].tileX + tiles[0].width  # overlap
    last = tiles[-1]
    assert last.tileX + last.width == 3000  # edge snap


def test_vertical_split():
    tiles = compute_tile_grid(800, 3000, 1280, 0.2)
    assert len(tiles) == 3
    assert tiles[-1].tileY + tiles[-1].height == 3000


def test_full_coverage_large_page():
    tiles = compute_tile_grid(5100, 3600, 1280, 0.2)
    assert len(tiles) > 1
    assert min(t.tileX for t in tiles) == 0
    assert min(t.tileY for t in tiles) == 0
    assert max(t.tileX + t.width for t in tiles) == 5100
    assert max(t.tileY + t.height for t in tiles) == 3600
    for t in tiles:
        assert t.tileX + t.width <= 5100
        assert t.tileY + t.height <= 3600


def test_non_divisible_dimensions():
    tiles = compute_tile_grid(2000, 1500, 1280, 0.2)
    assert max(t.tileX + t.width for t in tiles) == 2000
    assert max(t.tileY + t.height for t in tiles) == 1500


def test_tile_to_page_offset():
    tiles = compute_tile_grid(3000, 600, 1280, 0.2)
    t = tiles[1]
    out = tile_to_page({"x": 50, "y": 60, "width": 96, "height": 88},
                       {"x": t.tileX, "y": t.tileY})
    assert out == {"x": t.tileX + 50, "y": t.tileY + 60, "width": 96, "height": 88}
