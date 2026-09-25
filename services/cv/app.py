"""
Detection V2 — Python CV service (FastAPI sidecar).

Windows-native dev (no Docker required):
    python -m pip install -r services/cv/requirements.txt
    python services/cv/app.py          # -> http://127.0.0.1:8001

Deploy/CI: see services/cv/Dockerfile (same app, same contract).

Endpoints:
  GET  /health       liveness + version
  POST /preprocess   derived layers (backward-compat shape + variant/timings)
  POST /candidates   preprocess → visual candidates → OCR → tag parse
  POST /ocr          OCR abstraction probe (mock default, tesseract optional)

Contract: bboxes on the wire are TILE-LOCAL pixels; TS maps to canonical
page pixels via tileToPage. All errors are structured {error, message,
pipelineVersion} — never a raw traceback.
"""
from __future__ import annotations

import base64
import io
import os
import sys

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from artifacts import enabled as artifacts_enabled, save_image, save_overlay
from association import rank_associations
from candidate_detection import DetectorConfig, detect_candidates
from confidence_engine import ConfidenceConfig, compute_confidence
from dedup import deduplicate
from legend_cache import default_legend_cache, legend_cache_key
from legend_extract import extract_definitions
from legend_match import MatchConfig, MatchInstrumentation, match_candidate
from legend_model import legend_version
from legend_text_match import label_match
from line_layer import long_line_mask, remove_lines, reunite_split
from text_mask import MaskConfig, suppress_glyphs
from ocr_cache import cache_key, default_cache
from ocr_config import OcrConfig
from ocr_dedup import dedup_texts
from ocr_providers import OcrBox, get_provider
from ocr_quality import quality_for
from ocr_runner import run_ocr
from preprocess import PreprocessConfig, preprocess, preprocess_with_config
from schemas import (
    ERR_INTERNAL,
    ERR_INVALID_IMAGE,
    ERR_OCR_UNAVAILABLE,
    ERR_PROCESSING_FAILURE,
    ERR_UNSUPPORTED_FORMAT,
    Candidate,
    CandidatesResponse,
    OcrResult,
    TileMeta,
    error_body,
    pipeline_version,
)
from tag_parser import TagParser, TagPattern
from text_normalization import base_normalize, contextual_correct
from timing import Timer

PIPELINE_VERSION = pipeline_version()

app = FastAPI(title="asset-detection-cv", version=PIPELINE_VERSION)

MAX_IMAGE_BYTES = 100 * 1024 * 1024


def _decode_png(png_base64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(png_base64, validate=True)
    except Exception as exc:
        raise ValueError("INVALID_IMAGE: not valid base64") from exc
    if len(raw) == 0 or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("INVALID_IMAGE: empty or oversized payload")
    try:
        img = Image.open(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError("UNSUPPORTED_FORMAT: cannot decode image") from exc
    if img.format not in (None, "PNG", "JPEG", "BMP"):
        raise ValueError(f"UNSUPPORTED_FORMAT: {img.format}")
    return np.asarray(img.convert("RGB"))


def _tile_meta(body: dict) -> TileMeta:
    t = body.get("tile") or {}
    return TileMeta(
        pageNumber=int(body.get("pageNumber", t.get("pageNumber", 1))),
        tileX=int(t.get("tileX", 0)),
        tileY=int(t.get("tileY", 0)),
        tileWidth=int(t.get("tileWidth", t.get("width", 0))),
        tileHeight=int(t.get("tileHeight", t.get("height", 0))),
        pageWidth=int(t.get("pageWidth", 0)),
        pageHeight=int(t.get("pageHeight", 0)),
        sourceDpi=int(t.get("sourceDpi", 288)),
        overlap=float(t.get("overlap", 0.0)),
        tileIndex=int(t.get("tileIndex", t.get("index", 0))),
    )


def _err(code: str, message: str, status: int) -> JSONResponse:
    body, _ = error_body(code, message)
    return JSONResponse(status_code=status, content=body)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": PIPELINE_VERSION}


@app.post("/preprocess")
def preprocess_endpoint(body: dict) -> JSONResponse:
    timer = Timer()
    try:
        if "pngBase64" not in body:
            return _err(ERR_INVALID_IMAGE, "missing pngBase64", 400)
        with timer.stage("decode"):
            image = _decode_png(body["pngBase64"])
        with timer.stage("preprocess"):
            layers = preprocess(image)  # legacy default chain
        return JSONResponse({
            "pageWidth": int(image.shape[1]),
            "pageHeight": int(image.shape[0]),
            "layers": {name: {"width": int(m.shape[1]), "height": int(m.shape[0])}
                       for name, m in layers.items()},
            "pipelineVersion": PIPELINE_VERSION,
            "timings": timer.as_dicts(),
        })
    except ValueError as exc:
        msg = str(exc)
        code = msg.split(":")[0] if ":" in msg else ERR_INVALID_IMAGE
        status = 415 if code == ERR_UNSUPPORTED_FORMAT else 400
        return _err(code, msg, status)
    except Exception as exc:  # noqa: BLE001 — structured, never traceback
        return _err(ERR_PROCESSING_FAILURE, f"preprocess failed: {exc}", 500)


def _parse_patterns(body: dict) -> list[TagPattern] | None:
    raw = body.get("tagPatterns")
    if not raw:
        return None
    out: list[TagPattern] = []
    for p in raw:
        if isinstance(p, dict) and p.get("id") and p.get("regex"):
            out.append(TagPattern(str(p["id"]), str(p["regex"])))
    return out or None


@app.post("/candidates")
def candidates_endpoint(body: dict) -> JSONResponse:
    """Full deterministic candidate pass over ONE image (page or tile)."""
    timer = Timer()
    try:
        if "pngBase64" not in body:
            return _err(ERR_INVALID_IMAGE, "missing pngBase64", 400)
        meta = _tile_meta(body)
        with timer.stage("decode"):
            image = _decode_png(body["pngBase64"])
        h, w = image.shape[:2]

        pre_cfg_raw = body.get("preprocess") or {}
        try:
            pre_cfg = PreprocessConfig(**{k: v for k, v in pre_cfg_raw.items()
                                          if k in PreprocessConfig.__dataclass_fields__})
        except (TypeError, ValueError) as exc:
            return _err(ERR_INVALID_IMAGE, f"bad preprocess config: {exc}", 400)
        with timer.stage("preprocess", variant=pre_cfg.variant):
            layers = preprocess_with_config(image, pre_cfg)
            work = layers["work"]

        det_cfg_raw = body.get("detector") or {}
        det_cfg = DetectorConfig(**{k: v for k, v in det_cfg_raw.items()
                                    if k in DetectorConfig.__dataclass_fields__})
        # Phase 10: line splitting is only valid with text masking enabled.
        mask_cfg_raw = body.get("mask", {})
        masking_enabled = mask_cfg_raw is not None and mask_cfg_raw is not False
        line_split_enabled = bool(body.get("lineSplit", False)) and masking_enabled
        reunion_enabled = bool(body.get("reunion", False)) and line_split_enabled
        split_fragments = 0
        reunited_count = 0
        detect_work = work
        if line_split_enabled:
            with timer.stage("line-split"):
                line_mask, _ = long_line_mask(work)
                detect_work = remove_lines(work, line_mask)
                if detect_work.sum() == 0:
                    detect_work = work
        with timer.stage("detect", variant=pre_cfg.variant):
            visual = detect_candidates(
                detect_work, page_number=meta.pageNumber,
                tile_id=meta.tileIndex, cfg=det_cfg,
            )
        if line_split_enabled:
            split_fragments = len(visual)
            if reunion_enabled:
                with timer.stage("reunion"):
                    reunited = reunite_split([c.bbox for c in visual])
                reunited_count = sum(1 for b in reunited if b.get("reunited"))
                visual = visual[:len(reunited)]
                for candidate, box in zip(visual, reunited):
                    candidate.bbox = {k: int(box[k]) for k in ("x", "y", "width", "height")}
                    if box.get("reunited"):
                        candidate.evidence.notes = list(candidate.evidence.notes) + [
                            "line-split reunited"
                        ]
                    candidate.evidence.notes = list(candidate.evidence.notes) + [
                        "line-removed-layer"
                    ]

        # OCR stage — OcrConfig-driven, variant strategy, cached, never fatal.
        # Default provider stays "mock" (Phase 3 compat); production passes
        # provider="tesseract" explicitly via ocrProvider or ocrConfig.
        ocr_cfg = OcrConfig.from_dict(body.get("ocrConfig") or {})
        if body.get("ocrProvider"):
            ocr_cfg.provider = str(body["ocrProvider"])
        elif not (body.get("ocrConfig") or {}).get("provider"):
            ocr_cfg.provider = "mock"
        ocr_boxes: list[OcrBox] = []
        ocr_warning: str | None = None
        variant_attempts: list[dict] = []
        with timer.stage("ocr-init", provider=ocr_cfg.provider):
            try:
                provider = get_provider(ocr_cfg.provider, config=ocr_cfg)
            except ValueError:
                return _err(ERR_INVALID_IMAGE, f"unknown ocrProvider {ocr_cfg.provider!r}", 400)
            provider_version = getattr(provider, "_cmd", None) or ocr_cfg.provider
        if not provider.available:
            # §19: engine unavailable → visual pipeline continues, stage marked.
            ocr_warning = f"OCR provider {ocr_cfg.provider!r} unavailable — text stage skipped"
        else:
            import hashlib as _hl
            with timer.stage("ocr-cache-lookup"):
                ckey = cache_key(
                    image.tobytes(), ocr_cfg.provider, str(provider_version),
                    ocr_cfg.cache_key(), "+".join(ocr_cfg.variants), PIPELINE_VERSION)
                cached = default_cache.get(ckey)
            if cached is not None:
                ocr_boxes, variant_attempts = cached
                warnings_cache = [f"ocr cache hit ({ckey[:12]}…)"]
            else:
                warnings_cache = []
                with timer.stage("ocr-execute"):
                    ocr_boxes, variant_attempts, runner_warnings = run_ocr(
                        image, provider, ocr_cfg, timer)
                    for warn in runner_warnings:
                        ocr_warning = warn if ocr_warning is None else ocr_warning + "; " + warn
                with timer.stage("ocr-cache-store"):
                    default_cache.put(ckey, (ocr_boxes, variant_attempts))
            if warnings_cache:
                ocr_warning = warnings_cache[0] if ocr_warning is None else ocr_warning

        parser = TagParser(_parse_patterns(body))
        known_tags = body.get("knownTags")
        known_set = set(str(x).upper() for x in known_tags) if known_tags else None
        text_cands: list[Candidate] = []
        with timer.stage("ocr-normalize"):
            normalized_items = []
            for ob in ocr_boxes:
                base = base_normalize(ob.text)
                fixed = contextual_correct(base.normalized, parser.matches,
                                           known_tags=known_set)
                transformations = base.transformations + fixed.transformations
                final = fixed.normalized
                tag = parser.parse(final)
                # TagParse.normalized must reflect the corrected form.
                tag.raw = ob.text
                tag.normalized = final
                normalized_items.append((ob, final, transformations, tag))
        with timer.stage("tag-parse"):
            for i, (ob, final, transformations, tag) in enumerate(normalized_items):
                quality = quality_for(ob.text, final, ob.confidence, ob.bbox,
                                      ob.rotation, tag.isTag)
                uses_known = bool(
                    known_set and final in known_set
                    and base_normalize(ob.text).normalized not in (known_set | {final}))
                text_cands.append(
                    Candidate(
                        candidateId=f"p{meta.pageNumber}t{meta.tileIndex}x{i}",
                        pageNumber=meta.pageNumber,
                        tileId=meta.tileIndex,
                        bbox={"x": int(ob.bbox.get("x", 0)), "y": int(ob.bbox.get("y", 0)),
                              "width": int(ob.bbox.get("width", 0)), "height": int(ob.bbox.get("height", 0))},
                        candidateType="text",
                        ocr=OcrResult(text=final, bbox={
                            "x": int(ob.bbox.get("x", 0)), "y": int(ob.bbox.get("y", 0)),
                            "width": int(ob.bbox.get("width", 0)), "height": int(ob.bbox.get("height", 0))},
                            confidence=float(ob.confidence), rotation=int(ob.rotation),
                            provider=ocr_cfg.provider,
                            rawText=ob.text, normalizedText=final,
                            transformations=transformations,
                            quality=quality.to_dict(),
                            correctionReason=(
                                "; ".join(transformations) if transformations else None),
                            knownTagEvidence=(
                                f"corrected form {final} present in project known-tags"
                                if uses_known else None)),
                        tag=tag,
                        source="cv",
                    )
                )

        all_cands = visual + text_cands
        with timer.stage("ocr-dedup"):
            # Tile-local text dedup (page-space merge happens TS-side post tileToPage).
            all_cands = dedup_texts(all_cands)
        with timer.stage("dedup"):
            # Tile-local visual dedup (page-space merge happens in TS after tileToPage).
            merged = deduplicate(all_cands, page_number=meta.pageNumber)

        # Phase 9.1 wiring: text-aware glyph suppression (masking ON by default
        # in this endpoint; pass "mask": null/false to disable for ablation).
        # Operates tile-locally on OCR boxes from the same image — consistent
        # coordinates. Suppressed items reported, never silently dropped.
        suppressed: list = []
        if mask_cfg_raw is not None and mask_cfg_raw is not False:
            with timer.stage("text-mask"):
                mask_cfg = MaskConfig.from_dict(
                    mask_cfg_raw if isinstance(mask_cfg_raw, dict) else {})
                visuals = [c for c in merged if c.candidateType == "visual"]
                others = [c for c in merged if c.candidateType != "visual"]
                kept, suppressed_objs = suppress_glyphs(
                    visuals, [{"bbox": b} for b in
                              [dict(ob.bbox) for ob in ocr_boxes]], mask_cfg)
                suppressed = [s.to_dict() for s in suppressed_objs]
                merged = kept + others

        with timer.stage("associate"):
            # Ranked associations only when this image IS the full page
            # (tile-local coords + page diag would understate distances).
            associations: list[dict] = []
            full_page = (meta.tileX == 0 and meta.tileY == 0
                         and (meta.tileWidth in (0, w)) and (meta.tileHeight in (0, h)))
            if full_page:
                page_geo = {"pageWidth": w, "pageHeight": h}
                syms = [{"id": c.candidateId, "bbox": c.bbox}
                        for c in merged if c.candidateType == "visual"]
                for c in merged:
                    if c.candidateType != "text" or c.tag is None:
                        continue
                    ranked = rank_associations(
                        {"id": c.candidateId, "bbox": c.bbox,
                         "isTag": c.tag.isTag,
                         "tagLike": bool(c.tag.normalized and "-" in c.tag.normalized)},
                        syms, page_geo)
                    associations.append({
                        "textId": c.candidateId,
                        "ranked": [r.to_dict() for r in ranked[:5]],
                    })

        warnings: list[str] = []
        if ocr_warning:
            warnings.append(ocr_warning)

        if artifacts_enabled():
            save_image("work", work, meta.pageNumber, meta.tileIndex)
            save_overlay(image, [c.bbox for c in merged],
                         "candidates", meta.pageNumber, meta.tileIndex)

        resp = CandidatesResponse(
            candidates=[c.to_dict() for c in merged],
            tile={
                "pageNumber": meta.pageNumber, "tileX": meta.tileX, "tileY": meta.tileY,
                "tileWidth": meta.tileWidth or w, "tileHeight": meta.tileHeight or h,
                "pageWidth": meta.pageWidth or w, "pageHeight": meta.pageHeight or h,
                "sourceDpi": meta.sourceDpi, "overlap": meta.overlap,
                "tileIndex": meta.tileIndex,
            },
            timings=timer.as_dicts(),
            warnings=warnings,
        )
        out = resp.to_dict()
        out["ocrVariants"] = variant_attempts
        out["associations"] = associations
        out["ocrCache"] = default_cache.stats()
        out["suppressed"] = suppressed
        out["stageCounts"] = {
            "visual": len([c for c in merged if c.candidateType == "visual"]),
            "ocr": len(text_cands),
            "masked": len(suppressed),
            "splitFragments": split_fragments,
            "reunited": reunited_count,
        }
        return JSONResponse(out)
    except ValueError as exc:
        msg = str(exc)
        code = msg.split(":")[0] if ":" in msg else ERR_INVALID_IMAGE
        status = 415 if code == ERR_UNSUPPORTED_FORMAT else 400
        return _err(code, msg, status)
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"candidates failed: {exc}", 500)


@app.post("/ocr")
def ocr_endpoint(body: dict) -> JSONResponse:
    timer = Timer()
    try:
        if "pngBase64" not in body:
            return _err(ERR_INVALID_IMAGE, "missing pngBase64", 400)
        ocr_cfg = OcrConfig.from_dict(body.get("ocrConfig") or {})
        if body.get("ocrProvider"):
            ocr_cfg.provider = str(body["ocrProvider"])
        elif not (body.get("ocrConfig") or {}).get("provider"):
            ocr_cfg.provider = "mock"
        try:
            provider = get_provider(ocr_cfg.provider, config=ocr_cfg)
        except ValueError:
            return _err(ERR_INVALID_IMAGE, f"unknown ocrProvider {ocr_cfg.provider!r}", 400)
        if not provider.available:
            body_, _ = error_body(ERR_OCR_UNAVAILABLE,
                                  f"OCR provider {ocr_cfg.provider!r} unavailable")
            return JSONResponse(status_code=503, content=body_)
        with timer.stage("decode"):
            image = _decode_png(body["pngBase64"])
        with timer.stage("ocr-init", provider=ocr_cfg.provider):
            pass
        boxes, attempts, warnings = run_ocr(image, provider, ocr_cfg, timer)
        out: dict = {
            "texts": [{"text": b.text, "bbox": b.bbox,
                       "confidence": b.confidence, "rotation": b.rotation} for b in boxes],
            "provider": ocr_cfg.provider,
            "timings": timer.as_dicts(),
            "variants": attempts,
            "warnings": warnings,
            "pipelineVersion": PIPELINE_VERSION,
        }
        return JSONResponse(out)
    except ValueError as exc:
        msg = str(exc)
        code = msg.split(":")[0] if ":" in msg else ERR_INVALID_IMAGE
        status = 415 if code == ERR_UNSUPPORTED_FORMAT else 400
        return _err(code, msg, status)
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"ocr failed: {exc}", 500)


@app.post("/legend/extract")
def legend_extract_endpoint(body: dict) -> JSONResponse:
    """Deterministic Legend definition extraction from rendered legend pages.

    Input pages are PNGs rendered Node-side (mupdf) — no PDF parsing here.
    {legendId, pages:[{pageNumber, pngBase64}], pdfSha256, renderDpi,
     preprocess, ocrConfig, minAssocScore}. Cached by content hash.
    """
    from preprocess import to_grayscale
    timer = Timer()
    try:
        legend_id = str(body.get("legendId", ""))
        pages = body.get("pages") or []
        if not legend_id or not pages:
            return _err(ERR_INVALID_IMAGE, "legendId and pages[] required", 400)
        pdf_sha = str(body.get("pdfSha256", ""))
        render_dpi = int(body.get("renderDpi", 288))
        pre_cfg = PreprocessConfig(**{k: v for k, v in (body.get("preprocess") or {}).items()
                                      if k in PreprocessConfig.__dataclass_fields__})
        ocr_cfg = OcrConfig.from_dict(body.get("ocrConfig") or {})
        if body.get("ocrProvider"):
            ocr_cfg.provider = str(body["ocrProvider"])
        elif not (body.get("ocrConfig") or {}).get("provider"):
            ocr_cfg.provider = "mock"
        min_assoc = float(body.get("minAssocScore", 0.3))

        with timer.stage("legend-cache-lookup"):
            ckey = legend_cache_key(
                pdf_sha.encode(), [p.get("pageNumber", 1) for p in pages],
                render_dpi, str(sorted(pre_cfg.__dict__.items())),
                ocr_cfg.cache_key(), PIPELINE_VERSION, legend_version())
            cached = default_legend_cache.get(ckey)
        if cached is not None:
            cached["legendCache"] = default_legend_cache.stats()
            return JSONResponse(cached)

        try:
            provider = get_provider(ocr_cfg.provider, config=ocr_cfg)
        except ValueError:
            return _err(ERR_INVALID_IMAGE, f"unknown ocrProvider {ocr_cfg.provider!r}", 400)

        definitions: list[dict] = []
        debug: list[dict] = []
        warnings: list[str] = []
        for pg in pages:
            pnum = int(pg.get("pageNumber", 1))
            with timer.stage("decode", page=pnum):
                image = _decode_png(pg.get("pngBase64", ""))
            gray = to_grayscale(image)
            with timer.stage("preprocess", page=pnum):
                layers = preprocess_with_config(image, pre_cfg)
            with timer.stage("detect", page=pnum):
                visual = detect_candidates(layers["work"], page_number=pnum)
            with timer.stage("ocr", page=pnum, provider=ocr_cfg.provider):
                boxes = provider.recognize(image) if provider.available else []
                if not provider.available:
                    warnings.append(f"page {pnum}: OCR unavailable — text stage skipped")
            with timer.stage("associate-extract", page=pnum):
                defs, dbg = extract_definitions(
                    gray, layers["work"], visual, boxes, legend_id,
                    source_page=pnum, min_assoc_score=min_assoc)
            definitions.extend(d.to_dict() for d in defs)
            debug.append({"pageNumber": pnum, "visualCount": len(visual),
                          "ocrCount": len(boxes), "associations": dbg})

        out = {"legendId": legend_id, "definitions": definitions, "debug": debug,
               "timings": timer.as_dicts(), "warnings": warnings,
               "pipelineVersion": PIPELINE_VERSION,
               "extractorVersion": legend_version()}
        with timer.stage("legend-cache-store"):
            default_legend_cache.put(ckey, {**out, "timings": timer.as_dicts()})
        out["legendCache"] = default_legend_cache.stats()
        return JSONResponse(out)
    except ValueError as exc:
        msg = str(exc)
        code = msg.split(":")[0] if ":" in msg else ERR_INVALID_IMAGE
        return _err(code, msg, 415 if code == ERR_UNSUPPORTED_FORMAT else 400)
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"legend extract failed: {exc}", 500)


