"""
Detection V2 — canonical Legend reference model (Python side).

TS mirror: lib/detection/legend/legend-model.ts (identical JSON keys).

A definition preserves the ORIGINAL Legend label verbatim — label is NOT
an asset type. Classification happens later (Phase 6+); Phase 5 only
produces ranked match evidence.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field


def legend_version() -> str:
    return os.environ.get("LEGEND_EXTRACT_VERSION", "legend-v1")


@dataclass
class LegendGeometry:
    aspectRatio: float = 0.0
    relativeArea: float = 0.0  # bbox area / legend page area
    width: int = 0
    height: int = 0


@dataclass
class LegendVisualFeatures:
    huMoments: list = field(default_factory=list)  # log-scaled Hu (7)
    edgeDensity: float = 0.0
    lineCount: int = 0
    componentCount: int = 0
    contourCount: int = 0
    templateSize: list = field(default_factory=lambda: [128, 128])


@dataclass
class LegendTemplateVariant:
    variantId: str = ""
    bbox: dict = field(default_factory=dict)  # legend page pixels
    aspectRatio: float = 0.0
    area: float = 0.0
    normalizedPng: str = ""  # base64 grayscale 128px, longest side
    huMoments: list = field(default_factory=list)
    edgeDensity: float = 0.0
    lineCount: int = 0
    source: str = "extract"  # extract | manual | builtin


@dataclass
class LegendDefinition:
    legendId: str = ""
    symbolId: str = ""
    label: str = ""                       # ORIGINAL legend label, verbatim
    aliases: list = field(default_factory=list)  # explicit/configurable only
    category: str = ""
    bbox: dict = field(default_factory=dict)
    geometry: LegendGeometry = field(default_factory=LegendGeometry)
    visualFeatures: LegendVisualFeatures = field(default_factory=LegendVisualFeatures)
    variants: list = field(default_factory=list)  # list[LegendTemplateVariant dict]
    sourcePage: int = 1
    rotationInvariant: bool = False
    provenance: list = field(default_factory=list)
    version: str = ""

    def __post_init__(self) -> None:
        if not self.version:
            self.version = legend_version()

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(raw: dict) -> "LegendDefinition":
        geo = LegendGeometry(**(raw.get("geometry") or {}))
        vis = LegendVisualFeatures(**(raw.get("visualFeatures") or {}))
        return LegendDefinition(
            legendId=str(raw.get("legendId", "")),
            symbolId=str(raw.get("symbolId", "")),
            label=str(raw.get("label", "")),
            aliases=list(raw.get("aliases") or []),
            category=str(raw.get("category", "")),
            bbox=dict(raw.get("bbox") or {}),
            geometry=geo,
            visualFeatures=vis,
            variants=list(raw.get("variants") or []),
            sourcePage=int(raw.get("sourcePage", 1)),
            rotationInvariant=bool(raw.get("rotationInvariant", False)),
            provenance=list(raw.get("provenance") or []),
            version=str(raw.get("version", legend_version())),
        )
