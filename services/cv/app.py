"""
CV Service — FastAPI entry point.

Routes
------
GET  /health                → HealthResponse
POST /detect                → DetectResponse
POST /ocr                   → OCRResponse
POST /template-match        → TemplateMatchResponse
POST /bbox-refine           → BBoxRefineResponse

Heavy computation modules (cv2, onnxruntime, etc.) are imported lazily inside
each route handler so the worker process starts quickly before models are
warmed up.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

# Allow running as `python app.py` or `uvicorn app:app` from services/cv/
# as well as `from services.cv import app` from the project root.
_THIS_DIR = Path(__file__).parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

# Schemas are lightweight (Pydantic only) — safe to import at module load time.
try:
    from schemas import (
        BBoxRefineRequest,
        BBoxRefineResponse,
        DetectRequest,
        DetectResponse,
        EngineStatus,
        HealthResponse,
        OCRRequest,
        OCRResponse,
        TemplateMatchRequest,
        TemplateMatchResponse,
    )
except ImportError:
    from schemas import (  # type: ignore[no-redef]
        BBoxRefineRequest,
        BBoxRefineResponse,
        DetectRequest,
        DetectResponse,
        EngineStatus,
        HealthResponse,
        OCRRequest,
        OCRResponse,
        TemplateMatchRequest,
        TemplateMatchResponse,
    )

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cv_service")


# ---------------------------------------------------------------------------
# Lifespan: eager model warm-up (non-blocking — failures are logged only)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    """Pre-load the YOLO model at startup so the first request is not slow."""
    try:
        from yolo_detector import try_load

        ok = try_load()
        logger.info(
            "YOLO model warm-up: %s",
            "OK" if ok else "FAILED (will retry on first request)",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("YOLO warm-up skipped: %s", exc)
    yield  # serve requests
    logger.info("CV service shutting down")


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CV Service",
    version="1.0.0",
    description=(
        "Computer-vision micro-service for the Automatic Asset Detection pipeline. "
        "Provides YOLO-based symbol detection, dual-engine OCR, "
        "multi-scale template matching, and bounding-box refinement."
    ),
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Global exception handler — never let unhandled errors expose stack traces
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def _global_exc_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled exception on %s: %s", request.url.path, exc, exc_info=True
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
    )


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse, tags=["ops"])
async def health() -> HealthResponse:
    """
    Return service liveness and availability of each processing engine.

    This endpoint never raises — unavailable engines are reported as ``false``
    so the caller can degrade gracefully.
    """
    # YOLO
    yolo_ok = False
    model_path: str | None = None
    try:
        from yolo_detector import _model_path as mp  # type: ignore[attr-defined]
        from yolo_detector import is_model_loaded, try_load

        yolo_ok = is_model_loaded() or try_load()
        model_path = mp or None
    except Exception as exc:  # noqa: BLE001
        logger.debug("YOLO health check: %s", exc)

    # Tesseract
    tess_ok = False
    try:
        from ocr_runner import tesseract_available

        tess_ok = tesseract_available()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Tesseract health check: %s", exc)

    # EasyOCR
    easy_ok = False
    try:
        from ocr_runner import easyocr_available

        easy_ok = easyocr_available()
    except Exception as exc:  # noqa: BLE001
        logger.debug("EasyOCR health check: %s", exc)

    # OpenCV (just import — no inference)
    cv_ok = False
    try:
        import cv2  # noqa: F401

        cv_ok = True
    except Exception:  # noqa: BLE001
        pass

    return HealthResponse(
        status="ok",
        engines=EngineStatus(
            yolo=yolo_ok,
            ocr_tesseract=tess_ok,
            ocr_easyocr=easy_ok,
            opencv=cv_ok,
        ),
        model_path=model_path,
    )


# ---------------------------------------------------------------------------
# POST /detect — YOLO symbol detection
# ---------------------------------------------------------------------------

@app.post("/detect", response_model=DetectResponse, tags=["detection"])
async def detect(body: DetectRequest) -> DetectResponse:
    """Run YOLO object detection on a base64-encoded page image."""
    from preprocess import decode_b64_image
    from yolo_detector import run_detection

    try:
        img = decode_b64_image(body.image_b64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Image decode failed: {exc}") from exc

    t0 = time.perf_counter()
    try:
        detections = run_detection(
            img,
            confidence_threshold=body.confidence_threshold,
            page_width=body.page_width,
            page_height=body.page_height,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Model unavailable: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("YOLO detection error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Detection failed: {exc}") from exc

    duration_ms = (time.perf_counter() - t0) * 1000.0
    return DetectResponse(detections=detections, duration_ms=duration_ms)


# ---------------------------------------------------------------------------
# POST /ocr — dual-engine OCR
# ---------------------------------------------------------------------------

@app.post("/ocr", response_model=OCRResponse, tags=["ocr"])
async def ocr(body: OCRRequest) -> OCRResponse:
    """Run OCR on a base64-encoded image crop."""
    from preprocess import decode_b64_image
    from ocr_runner import run_ocr

    if body.engine not in ("tesseract", "easyocr", "auto"):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Invalid engine '{body.engine}'. "
                "Valid values: 'tesseract', 'easyocr', 'auto'."
            ),
        )

    try:
        img = decode_b64_image(body.image_b64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Image decode failed: {exc}") from exc

    try:
        text, confidence, engine_used = run_ocr(img, engine=body.engine, lang=body.lang)
    except Exception as exc:  # noqa: BLE001
        logger.error("OCR error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}") from exc

    return OCRResponse(text=text, confidence=confidence, engine_used=engine_used)


# ---------------------------------------------------------------------------
# POST /template-match — multi-scale OpenCV template matching
# ---------------------------------------------------------------------------

@app.post("/template-match", response_model=TemplateMatchResponse, tags=["detection"])
async def template_match_route(body: TemplateMatchRequest) -> TemplateMatchResponse:
    """Find all occurrences of a legend-symbol template inside a P&ID page image."""
    from preprocess import decode_b64_image
    from template_match import run_template_match

    try:
        page_img = decode_b64_image(body.page_b64)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"Page image decode failed: {exc}"
        ) from exc

    try:
        tmpl_img = decode_b64_image(body.template_b64)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"Template image decode failed: {exc}"
        ) from exc

    try:
        matches, duration_ms = run_template_match(
            page_img,
            tmpl_img,
            threshold=body.threshold,
            max_matches=body.max_matches,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Template match error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Template matching failed: {exc}"
        ) from exc

    return TemplateMatchResponse(matches=matches, duration_ms=duration_ms)


# ---------------------------------------------------------------------------
# POST /bbox-refine — contour-based bounding-box refinement
# ---------------------------------------------------------------------------

@app.post("/bbox-refine", response_model=BBoxRefineResponse, tags=["detection"])
async def bbox_refine_route(body: BBoxRefineRequest) -> BBoxRefineResponse:
    """Snap a coarse YOLO bounding box to the nearest symbol contour."""
    from preprocess import decode_b64_image
    from bbox_refine import refine_bbox

    try:
        img = decode_b64_image(body.image_b64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Image decode failed: {exc}") from exc

    try:
        refined_bbox, confidence, method = refine_bbox(
            img,
            body.bbox,
            page_width=body.page_width,
            page_height=body.page_height,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("BBox refinement error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"BBox refinement failed: {exc}"
        ) from exc

    return BBoxRefineResponse(
        refined_bbox=refined_bbox,
        confidence=confidence,
        method=method,
    )


# ---------------------------------------------------------------------------
# POST /embedding — generate 768-dim embedding for pgvector
# ---------------------------------------------------------------------------

@app.post("/embedding", tags=["detection"])
async def generate_embedding(body: dict) -> dict:
    """Generate 768-dimensional embedding for pgvector similarity search."""
    from preprocess import decode_b64_image
    
    try:
        img = decode_b64_image(body.get("image_b64", ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Image decode failed: {exc}") from exc
    
    try:
        # Use CLIP model for embedding generation (768-dim)
        import clip
        import torch
        from PIL import Image
        import io
        import numpy as np
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, preprocess = clip.load("ViT-B/32", device=device)
        
        # Convert numpy array to PIL Image
        pil_img = Image.fromarray(img)
        image_input = preprocess(pil_img).unsqueeze(0).to(device)
        
        with torch.no_grad():
            image_features = model.encode_image(image_input)
            # Normalize to unit vector
            image_features /= image_features.norm(dim=-1, keepdim=True)
            embedding = image_features.cpu().numpy().flatten().tolist()
        
        return {
            "embedding": embedding,
            "dimension": len(embedding)
        }
    except ImportError:
        # Fallback: return zero vector if CLIP not installed
        logger.warning("CLIP model not available, returning zero embedding")
        return {
            "embedding": [0.0] * 768,
            "dimension": 768,
            "warning": "CLIP not installed, using zero vector"
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Embedding generation error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Embedding generation failed: {exc}"
        ) from exc


# ---------------------------------------------------------------------------
# POST /yolo-tiled — YOLO detection with tiling and multi-scale
# ---------------------------------------------------------------------------

@app.post("/yolo-tiled", tags=["detection"])
async def yolo_tiled_detection(body: dict) -> dict:
    """
    Run YOLO detection with tiling and multi-scale zoom.
    
    Request body:
    {
        "image_b64": "base64 image",
        "tile_size": 1024,
        "overlap": 0.2,
        "scales": [1.0, 1.5, 2.0],
        "confidence_threshold": 0.3
    }
    """
    from preprocess import decode_b64_image
    from yolo_detector import run_detection
    import cv2
    import numpy as np
    
    try:
        img = decode_b64_image(body.get("image_b64", ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Image decode failed: {exc}") from exc
    
    tile_size = body.get("tile_size", 1024)
    overlap = body.get("overlap", 0.2)
    scales = body.get("scales", [1.0, 1.5, 2.0])
    conf_threshold = body.get("confidence_threshold", 0.3)
    
    all_detections = []
    
    try:
        for scale in scales:
            if scale != 1.0:
                scaled_width = int(img.shape[1] * scale)
                scaled_height = int(img.shape[0] * scale)
                scaled_img = cv2.resize(img, (scaled_width, scaled_height))
            else:
                scaled_img = img
            
            h, w = scaled_img.shape[:2]
            stride = int(tile_size * (1 - overlap))
            
            for y in range(0, h, stride):
                for x in range(0, w, stride):
                    # Extract tile
                    tile_x_end = min(x + tile_size, w)
                    tile_y_end = min(y + tile_size, h)
                    tile = scaled_img[y:tile_y_end, x:tile_x_end]
                    
                    # Run detection on tile
                    tile_detections = run_detection(
                        tile,
                        confidence_threshold=conf_threshold,
                        page_width=tile.shape[1],
                        page_height=tile.shape[0]
                    )
                    
                    # Map coordinates back to original image
                    for det in tile_detections:
                        bbox = det.bbox
                        all_detections.append({
                            "class_id": det.class_id,
                            "label": det.label,
                            "score": det.score,
                            "bbox": {
                                "x": (bbox.x + x) / scale,
                                "y": (bbox.y + y) / scale,
                                "width": bbox.width / scale,
                                "height": bbox.height / scale
                            },
                            "scale": scale,
                            "tile": f"x{x}_y{y}_s{scale}"
                        })
        
        # Apply NMS across all scales
        if all_detections:
            # Simple NMS implementation
            boxes = np.array([[d["bbox"]["x"], d["bbox"]["y"], 
                              d["bbox"]["x"] + d["bbox"]["width"],
                              d["bbox"]["y"] + d["bbox"]["height"]] for d in all_detections])
            scores = np.array([d["score"] for d in all_detections])
            
            # Keep track of which boxes to keep
            keep_indices = []
            indices = np.argsort(scores)[::-1]
            
            while len(indices) > 0:
                current = indices[0]
                keep_indices.append(current)
                
                if len(indices) == 1:
                    break
                
                # Compute IoU with remaining boxes
                current_box = boxes[current]
                remaining_boxes = boxes[indices[1:]]
                
                x1 = np.maximum(current_box[0], remaining_boxes[:, 0])
                y1 = np.maximum(current_box[1], remaining_boxes[:, 1])
                x2 = np.minimum(current_box[2], remaining_boxes[:, 2])
                y2 = np.minimum(current_box[3], remaining_boxes[:, 3])
                
                intersection = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
                
                area_current = (current_box[2] - current_box[0]) * (current_box[3] - current_box[1])
                area_remaining = (remaining_boxes[:, 2] - remaining_boxes[:, 0]) * \
                                (remaining_boxes[:, 3] - remaining_boxes[:, 1])
                
                union = area_current + area_remaining - intersection
                iou = intersection / (union + 1e-6)
                
                # Keep boxes with IoU < 0.5
                indices = indices[1:][iou < 0.5]
            
            all_detections = [all_detections[i] for i in keep_indices]
        
        return {
            "detections": all_detections,
            "total_detections": len(all_detections),
            "scales_used": scales,
            "tile_size": tile_size
        }
        
    except Exception as exc:  # noqa: BLE001
        logger.error("Tiled YOLO detection error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Tiled detection failed: {exc}"
        ) from exc


# ---------------------------------------------------------------------------
# Dev entry point: python -m services.cv.app
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "services.cv.app:app",
        host=os.environ.get("CV_HOST", "0.0.0.0"),
        port=int(os.environ.get("CV_PORT", "8001")),
        reload=os.environ.get("CV_RELOAD", "0") == "1",
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )
