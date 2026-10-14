"""
Pydantic v2 schemas for all CV service request/response types.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field
from pydantic import ConfigDict


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------

class BBox(BaseModel):
    """Axis-aligned bounding box in pixel coordinates (top-left origin)."""

    model_config = ConfigDict(extra='forbid')

    x: float = Field(..., description="Left edge in pixels")
    y: float = Field(..., description="Top edge in pixels")
    width: float = Field(..., ge=0, description="Width in pixels")
    height: float = Field(..., ge=0, description="Height in pixels")


# ---------------------------------------------------------------------------
# YOLO detection
# ---------------------------------------------------------------------------

class DetectRequest(BaseModel):
    """Request to run YOLO object detection on a page image."""

    image_b64: str = Field(..., description="Base64-encoded PNG image")
    page_width: int = Field(..., gt=0)
    page_height: int = Field(..., gt=0)
    confidence_threshold: float = Field(0.3, ge=0.0, le=1.0)


class Detection(BaseModel):
    """Single detected object."""

    class_id: int
    label: str
    score: float = Field(..., ge=0.0, le=1.0)
    bbox: BBox  # pixel coordinates in the original page space


class DetectResponse(BaseModel):
    detections: List[Detection]
    duration_ms: float


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------

class OCRRequest(BaseModel):
    """Request to run OCR on a cropped image region."""

    image_b64: str = Field(..., description="Base64-encoded PNG crop")
    engine: str = Field(
        "auto",
        description="OCR engine: 'tesseract', 'easyocr', or 'auto'",
    )
    lang: str = Field("eng", description="Language hint for Tesseract / EasyOCR")


class OCRResponse(BaseModel):
    text: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    engine_used: str


# ---------------------------------------------------------------------------
# Template matching
# ---------------------------------------------------------------------------

class TemplateMatchRequest(BaseModel):
    """Match a small legend-symbol template against a full page image."""

    page_b64: str = Field(..., description="Base64-encoded PNG full page")
    template_b64: str = Field(..., description="Base64-encoded PNG template crop")
    threshold: float = Field(0.7, ge=0.0, le=1.0)
    max_matches: int = Field(20, ge=1, le=200)


class TemplateMatch(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    bbox: BBox


class TemplateMatchResponse(BaseModel):
    matches: List[TemplateMatch]
    duration_ms: float


# ---------------------------------------------------------------------------
# BBox refinement
# ---------------------------------------------------------------------------

class BBoxRefineRequest(BaseModel):
    """Refine a coarse bounding box using contour detection."""

    image_b64: str = Field(..., description="Base64-encoded PNG full page")
    bbox: BBox = Field(..., description="Initial bounding box in pixels")
    page_width: int = Field(..., gt=0)
    page_height: int = Field(..., gt=0)


class BBoxRefineResponse(BaseModel):
    refined_bbox: BBox
    confidence: float = Field(..., ge=0.0, le=1.0)
    method: str = Field(..., description="Refinement method used, e.g. 'contour' or 'original'")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class EngineStatus(BaseModel):
    yolo: bool
    ocr_tesseract: bool
    ocr_easyocr: bool
    opencv: bool


class HealthResponse(BaseModel):
    status: str
    engines: EngineStatus
    model_path: Optional[str] = None