@app.post("/legend/match")
def legend_match_endpoint(body: dict) -> JSONResponse:
    """Ranked Legend matches for page-space P&ID candidates (evidence only).

    {selectedLegendId, pngBase64, pageNumber, candidates:[{id,bbox}],
     definitions:[LegendDefinition...], config:{...},
     refine:bool (tight-bbox, guarded, default true),
     repair:{}|null (local reconstruction, default on)}.
    Empty definitions → empty matches + warning (matching unavailable,
    detection continues). No Legend is ever invented here.
    """
    from template_extract import TEMPLATE_SIZE, extract_variant
    from preprocess import to_grayscale
    from bbox_refine import refine_tight
    from match_repair import RepairConfig, rematch_with_reconstruction
    timer = Timer()
    try:
        legend_id = str(body.get("selectedLegendId", ""))
        definitions = body.get("definitions") or []
        cands_in = body.get("candidates") or []
        if "pngBase64" not in body:
            return _err(ERR_INVALID_IMAGE, "missing pngBase64", 400)
        if not legend_id:
            return _err(ERR_INVALID_IMAGE, "selectedLegendId required", 400)
        cfg_raw = body.get("config") or {}
        cfg = MatchConfig(**{k: v for k, v in cfg_raw.items()
                             if k in MatchConfig.__dataclass_fields__})
        do_refine = body.get("refine", True)
        repair_cfg = RepairConfig.from_dict(body.get("repair"))
        if body.get("repair") is None:
            repair_cfg.enabled = True
        with timer.stage("decode"):
            image = _decode_png(body["pngBase64"])
        gray = to_grayscale(image)
        H, W = gray.shape[:2]

        results: list[dict] = []
        instr = MatchInstrumentation()
        if not definitions:
            results = [{"candidateId": c.get("id"), "matches": [],
                        "warning": "LEGEND_UNAVAILABLE: no definitions supplied"} for c in cands_in]
        else:
            import time as _t
            neighbor_boxes = [dict(c.get("bbox") or {}) for c in cands_in]
            for c in cands_in:
                t0 = _t.perf_counter()
                b = c.get("bbox") or {}
                qbox = {"x": int(b.get("x", 0)), "y": int(b.get("y", 0)),
                        "width": int(b.get("width", 0)), "height": int(b.get("height", 0))}
                notes: list[str] = []
                if do_refine:
                    with timer.stage("refine"):
                        tight = refine_tight(gray, qbox)
                        if tight is not None:
                            qbox = {k: tight[k] for k in ("x", "y", "width", "height")}
                            notes.append("bbox refined tight")
                with timer.stage("match"):
                    res = rematch_with_reconstruction(
                        gray, qbox, str(c.get("id")), neighbor_boxes,
                        definitions, cfg, repair_cfg, instr)
                    matches = res["selected"]
                # Provenance: every match retains the selected legend.
                for m in matches:
                    m["selectedLegendId"] = legend_id
                results.append({"candidateId": c.get("id"), "matches": matches,
                                "direct": res["direct"],
                                "reconstructed": res["reconstructed"],
                                "matchFrom": res["selectedFrom"],
                                "reconstruction": res["reconstruction"],
                                "queryBox": res["queryBox"],
                                "refineNotes": notes,
                                "queryMs": round((_t.perf_counter() - t0) * 1000.0, 2)})
        return JSONResponse({
            "selectedLegendId": legend_id,
            "results": results,
            "instrumentation": instr.to_dict(),
            "timings": timer.as_dicts(),
            "pipelineVersion": PIPELINE_VERSION,
        })
    except ValueError as exc:
        msg = str(exc)
        code = msg.split(":")[0] if ":" in msg else ERR_INVALID_IMAGE
        return _err(code, msg, 415 if code == ERR_UNSUPPORTED_FORMAT else 400)
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"legend match failed: {exc}", 500)


