"""
Phase 8 runner: REAL deterministic chain on the PDT-11 reconstruction.

CV → OCR(Tesseract) → normalize/parse → legend match → associate →
confidence → evaluate vs human GT. No Gemini in the measured path
(Gemini delta evaluated separately with explicit transport).

Sweep recomputes BANDS per config (matching fixed) → review-volume
trade-off table. Detection P/R is config-independent — reported once.
"""
import json

from association import rank_associations
from bbox_refine import refine_tight
from candidate_detection import DetectorConfig, detect_candidates
from confidence_engine import ConfidenceConfig, compute_confidence
from dedup import deduplicate
from evaluation import evaluate, gemini_delta, match_predictions
from legend_extract import extract_definitions
from legend_match import MatchConfig, match_candidate
from line_layer import long_line_mask, remove_lines, reunite_split
from match_repair import RepairConfig, rematch_with_reconstruction
from ocr_config import OcrConfig
from ocr_providers import OcrBox, TesseractProvider
from ocr_runner import run_ocr
from preprocess import PreprocessConfig, preprocess_with_config, to_grayscale
from schemas import Candidate
from tag_parser import TagParser
from template_extract import TEMPLATE_SIZE, extract_variant, normalize_crop
from text_normalization import base_normalize, contextual_correct
from timing import Timer

import eval_pdt11 as E


