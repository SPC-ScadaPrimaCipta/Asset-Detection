"""pytest bootstrap: service modules importable without install."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _clear_ocr_cache():
    """Process-wide OCR cache must not leak between tests (mock fixtures
    are per-test, so a cached empty result would poison later tests)."""
    from ocr_cache import default_cache
    default_cache._mem.clear()
    default_cache.hits = 0
    default_cache.misses = 0
    yield
    default_cache._mem.clear()