@app.post("/legend/defs-from-crops")
def legend_defs_from_crops_endpoint(body: dict) -> JSONResponse:
    """Build LegendDefinitions from human-reviewed DB reference crops.

    Input: {legendId, symbols:[{symbolId,label,aliases,category,
             rotationInvariant,cropPngBase64}]}.
    Each crop is treated as ONE template variant (whole-crop bbox).
    Reuses extract_variant — no new algorithm. Preferred over raw PDF
    extract when reviewed crops exist (they carry human-approved labels).
    """
    from template_extract import extract_variant
    from preprocess import to_grayscale
    from legend_model import LegendDefinition, LegendGeometry, LegendVisualFeatures
    timer = Timer()
    try:
        legend_id = str(body.get("legendId", ""))
        symbols = body.get("symbols") or []
        if not legend_id or not symbols:
            return _err(ERR_INVALID_IMAGE, "legendId and symbols[] required", 400)
        definitions: list[dict] = []
        with timer.stage("variants"):
            for i, s in enumerate(symbols):
                b64 = s.get("cropPngBase64", "")
                if not b64:
                    continue
                try:
                    gray = to_grayscale(_decode_png(b64))
                except ValueError:
                    continue
                H, W = gray.shape[:2]
                bbox = {"x": 0, "y": 0, "width": W, "height": H}
                variant = extract_variant(gray, gray, bbox,
                                          variant_id="ref-v1", source="reference-crop")
                area = float(W * H)
                label = str(s.get("label") or s.get("symbolId") or f"symbol-{i}")
                definitions.append(LegendDefinition(
                    legendId=legend_id,
                    symbolId=str(s.get("symbolId") or f"{legend_id}-ref-{i}"),
                    label=label,
                    aliases=list(s.get("aliases") or []),
                    category=str(s.get("category") or ""),
                    bbox=dict(bbox),
                    geometry=LegendGeometry(
                        aspectRatio=variant["aspectRatio"], relativeArea=0.0,
                        width=W, height=H),
                    visualFeatures=LegendVisualFeatures(
                        huMoments=variant["huMoments"],
                        edgeDensity=variant["edgeDensity"],
                        lineCount=variant["lineCount"],
                        componentCount=variant["componentCount"],
                        contourCount=variant["contourCount"]),
                    variants=[variant],
                    sourcePage=int(s.get("sourcePage", 1)),
                    rotationInvariant=bool(s.get("rotationInvariant", False)),
                    provenance=["reference-crop:human-reviewed"],
                ).to_dict())
        return JSONResponse({
            "legendId": legend_id,
            "definitions": definitions,
            "timings": timer.as_dicts(),
            "pipelineVersion": PIPELINE_VERSION,
        })
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"defs-from-crops failed: {exc}", 500)


