from dedup import center_distance, deduplicate, iou
from schemas import Candidate


def cand(cid, x, y, w=100, h=100, tile=0, page=1, ctype="visual"):
    return Candidate(candidateId=cid, pageNumber=page, tileId=tile,
                     bbox={"x": x, "y": y, "width": w, "height": h},
                     candidateType=ctype)


def test_iou_identical_is_one():
    b = {"x": 0, "y": 0, "width": 50, "height": 50}
    assert iou(b, b) == 1.0


def test_iou_disjoint_is_zero():
    assert iou({"x": 0, "y": 0, "width": 10, "height": 10},
               {"x": 50, "y": 50, "width": 10, "height": 10}) == 0.0


def test_identical_candidates_merge_with_provenance():
    out = deduplicate([cand("a", 10, 10, tile=0), cand("b", 10, 10, tile=1)])
    assert len(out) == 1
    assert out[0].provenance == ["tile:0", "tile:1", "merged:b"]
    assert out[0].evidence.sourceTiles == [0, 1]


def test_high_iou_from_adjacent_tiles_merges():
    # Same symbol seen from two overlapping tiles, slight shift, same page coords.
    out = deduplicate([cand("a", 100, 100, tile=0), cand("b", 105, 103, tile=1)])
    assert len(out) == 1
    m = out[0].bbox
    assert m["x"] == 100 and m["width"] == 105  # union


def test_low_iou_stays_separate():
    out = deduplicate([cand("a", 0, 0), cand("b", 500, 500)])
    assert len(out) == 2


def test_nearby_but_distinct_kept():
    out = deduplicate([cand("a", 0, 0), cand("b", 60, 60)])
    # IoU(0,0,100x100 vs 60,60,100x100) = 1600/18400 ≈ 0.087 < 0.5
    assert len(out) == 2


def test_different_pages_never_merge():
    out = deduplicate([cand("a", 10, 10, page=1), cand("b", 10, 10, page=2)])
    assert len(out) == 2


def test_center_distance_sanity():
    assert center_distance({"x": 0, "y": 0, "width": 10, "height": 10},
                           {"x": 0, "y": 0, "width": 10, "height": 10}) == 0.0