def run_pipeline(page_img, legend_defs, ocr_provider=None,
                 known_tags=None, timers=None,
                 mask_cfg=None, linesplit=False, line_dilate_px=3,
                 line_min_len_ratio=0.12, refine=False, repair_cfg=None):
    """Full deterministic pass. Returns (predictions, evidence_rows, info).

    Phase 10 flags (matcher-stage only, defaults OFF = Phase 9 behavior):
      refine: tight-bbox refinement pre-match (bbox_refine).
      repair_cfg: None = direct match only; RepairConfig = local
                  reconstruction attempt with dual evidence (match_repair).
    """
    """Full deterministic pass. Returns (predictions, evidence_rows, info).

    mask_cfg: None = masking OFF (Phase 8 baseline); MaskConfig = text-aware
              glyph suppression ON (Phase 9.1).
    linesplit: line-aware splitting + reunion ON (Phase 9.3).
    Punctuation trim (Phase 9.2) lives in base_normalize (always on).
    """
    from text_mask import suppress_glyphs
    t = timers or Timer()
    gray = to_grayscale(page_img)
    with t.stage("preprocess"):
        layers = preprocess_with_config(page_img, PreprocessConfig())
    work = layers["work"]
    line_info = {"removed": False, "lines": 0}
    with t.stage("detect"):
        if linesplit:
            mask, lines = long_line_mask(work, min_len_ratio=line_min_len_ratio,
                                         dilate_px=line_dilate_px)
            line_info = {"removed": True, "lines": len(lines)}
            work_det = remove_lines(work, mask)
            if work_det.sum() == 0:  # safety: blanked entirely → fall back
                work_det = work
                line_info["removed"] = False
            raw_cands = detect_candidates(work_det, page_number=1)
            reunited = reunite_split([c.bbox for c in raw_cands])
            for c, b in zip(raw_cands, reunited):
                c.bbox = {k: int(v) for k, v in b.items()
                          if k in ("x", "y", "width", "height")}
                if b.get("reunited"):
                    c.evidence.notes = list(c.evidence.notes) + ["line-split reunited"]
                c.evidence.notes = list(c.evidence.notes) + ["line-removed-layer"]
            visual = raw_cands
        else:
            visual = detect_candidates(work, page_number=1)
    with t.stage("dedup-visual"):
        visual_c = [Candidate(candidateId=f"v{i}", pageNumber=1, tileId=0,
                              bbox=c.bbox, candidateType="visual",
                              geometry=c.geometry, evidence=c.evidence, source="cv")
                    for i, c in enumerate(visual)]
        visual_c = deduplicate(visual_c)
    prov = ocr_provider or TesseractProvider(config=OcrConfig())
    with t.stage("ocr"):
        boxes, attempts, warns = run_ocr(page_img, prov, OcrConfig(), t)
    with t.stage("text-mask"):
        mask_suppressed = []
        if mask_cfg is not None:
            visual_c, mask_suppressed = suppress_glyphs(
                visual_c, [{"bbox": b} for b in [ob.bbox for ob in boxes]], mask_cfg)
    parser = TagParser()
    texts = []
    with t.stage("normalize-parse"):
        for i, ob in enumerate(boxes):
            base = base_normalize(ob.text)
            fixed = contextual_correct(base.normalized, parser.matches,
                                       known_tags=known_tags)
            tag = parser.parse(fixed.normalized)
            tag.raw = ob.text
            texts.append({"id": f"t{i}", "bbox": dict(ob.bbox),
                          "raw": ob.text, "normalized": fixed.normalized,
                          "isTag": tag.isTag, "tagLike": "-" in fixed.normalized,
                          "tag": tag, "conf": ob.confidence})
    with t.stage("legend-match"):
        match_cfg = MatchConfig()
        cand_matches = {}
        neighbor_boxes = [dict(vc.bbox) for vc in visual_c]
        for vc in visual_c:
            if refine:
                tight = refine_tight(gray, vc.bbox)
                if tight is not None:
                    vc.bbox = {k: tight[k] for k in ("x", "y", "width", "height")}
                    vc.evidence.notes = list(vc.evidence.notes) + ["bbox refined tight"]
            if repair_cfg is not None:
                res = rematch_with_reconstruction(
                    gray, vc.bbox, vc.candidateId, neighbor_boxes,
                    legend_defs, match_cfg, repair_cfg)
                ms = res["selected"]
                qbox = res["queryBox"]
                v = extract_variant(gray, gray, qbox, vc.candidateId)
                cand_matches[vc.candidateId] = (ms, v, res)
            else:
                v = extract_variant(gray, gray, vc.bbox, vc.candidateId)
                q = {"id": vc.candidateId, "aspectRatio": v["aspectRatio"],
                     "huMoments": v["huMoments"], "edgeDensity": v["edgeDensity"],
                     "lineCount": v["lineCount"],
                     "normCrop": normalize_crop(gray, vc.bbox, TEMPLATE_SIZE)}
                ms = match_candidate(q, legend_defs, match_cfg)
                cand_matches[vc.candidateId] = (ms, v, None)
    H, W = gray.shape[:2]
    with t.stage("associate"):
        syms = [{"id": vc.candidateId, "bbox": vc.bbox} for vc in visual_c]
        page = {"pageWidth": W, "pageHeight": H}
        assoc = {}
        for tx in texts:
            ranked = rank_associations(
                {"id": tx["id"], "bbox": tx["bbox"], "isTag": tx["isTag"],
                 "tagLike": tx["tagLike"]}, syms, page)
            assoc[tx["id"]] = ranked
        # symbol -> best tag (top-1 per text, first claim wins by score order)
        sym_tag = {}
        for tx in texts:
            if assoc[tx["id"]]:
                best = assoc[tx["id"]][0]
                if best.symbolId not in sym_tag:
                    sym_tag[best.symbolId] = tx
    with t.stage("confidence"):
        preds, rows = [], []
        for vc in visual_c:
            ms, v, repair = cand_matches[vc.candidateId]
            top = ms[0] if ms else None
            match_from = (repair["selectedFrom"] if repair else "direct")
            if repair is not None:
                vc.bbox = dict(repair["queryBox"])
            st = sym_tag.get(vc.candidateId)
            ocr_in = ({"isTag": st["isTag"], "confidence": st["conf"]}
                      if st else None)
            spat = ([{"symbolId": vc.candidateId, "score": r.score}
                     for r in (assoc[st["id"]] if st else [])] if st else [])
            leg = ([{"legendSymbolId": m["legendSymbolId"], "label": m["label"],
                     "score": m["score"]} for m in ms[:3]])
            out = compute_confidence(
                vc.candidateId,
                {"geometryScore": v["aspectRatio"] and ms[0]["features"]["geometryScore"] if ms else None,
                 "contourScore": ms[0]["features"]["contourScore"] if ms else None,
                 "templateScore": ms[0]["features"]["templateScore"] if ms else None,
                 "edgeScore": ms[0]["features"]["edgeScore"] if ms else None,
                 "scaleScore": ms[0]["features"]["scaleScore"] if ms else None,
                 "rotationScore": None},
                legend_matches=leg, spatial_ranked=spat, ocr=ocr_in)
            preds.append({"candidateId": vc.candidateId, "bbox": dict(vc.bbox),
                          "label": top["label"] if top else None,
                          "symbolId": top["legendSymbolId"] if top else None,
                          "tag": (st["tag"].normalized if st and st["isTag"] else None),
                          "confidence": out.confidence, "band": out.decisionBand,
                          "matchFrom": match_from,
                          "directTop": (repair["direct"][0]["score"]
                                        if repair and repair["direct"] else None),
                          "reconTop": (repair["reconstructed"][0]["score"]
                                       if repair and repair["reconstructed"] else None),
                          "reconUsed": (repair["reconstruction"]["used"]
                                        if repair else False)})
            rows.append({"candidateId": vc.candidateId, "signals": {
                "geometryScore": out.evidence.geometryScore,
                "contourScore": out.evidence.contourScore,
                "templateScore": out.evidence.templateScore,
                "edgeScore": out.evidence.edgeScore,
                "scaleScore": out.evidence.scaleScore, "rotationScore": None},
                "legend": leg, "spatial": spat, "ocr": ocr_in})
    return preds, rows, {"attempts": attempts, "warnings": warns,
                           "lineInfo": line_info,
                           "masked": len(mask_suppressed)}


def build_legend_defs():
    img, items = E.build_legend()
    gray = to_grayscale(img)
    work = preprocess_with_config(img, PreprocessConfig())["work"]
    visual = detect_candidates(work, page_number=1)
    boxes = [OcrBox(text=it["label"], bbox=it["textBbox"], confidence=0.99)
             for it in items]
    defs, _ = extract_definitions(gray, work, visual, boxes, "leg-pdt11")
    return [d.to_dict() for d in defs]


WEIGHT_CONFIGS = {
    "A-default": {},
    "B-legend-heavy": {"w_legend": 0.45, "w_visual": 0.15, "w_geometry": 0.10,
                       "w_ocr": 0.15, "w_spatial": 0.15},
    "C-visual-heavy": {"w_legend": 0.15, "w_visual": 0.40, "w_geometry": 0.20,
                       "w_ocr": 0.10, "w_spatial": 0.15},
}


def sweep_bands(rows, highs=(0.85, 0.88, 0.90, 0.92, 0.95),
                lows=(0.50, 0.55, 0.60, 0.65, 0.70)):
    """Recompute bands per threshold/weight combo → routing trade-off table."""
    table = []
    for wname, wcfg in WEIGHT_CONFIGS.items():
        for hi in highs:
            for lo in lows:
                if lo >= hi:
                    continue
                cfg = ConfidenceConfig.from_dict(
                    {"high_threshold": hi, "low_threshold": lo, **wcfg})
                bands = [compute_confidence(
                    r["candidateId"], r["signals"], r["legend"],
                    r["spatial"], r["ocr"], cfg).decisionBand for r in rows]
                table.append({
                    "weights": wname, "high": hi, "low": lo,
                    "HIGH": sum(1 for b in bands if b == "HIGH"),
                    "REVIEW": sum(1 for b in bands if b == "REVIEW"),
                    "LOW": sum(1 for b in bands if b == "LOW"),
                    "reviewVolume": sum(1 for b in bands if b != "HIGH"),
                    "n": len(bands),
                })
    return table
