"""
Dual-engine OCR runner: Tesseract (primary) + EasyOCR (fallback/parallel).

Environment variables
---------------------
TESSERACT_CMD        Full path to the Tesseract binary.
                     Default: C:\\Program Files\\Tesseract-OCR\\tesseract.exe
CV_EASYOCR_GPU       Set to '1' to enable GPU for EasyOCR.  Default: '0'
CV_OCR_MIN_CHARS     Discard OCR results shorter than this.  Default: 2
"""
from __future__ import annotations

import logging
import os
import re
import unicodedata
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TESSERACT_CMD: str = os.environ.get(
    "TESSERACT_CMD",
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
)
_MIN_CHARS: int = int(os.environ.get("CV_OCR_MIN_CHARS", "2"))
_PUNCTUATION_ONLY = re.compile(r"^[\W_]+$", re.UNICODE)


# ---------------------------------------------------------------------------
# Text normalisation helpers
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """Strip surrounding whitespace, collapse internal whitespace, uppercase."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text).strip().upper()
    return text


def _is_noise(text: str) -> bool:
    """Return True if the text is too short or purely punctuation/symbols."""
    if len(text) < _MIN_CHARS:
        return True
    if _PUNCTUATION_ONLY.match(text):
        return True
    return False


# ---------------------------------------------------------------------------
# Tesseract engine
# ---------------------------------------------------------------------------

def _run_tesseract(
    img,
    *,
    lang: str = "eng",
    psm: int = 7,
) -> Tuple[str, float]:
    """
    Run pytesseract on *img* (NumPy array BGR or grayscale).

    Returns
    -------
    (text, confidence)
        confidence is 0.0–1.0.  Returns ('', 0.0) on any failure.
    """
    try:
        import pytesseract

        pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

        config = f"--oem 3 --psm {psm}"
        data = pytesseract.image_to_data(
            img,
            lang=lang,
            config=config,
            output_type=pytesseract.Output.DICT,
        )
        words = []
        confs: list[float] = []
        for word, conf in zip(data["text"], data["conf"]):
            if isinstance(conf, (int, float)) and conf > 0 and word.strip():
                words.append(word.strip())
                confs.append(float(conf) / 100.0)

        if not words:
            return "", 0.0

        text = " ".join(words)
        avg_conf = sum(confs) / len(confs)
        return text, avg_conf

    except Exception as exc:  # noqa: BLE001
        logger.debug("Tesseract error: %s", exc)
        return "", 0.0


# ---------------------------------------------------------------------------
# EasyOCR engine
# ---------------------------------------------------------------------------

_easyocr_reader = None


def _get_easyocr_reader(lang: str = "en"):
    """Lazy singleton EasyOCR Reader."""
    global _easyocr_reader  # noqa: PLW0603

    # Cache key includes lang; create new reader only on lang change
    cache_lang = getattr(_easyocr_reader, "_lang_key", None)
    if _easyocr_reader is not None and cache_lang == lang:
        return _easyocr_reader

    try:
        import easyocr

        gpu = os.environ.get("CV_EASYOCR_GPU", "0") == "1"
        # EasyOCR uses 'en' not 'eng'
        easyocr_lang = lang[:2] if lang else "en"
        logger.info("Initialising EasyOCR reader (lang=%s, gpu=%s)", easyocr_lang, gpu)
        reader = easyocr.Reader([easyocr_lang], gpu=gpu, verbose=False)
        reader._lang_key = lang  # type: ignore[attr-defined]
        _easyocr_reader = reader
        return _easyocr_reader

    except Exception as exc:  # noqa: BLE001
        logger.error("EasyOCR reader init failed: %s", exc)
        return None


def _run_easyocr(
    img,
    *,
    lang: str = "eng",
) -> Tuple[str, float]:
    """
    Run EasyOCR on *img*.

    Returns
    -------
    (text, confidence)  — confidence 0.0–1.0.
    """
    try:
        reader = _get_easyocr_reader(lang)
        if reader is None:
            return "", 0.0

        results = reader.readtext(img, detail=1, paragraph=False)
        if not results:
            return "", 0.0

        words = []
        confs: list[float] = []
        for (_bbox, word, conf) in results:
            if word.strip() and conf > 0:
                words.append(word.strip())
                confs.append(float(conf))

        if not words:
            return "", 0.0

        text = " ".join(words)
        avg_conf = sum(confs) / len(confs)
        return text, avg_conf

    except Exception as exc:  # noqa: BLE001
        logger.debug("EasyOCR error: %s", exc)
        return "", 0.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_ocr(
    img,
    *,
    engine: str = "auto",
    lang: str = "eng",
) -> Tuple[str, float, str]:
    """
    Run OCR on *img* (BGR or grayscale NumPy uint8 array).

    Parameters
    ----------
    img :
        Image to recognise.
    engine :
        ``'tesseract'``  — Tesseract only.
        ``'easyocr'``    — EasyOCR only.
        ``'auto'``       — run both, return higher-confidence result.
    lang :
        Language hint (ISO 639-2 for Tesseract, e.g. ``'eng'``; EasyOCR
        receives the first two characters, e.g. ``'en'``).

    Returns
    -------
    (text, confidence, engine_used)
    """
    engine = engine.lower().strip()

    if engine == "tesseract":
        text, conf = _run_tesseract(img, lang=lang)
        engine_used = "tesseract"

    elif engine == "easyocr":
        text, conf = _run_easyocr(img, lang=lang)
        engine_used = "easyocr"

    else:  # auto
        tess_text, tess_conf = _run_tesseract(img, lang=lang, psm=7)
        easy_text, easy_conf = _run_easyocr(img, lang=lang)

        if easy_conf >= tess_conf:
            text, conf, engine_used = easy_text, easy_conf, "easyocr"
        else:
            text, conf, engine_used = tess_text, tess_conf, "tesseract"

    # Post-process
    text = _normalize(text)
    if _is_noise(text):
        text = ""
        conf = 0.0

    return text, conf, engine_used


def run_ocr_multiline(
    img,
    *,
    engine: str = "auto",
    lang: str = "eng",
) -> Tuple[str, float, str]:
    """
    Like :func:`run_ocr` but uses PSM 6 (block of text) for Tesseract,
    better suited for multi-line labels.
    """
    engine = engine.lower().strip()

    if engine == "tesseract":
        text, conf = _run_tesseract(img, lang=lang, psm=6)
        engine_used = "tesseract"

    elif engine == "easyocr":
        text, conf = _run_easyocr(img, lang=lang)
        engine_used = "easyocr"

    else:  # auto
        tess_text, tess_conf = _run_tesseract(img, lang=lang, psm=6)
        easy_text, easy_conf = _run_easyocr(img, lang=lang)

        if easy_conf >= tess_conf:
            text, conf, engine_used = easy_text, easy_conf, "easyocr"
        else:
            text, conf, engine_used = tess_text, tess_conf, "tesseract"

    text = _normalize(text)
    if _is_noise(text):
        text = ""
        conf = 0.0

    return text, conf, engine_used


def tesseract_available() -> bool:
    """Return ``True`` if Tesseract binary can be found and executed."""
    try:
        import pytesseract

        pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def easyocr_available() -> bool:
    """Return ``True`` if EasyOCR can be imported and initialised."""
    return _get_easyocr_reader("eng") is not None