@app.post("/legend/diagnostics")
def legend_diagnostics_endpoint(body: dict) -> JSONResponse:
    """Stage 2 — quality assessment of existing legend reference crops.

    Input: {legendId, symbols:[{symbolId,label,cropPngBase64,
             pageBBox?, pageNumber?}], pagePngBase64?, pageNumber?}.
    Output: per-reference quality (ink/border/text/whitespace/geometry +
      validated|review|rejected + reasons), duplicate groups, statistics,
      contact-sheet.png + page-overlay.png (base64). Read-only: nothing is
      deleted, overwritten, or grouped into classes here.
    """
    from legend_diagnostics import (
        analyze_crop,
        cluster_duplicates,
        draw_contact_sheet,
        draw_page_overlay,
    )
    from preprocess import to_grayscale
    timer = Timer()
    try:
        legend_id = str(body.get("legendId", ""))
        symbols = body.get("symbols") or []
        if not legend_id or not symbols:
            return _err(ERR_INVALID_IMAGE, "legendId and symbols[] required", 400)
        qualities: list[dict] = []
        thumbs: dict[str, object] = {}
        gray_crops: dict[str, object] = {}
        labels: dict[str, str] = {}
        with timer.stage("analyze"):
            for s in symbols:
                sid = str(s.get("symbolId", ""))
                label = str(s.get("label", ""))
                b64 = s.get("cropPngBase64", "")
                q = analyze_crop(sid, label, b64)
                qualities.append({**q.to_dict(),
                                  "pageNumber": int(s.get("pageNumber", 1)),
                                  "pageBBox": s.get("pageBBox"),
                                  "cropPath": s.get("cropPath")})
                labels[sid] = label
                try:
                    import base64 as _b64
                    import numpy as _np
                    import cv2 as _cv2
                    raw = _b64.b64decode(b64)
                    g = _cv2.imdecode(_np.frombuffer(raw, dtype=_np.uint8),
                                      _cv2.IMREAD_GRAYSCALE)
                    if g is not None:
                        gray_crops[sid] = g
                        thumbs[sid] = g
                except Exception:
                    pass
        with timer.stage("duplicates"):
            groups = cluster_duplicates(
                {k: v for k, v in gray_crops.items()}, labels) \
                if gray_crops else {}
            for q in qualities:
                q["duplicateGroup"] = groups.get(q["symbolId"])
        counts = {"validated": 0, "review": 0, "rejected": 0}
        for q in qualities:
            counts[q["status"]] = counts.get(q["status"], 0) + 1
        uniq_groups = len(set(groups.values())) if groups else 0
        dupe_refs = sum(1 for q in qualities if q["duplicateGroup"]) - uniq_groups \
            if groups else 0
        stats = {
            "totalReferences": len(qualities),
            "validated": counts.get("validated", 0),
            "review": counts.get("review", 0),
            "rejected": counts.get("rejected", 0),
            "uniqueGroups": uniq_groups,
            "duplicateReferences": max(0, dupe_refs),
            "pipelineVersion": PIPELINE_VERSION,
            "legendPipelineVersion": "legend-diag-v1",
        }
        artifacts: dict[str, str | None] = {
            "contactSheetPng": None, "pageOverlayPng": None}
        with timer.stage("artifacts"):
            import base64 as _b64
            import cv2 as _cv2
            items = [{
                "ref": q["symbolId"][:8], "label": q["label"],
                "status": q["status"], "ink": q["inkDensity"],
                "border": q["borderScore"], "text": q["textScore"],
                "group": q["duplicateGroup"] or "-",
                "_thumb": thumbs.get(q["symbolId"]),
            } for q in qualities]
            sheet = draw_contact_sheet([it for it in items
                                        if it["_thumb"] is not None])
            ok, buf = _cv2.imencode(".png", sheet)
            if ok:
                artifacts["contactSheetPng"] = _b64.b64encode(
                    buf.tobytes()).decode()
            page_b64 = body.get("pagePngBase64", "")
            if page_b64:
                try:
                    page = to_grayscale(_decode_png(page_b64))
                    import numpy as _np2
                    page_bgr = _np2.stack([page, page, page], axis=-1)
                    boxes = []
                    for q in qualities:
                        pb = q.get("pageBBox") or {}
                        if pb.get("width") and pb.get("height"):
                            boxes.append({
                                "kind": "REFERENCE",
                                "ref": q["symbolId"][:8],
                                "bbox": pb,
                            })
                            ib = q.get("inkBBox") or {}
                            if ib.get("width") and ib.get("height"):
                                # Ink box is crop-local; map via pageBBox
                                # origin (crop == pageBBox region).
                                boxes.append({
                                    "kind": "SYMBOL",
                                    "ref": q["symbolId"][:8],
                                    "bbox": {
                                        "x": pb["x"] + ib["x"],
                                        "y": pb["y"] + ib["y"],
                                        "width": ib["width"],
                                        "height": ib["height"],
                                    },
                                })
                    over = draw_page_overlay(page_bgr, boxes)
                    ok2, buf2 = _cv2.imencode(".png", over)
                    if ok2:
                        artifacts["pageOverlayPng"] = _b64.b64encode(
                            buf2.tobytes()).decode()
                except Exception:
                    pass
        return JSONResponse({
            "legendId": legend_id,
            "qualities": qualities,
            "statistics": stats,
            "artifacts": artifacts,
            "timings": timer.as_dicts(),
            "pipelineVersion": PIPELINE_VERSION,
        })
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"legend diagnostics failed: {exc}", 500)

