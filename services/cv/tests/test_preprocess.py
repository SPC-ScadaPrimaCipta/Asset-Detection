import numpy as np
import pytest

from fixtures import blank, noisy_scan
from preprocess import (
    PreprocessConfig,
    adaptive_binarize,
    denoise,
    global_binarize,
    normalize_contrast,
    preprocess,
    preprocess_with_config,
    to_grayscale,
)


def test_valid_image_produces_all_layers():
    layers = preprocess(blank())
    assert set(layers) == {"grayscale", "normalized", "binary", "denoised"}
    for m in layers.values():
        assert m.shape == (480, 640)


def test_grayscale_collapses_channels():
    assert to_grayscale(blank()).ndim == 2


def test_binary_variants_are_binary():
    gray = to_grayscale(blank())
    for m in (global_binarize(gray), adaptive_binarize(gray)):
        assert set(np.unique(m)).issubset({0, 255})


def test_noisy_scan_still_processes():
    layers = preprocess(noisy_scan())
    assert layers["denoised"].shape == (480, 640)


def test_config_variants_select_work_image():
    img = blank()
    for variant in ("adaptive_binary", "binary", "grayscale"):
        out = preprocess_with_config(img, PreprocessConfig(variant=variant))
        assert out["variant"] == variant
        assert out["work"].shape[:2] == (480, 640)


def test_unknown_variant_rejected():
    with pytest.raises(ValueError):
        PreprocessConfig(variant="median_cut")


def test_contrast_can_be_disabled():
    out = preprocess_with_config(blank(), PreprocessConfig(clahe_clip=0))
    assert out["work"].shape[:2] == (480, 640)


def test_denoise_removes_speckle():
    rng = np.random.default_rng(1)
    binary = np.zeros((100, 100), dtype=np.uint8)
    for _ in range(40):
        binary[int(rng.integers(0, 100)), int(rng.integers(0, 100))] = 255
    assert denoise(binary).sum() <= binary.sum()
