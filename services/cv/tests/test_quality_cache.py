from ocr_cache import OcrCache, cache_key
from ocr_quality import levenshtein, quality_for


def test_levenshtein_sanity():
    assert levenshtein("P-10LA", "P-101A") == 1
    assert levenshtein("abc", "abc") == 0
    assert levenshtein("", "P-1") == 3


def test_quality_features_cover_spec():
    q = quality_for("P-10lA", "P-101A", 0.82,
                    {"x": 10, "y": 20, "width": 60, "height": 22}, 0, True)
    d = q.to_dict()
    assert d["charCount"] == 6
    assert d["tagPatternMatch"] is True
    assert d["normalizationDistance"] == 1  # single l→1 substitution
    assert d["bboxArea"] == 60 * 22
    assert d["alphanumericRatio"] > 0.8


def test_cache_key_changes_with_dpi_and_config():
    img = b"fake-bytes"
    a = cache_key(img, "tesseract", "v5", "cfgA", "adaptive_binary", "v2.0.0")
    assert a != cache_key(b"other", "tesseract", "v5", "cfgA", "adaptive_binary", "v2.0.0")
    assert a != cache_key(img, "tesseract", "v5", "cfgB", "adaptive_binary", "v2.0.0")
    assert a != cache_key(img, "tesseract", "v5", "cfgA", "binary", "v2.0.0")
    # Same page number is NOT part of the key — bytes+config decide.
    assert a == cache_key(img, "tesseract", "v5", "cfgA", "adaptive_binary", "v2.0.0")


def test_cache_lru_and_stats():
    c = OcrCache(capacity=2)
    c.put("k1", [1])
    c.put("k2", [2])
    assert c.get("k1") == [1]
    c.put("k3", [3])  # evicts k2
    assert c.get("k2") is None
    s = c.stats()
    assert s["hits"] == 1 and s["misses"] == 1
    assert s["hitRate"] == 0.5