@app.post("/legend/label-match")
def legend_label_match_endpoint(body: dict) -> JSONResponse:
    """Deterministic label/alias matching (explicit aliases only)."""
    try:
        query = str(body.get("query", ""))
        definition = body.get("definition") or {}
        if not query or not definition:
            return _err(ERR_INVALID_IMAGE, "query and definition required", 400)
        return JSONResponse({**label_match(query, definition),
                             "pipelineVersion": PIPELINE_VERSION})
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"label match failed: {exc}", 500)


@app.post("/confidence/score")
def confidence_score_endpoint(body: dict) -> JSONResponse:
    """Deterministic confidence from an evidence vector (Phase 6).

    Input: {candidateId, signals{...}, legendMatches[], spatialRanked[],
            ocr{isTag,confidence}|null, config{...}}.
    Output: {candidateId, confidence, decisionBand, topMatch, margin,
             evidence{...all components...}, reasons[], warnings[]}.
    Routing bands only — never a final asset decision. No AI here.
    """
    from timing import Timer as _Timer
    timer = _Timer()
    try:
        candidate_id = str(body.get("candidateId", ""))
        if not candidate_id:
            return _err(ERR_INVALID_IMAGE, "candidateId required", 400)
        cfg = ConfidenceConfig.from_dict(body.get("config") or {})
        with timer.stage("confidence"):
            out = compute_confidence(
                candidate_id,
                signals=dict(body.get("signals") or {}),
                legend_matches=list(body.get("legendMatches") or []),
                spatial_ranked=list(body.get("spatialRanked") or []),
                ocr=body.get("ocr"),
                cfg=cfg,
            )
        result = out.to_dict()
        result["timings"] = timer.as_dicts()
        result["pipelineVersion"] = PIPELINE_VERSION
        return JSONResponse(result)
    except Exception as exc:  # noqa: BLE001
        return _err(ERR_INTERNAL, f"confidence failed: {exc}", 500)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("CV_SERVICE_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
