"""
Detection V2 — shared candidate output contract (Python side).

TypeScript mirror: lib/detection/candidates/schema.ts
Single source of version truth: PIPELINE_VERSION env (Phase 1 config).
Python reads the same env var; TS sends its version per request and the
service echoes the version it actually used.

Coordinates: tile-LOCAL pixels on the wire for per-tile responses.
The TypeScript side maps them to canonical page pixels via tileToPage —
coordinate formulas live ONLY in TS (coordinate-transform.ts).
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any, Optional


def pipeline_version() -> str:
    return os.environ.get("PIPELINE_VERSION", "v2.0.0")


@dataclass
class TileMeta:
    pageNumber: int = 1
    tileX: int = 0
    tileY: int = 0
    tileWidth: int = 0
    tileHeight: int = 0
    pageWidth: int = 0
    pageHeight: int = 0
    sourceDpi: int = 288
    overlap: float = 0.0
    tileIndex: int = 0


@dataclass
class CandidateGeometry:
    area: float = 0.0
    aspectRatio: float = 0.0
    centerX: float = 0.0
    centerY: float = 0.0
    perimeter: float = 0.0
    circularity: float = 0.0
    convexity: float = 0.0


@dataclass
class CandidateEvidence:
    contourArea: float = 0.0
    connectedComponentArea: float = 0.0
    lineCount: int = 0
    textProximity: Optional[float] = None
    sourceTiles: list = field(default_factory=list)
    notes: list = field(default_factory=list)


@dataclass
class OcrResult:
    text: str = ""
    bbox: dict = field(default_factory=dict)  # tile-local {x,y,width,height}
    confidence: float = 0.0
    rotation: int = 0
    provider: str = "mock"
    # Phase 4: auditable normalization (raw preserved, never silently rewritten).
    rawText: str = ""
    normalizedText: str = ""
    transformations: list = field(default_factory=list)
    quality: dict = field(default_factory=dict)
    # Phase 5 §15: auditable correction context.
    correctionReason: Optional[str] = None
    knownTagEvidence: Optional[str] = None


@dataclass
class TagParse:
    raw: str = ""
    normalized: str = ""
    isTag: bool = False
    prefix: Optional[str] = None
    number: Optional[str] = None
    suffix: Optional[str] = None
    patternId: Optional[str] = None
    # Compound identifiers split into components (PSV-PDT-11 → [PSV, PDT]).
    # Informational only — a prefix does NOT imply an asset type.
    components: list = field(default_factory=list)


@dataclass
class Candidate:
    candidateId: str = ""
    pageNumber: int = 1
    tileId: Optional[int] = None
    # Tile-LOCAL bbox {x,y,width,height} — TS maps to page via tileToPage.
    bbox: dict = field(default_factory=dict)
    candidateType: str = "visual"  # visual | text | merged
    geometry: CandidateGeometry = field(default_factory=CandidateGeometry)
    evidence: CandidateEvidence = field(default_factory=CandidateEvidence)
    ocr: Optional[OcrResult] = None
    tag: Optional[TagParse] = None
    source: str = "cv"
    provenance: list = field(default_factory=list)
    pipelineVersion: str = ""
    # Evaluation-only hook (Fase 8). NEVER consumed by production logic.
    groundTruthId: Optional[str] = None
    matchStatus: Optional[str] = None  # TP | FP | FN | UNMATCHED | None

    def __post_init__(self) -> None:
        if not self.pipelineVersion:
            self.pipelineVersion = pipeline_version()

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StageTiming:
    name: str = ""
    ms: float = 0.0
    detail: dict = field(default_factory=dict)


@dataclass
class CandidatesResponse:
    candidates: list = field(default_factory=list)  # list[dict]
    tile: Optional[dict] = None
    timings: list = field(default_factory=list)  # list[dict StageTiming]
    pipelineVersion: str = ""
    warnings: list = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.pipelineVersion:
            self.pipelineVersion = pipeline_version()

    def to_dict(self) -> dict:
        return asdict(self)


def error_body(code: str, message: str, status: int = 400) -> tuple:
    """Structured error (code, message, pipelineVersion) + HTTP status."""
    return (
        {"error": code, "message": message, "pipelineVersion": pipeline_version()},
        status,
    )


# Stable error codes (see app.py handlers).
ERR_INVALID_IMAGE = "INVALID_IMAGE"
ERR_PROCESSING_FAILURE = "PROCESSING_FAILURE"
ERR_UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
ERR_OCR_UNAVAILABLE = "OCR_UNAVAILABLE"
ERR_INTERNAL = "INTERNAL_ERROR"
