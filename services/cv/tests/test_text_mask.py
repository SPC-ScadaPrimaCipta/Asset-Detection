"""Phase 9.1 — text masking unit tests (suppression, never blind deletion)."""
from text_mask import MaskConfig, suppress_glyphs
from schemas import Candidate, CandidateEvidence, CandidateGeometry


def vc(cid, x, y, w, h, conv=0.5):
    return Candidate(candidateId=cid, pageNumber=1, tileId=0,
                     bbox={"x": x, "y": y, "width": w, "height": h},
                     candidateType="visual",
                     geometry=CandidateGeometry(area=w * h, convexity=conv),
                     evidence=CandidateEvidence())


def tbox(x, y, w, h):
    return {"bbox": {"x": x, "y": y, "width": w, "height": h}}


def test_glyph_inside_word_box_suppressed_with_reason():
    glyph = vc("g1", 10, 10, 14, 14, conv=0.9)  # letter blob
    kept, supp = suppress_glyphs([glyph], [tbox(0, 0, 200, 40)])
    assert kept == [] and len(supp) == 1
    assert "glyph fragment" in supp[0].reason
    assert supp[0].candidateId == "g1"


def test_symbol_near_text_kept():
    valve = vc("v1", 300, 300, 44, 44, conv=0.9)
    kept, supp = suppress_glyphs([valve], [tbox(0, 0, 200, 40)])
    assert [c.candidateId for c in kept] == ["v1"] and supp == []


def test_symbol_partially_overlapping_text_kept():
    # Tag cloud beside symbol: containment low → untouched.
    sym = vc("s1", 390, 426, 44, 44, conv=0.9)
    kept, supp = suppress_glyphs([sym], [tbox(329, 336, 208, 41)])
    assert [c.candidateId for c in kept] == ["s1"]


def test_closed_large_geometry_kept_despite_containment():
    big = vc("b1", 10, 10, 100, 100, conv=0.95)
    kept, supp = suppress_glyphs([big], [tbox(0, 0, 200, 200)])
    assert [c.candidateId for c in kept] == ["b1"] and supp == []
    assert any("closed large geometry" in n for n in kept[0].evidence.notes)


def test_comparable_areas_not_masked():
    # Symbol-sized OCR hallucination ('()' over circle): areas comparable → keep.
    sym = vc("s1", 100, 100, 125, 125, conv=0.9)
    kept, supp = suppress_glyphs([sym], [tbox(95, 95, 129, 133)])
    assert [c.candidateId for c in kept] == ["s1"]


def test_config_drives_behavior():
    glyph = vc("g1", 10, 10, 14, 14)
    kept, _ = suppress_glyphs([glyph], [tbox(0, 0, 200, 40)],
                              MaskConfig(contain_thr=1.1))  # impossible gate
    assert [c.candidateId for c in kept] == ["g1"]
