"""
Detection V2 — Legend definition extraction.

Reuses existing infrastructure (preprocess, candidate_detection,
ocr_runner, association, tag_parser, template_extract) — no duplicates.
Flow: legend page image + OCR boxes + visual candidates
  → ranked symbol↔text associations (ambiguous kept ranked)
  → one definition per reliably-associated symbol (variants supported).
"""
from __future__ import annotations

import numpy as np

from association import rank_associations
from legend_model import LegendDefinition, LegendGeometry, LegendVisualFeatures
from tag_parser import TagParser
from template_extract import extract_variant


def _valid_bbox(b: dict, W: int, H: int) -> bool:
    try:
        return (b["width"] > 0 and b["height"] > 0
                and b["x"] >= 0 and b["y"] >= 0
                and b["x"] + b["width"] <= W and b["y"] + b["height"] <= H)
    except (KeyError, TypeError):
        return False


def _containment(inner: dict, outer: dict) -> float:
    ix0, iy0 = max(inner["x"], outer["x"]), max(inner["y"], outer["y"])
    ix1 = min(inner["x"] + inner["width"], outer["x"] + outer["width"])
    iy1 = min(inner["y"] + inner["height"], outer["y"] + outer["height"])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    area = inner["width"] * inner["height"]
    return inter / area if area > 0 else 0.0


def _text_masked(syms: list, ocr_boxes: list, ratio: float = 0.5) -> list:
    """Drop visual candidates that are glyph fragments inside real text.

    A candidate is masked only when mostly contained in a text region that is
    MUCH BIGGER than itself (word box vs letter blob). Symbol-sized OCR
    hallucinations ('()' over a circle) have comparable areas and are kept —
    their low OCR confidence / non-tag text keeps them out of definitions
    via the association gate instead.
    """
    kept = []
    for s in syms:
        area = s["bbox"]["width"] * s["bbox"]["height"]
        masked = False
        for ob in ocr_boxes:
            tb = ob.bbox
            if not tb.get("width") or not tb.get("height"):
                continue
            if _containment(s["bbox"], tb) >= ratio and \
               tb["width"] * tb["height"] > area * 2:
                masked = True
                break
        if not masked:
            kept.append(s)
    return kept


def extract_definitions(
    gray: np.ndarray,
    binary: np.ndarray,
    visual_candidates: list,
    ocr_boxes: list,
    legend_id: str,
    source_page: int = 1,
    min_assoc_score: float = 0.25,
    tag_parser=None,
    # Legend labels sit BESIDE symbols with wider gaps than P&ID tags sit
    # next to symbols — a wider gate is the documented layout convention
    # for legend pages (still deterministic + configured, not guessing).
    max_norm: float = 0.30,
) -> tuple[list[LegendDefinition], list[dict]]:
    """Returns (definitions, associations_debug). Deterministic, no AI."""
    H, W = gray.shape[:2]
    parser = tag_parser or TagParser()
    syms = [{"id": c.candidateId, "bbox": c.bbox} for c in visual_candidates
            if _valid_bbox(c.bbox, W, H)]
    # Mask letter blobs: OCR text regions must not become "symbols".
    syms = _text_masked(syms, ocr_boxes)
    page = {"pageWidth": W, "pageHeight": H}
    definitions: list[LegendDefinition] = []
    debug: list[dict] = []
    candidate_to_def: dict[str, LegendDefinition] = {}
    for i, ob in enumerate(ocr_boxes):
        if not _valid_bbox(ob.bbox, W, H):
            debug.append({"textIndex": i, "skipped": "invalid-bbox"})
            continue
        ranked = rank_associations(
            {"id": f"legend-text-{i}", "bbox": ob.bbox,
             "isTag": False, "tagLike": False},
            syms, page, max_norm=max_norm)
        # Keep ranking; attach best only when unambiguous enough.
        debug.append({"textIndex": i, "text": ob.text,
                      "ranked": [r.to_dict() for r in ranked[:3]]})
        if not ranked or ranked[0].score < min_assoc_score:
            continue
        best = ranked[0]
        if best.direction in ("OVERLAP", "CONTAINED"):
            # Text printed ON a symbol is a hallucination or an ambiguous
            # inside-label — never a definition label (labels sit beside
            # their symbol). Conservative skip, recorded in debug.
            debug.append({"textIndex": i, "text": ob.text,
                          "skipped": f"overlaps-symbol ({best.direction})"})
            continue
        if best.symbolId in candidate_to_def:
            # Second text for same symbol → alias, not a new definition.
            d = candidate_to_def[best.symbolId]
            if ob.text not in d.aliases + [d.label]:
                d.aliases.append(ob.text)
                d.provenance.append(f"alias-from-text-{i}")
            continue
        candidate_to_def[best.symbolId] = None  # placeholder, set below
        sbbox = next(s["bbox"] for s in syms if s["id"] == best.symbolId)
        variant = extract_variant(gray, binary, sbbox, variant_id="v1")
        area = float(sbbox["width"] * sbbox["height"])
        new_def = LegendDefinition(
            legendId=legend_id,
            symbolId=f"{legend_id}-sym-{len(definitions)}",
            label=ob.text,  # verbatim — NOT an asset type
            aliases=[],
            category="",
            bbox={k: int(sbbox[k]) for k in ("x", "y", "width", "height")},
            geometry=LegendGeometry(
                aspectRatio=variant["aspectRatio"],
                relativeArea=round(area / max(1, W * H), 6),
                width=int(sbbox["width"]), height=int(sbbox["height"])),
            visualFeatures=LegendVisualFeatures(
                huMoments=variant["huMoments"],
                edgeDensity=variant["edgeDensity"],
                lineCount=variant["lineCount"],
                componentCount=variant["componentCount"],
                contourCount=variant["contourCount"]),
            variants=[variant],
            sourcePage=source_page,
            rotationInvariant=False,
            provenance=[f"assoc-score={best.score}",
                        f"direction={best.direction}"],
        )
        definitions.append(new_def)
        candidate_to_def[best.symbolId] = new_def
    return definitions, debug
