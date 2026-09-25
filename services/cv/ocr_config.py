"""
Detection V2 — centralized OCR configuration (single object, not env sprawl).

Only host-level overrides live in env: TESSERACT_CMD, OCR_PROVIDER.
Everything else travels in OcrConfig (defaults here, overridable per
request from TypeScript). No asset logic, no classification.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class OcrConfig:
    # Default "mock" preserves Phase 3 behavior (deterministic, no binaries).
    # Production callers pass provider="tesseract" explicitly per request.
    provider: str = "mock"            # tesseract | mock
    language: str = "eng"
    psm: int = 6                      # assume uniform text block (tile/page crop)
    oem: int = 1                      # LSTM only
    # Variant strategy: ordered list; "auto" runs primary, retries secondary
    # ONLY when primary yields no usable text (never blindly all variants).
    variants: list = field(default_factory=lambda: ["adaptive_binary"])
    min_confidence: float = 0.0       # do NOT discard low-conf early (§1)
    whitelist: str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/(). "
    timeout_sec: int = 30
    max_image_dim: int = 4000         # downscale larger inputs (keeps tesseract fast)
    fallback_psm: int = 11            # sparse text retry when primary finds nothing

    @staticmethod
    def from_dict(raw: dict | None) -> "OcrConfig":
        raw = raw or {}
        base = OcrConfig()
        fields = set(OcrConfig.__dataclass_fields__)
        kw = {k: v for k, v in raw.items() if k in fields}
        if "variants" in kw and isinstance(kw["variants"], str):
            kw["variants"] = [kw["variants"]]
        try:
            return OcrConfig(**{**base.__dict__, **kw})
        except TypeError:
            return base

    def cache_key(self) -> str:
        return (
            f"{self.provider}|{self.language}|psm{self.psm}|oem{self.oem}|"
            f"var{'+'.join(self.variants)}|min{self.min_confidence}|"
            f"wl{hash(self.whitelist) & 0xFFFFFFFF}|t{self.timeout_sec}|"
            f"max{self.max_image_dim}|fb{self.fallback_psm}"
        )


def default_provider_name() -> str:
    return os.environ.get("OCR_PROVIDER", "tesseract")


def tesseract_cmd() -> str | None:
    """Locate binary: explicit env → PATH → Windows default install path."""
    from shutil import which

    env = os.environ.get("TESSERACT_CMD")
    if env and os.path.exists(env):
        return env
    found = which("tesseract")
    if found:
        return found
    win_default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(win_default):
        return win_default
    return None
