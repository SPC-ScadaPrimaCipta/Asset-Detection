#!/usr/bin/env python3
"""
Export Python Preprocessing Diagnostic Artifacts for YOLO v203

Exports intermediate preprocessing buffers and raw ONNX model outputs
for the resized non-square fixture (1600x1001) for bit-level comparative diagnostics.

Output directory: fixtures/diagnostics/python/
Artifacts:
  - decoded_rgb_uint8.bin          [1001, 1600, 3] uint8
  - resized_rgb_uint8.bin          [641, 1024, 3] uint8
  - final_tensor_float32_nchw.bin  [1, 3, 1024, 1024] float32
  - raw_output_float32.bin         [1, 207, 21504] float32
  - manifest.json
"""

import datetime
import hashlib
import json
import os
import platform
import sys

import cv2
import numpy as np
import onnxruntime as ort

MODEL_PATH = "model/yolo-pid-v8n-203.onnx"
FIXTURE_PATH = "fixtures/Sheet_1-1__crop_1600x1001.png"
OUTPUT_DIR = "fixtures/diagnostics/python"


def compute_sha256(buf: bytes) -> str:
    return hashlib.sha256(buf).hexdigest()


def compute_file_sha256(file_path: str) -> str:
    with open(file_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    print("🔬 Running Python Preprocessing Diagnostics Exporter...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(FIXTURE_PATH):
        print(f"❌ Fixture not found: {FIXTURE_PATH}")
        sys.exit(1)
    if not os.path.exists(MODEL_PATH):
        print(f"❌ Model not found: {MODEL_PATH}")
        sys.exit(1)

    model_file_sha = compute_file_sha256(MODEL_PATH)
    fixture_file_sha = compute_file_sha256(FIXTURE_PATH)

    # 1. Decode image (BGR to RGB)
    img_bgr = cv2.imread(FIXTURE_PATH)
    if img_bgr is None:
        raise ValueError(f"cv2.imread failed on {FIXTURE_PATH}")
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    orig_h, orig_w = img_rgb.shape[:2]

    decoded_bytes = img_rgb.tobytes()
    decoded_sha = compute_sha256(decoded_bytes)
    decoded_path = os.path.join(OUTPUT_DIR, "decoded_rgb_uint8.bin")
    with open(decoded_path, "wb") as f:
        f.write(decoded_bytes)

    # 2. Resize
    target_size = 1024
    scale = min(target_size / orig_w, target_size / orig_h)
    scaled_w = int(round(orig_w * scale))
    scaled_h = int(round(orig_h * scale))

    resized_rgb = cv2.resize(img_rgb, (scaled_w, scaled_h), interpolation=cv2.INTER_LINEAR)
    resized_bytes = resized_rgb.tobytes()
    resized_sha = compute_sha256(resized_bytes)
    resized_path = os.path.join(OUTPUT_DIR, "resized_rgb_uint8.bin")
    with open(resized_path, "wb") as f:
        f.write(resized_bytes)

    # 3. Canvas Letterbox & Normalization
    pad_x = (target_size - scaled_w) // 2
    pad_y = (target_size - scaled_h) // 2
    bottom_pad = target_size - scaled_h - pad_y
    right_pad = target_size - scaled_w - pad_x

    canvas = np.full((target_size, target_size, 3), 114, dtype=np.uint8)
    canvas[pad_y : pad_y + scaled_h, pad_x : pad_x + scaled_w] = resized_rgb

    tensor_hwc = canvas.astype(np.float32) / 255.0
    tensor_chw = np.transpose(tensor_hwc, (2, 0, 1))  # [3, 1024, 1024]
    tensor_nchw = np.expand_dims(tensor_chw, axis=0)  # [1, 3, 1024, 1024]

    tensor_bytes = tensor_nchw.tobytes()
    tensor_sha = compute_sha256(tensor_bytes)
    tensor_path = os.path.join(OUTPUT_DIR, "final_tensor_float32_nchw.bin")
    with open(tensor_path, "wb") as f:
        f.write(tensor_bytes)

    # 4. ONNX Runtime Execution (CPU)
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(MODEL_PATH, opts, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    raw_outputs = session.run([output_name], {input_name: tensor_nchw})
    raw_output_array = raw_outputs[0]  # Shape [1, 207, 21504], dtype float32

    raw_output_bytes = raw_output_array.tobytes()
    raw_output_sha = compute_sha256(raw_output_bytes)
    raw_output_path = os.path.join(OUTPUT_DIR, "raw_output_float32.bin")
    with open(raw_output_path, "wb") as f:
        f.write(raw_output_bytes)

    manifest = {
        "generator": "scripts/python/export_preprocessing_diagnostics.py",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "environment": {
            "pythonVersion": platform.python_version(),
            "onnxruntimeVersion": ort.__version__,
            "numpyVersion": np.__version__,
            "opencvVersion": cv2.__version__,
            "executionProvider": "CPUExecutionProvider",
            "platform": platform.platform(),
        },
        "model": {
            "path": MODEL_PATH,
            "sha256": model_file_sha,
        },
        "fixture": {
            "path": FIXTURE_PATH,
            "sha256": fixture_file_sha,
            "dimensions": [orig_w, orig_h],
        },
        "letterboxGeometry": {
            "scale": float(scale),
            "scaledWidth": scaled_w,
            "scaledHeight": scaled_h,
            "padX": pad_x,
            "padY": pad_y,
            "bottomPad": bottom_pad,
            "rightPad": right_pad,
            "padValue": 114,
        },
        "resizeOptions": {
            "library": "opencv",
            "interpolation": "cv2.INTER_LINEAR",
            "exactCall": f"cv2.resize(img_rgb, ({scaled_w}, {scaled_h}), interpolation=cv2.INTER_LINEAR)",
        },
        "artifacts": {
            "decodedRgb": {
                "file": "decoded_rgb_uint8.bin",
                "dtype": "uint8",
                "shape": list(img_rgb.shape),
                "byteLength": len(decoded_bytes),
                "sha256": decoded_sha,
            },
            "resizedRgb": {
                "file": "resized_rgb_uint8.bin",
                "dtype": "uint8",
                "shape": list(resized_rgb.shape),
                "byteLength": len(resized_bytes),
                "sha256": resized_sha,
            },
            "finalTensor": {
                "file": "final_tensor_float32_nchw.bin",
                "dtype": "float32",
                "layout": "NCHW",
                "byteOrder": "little-endian",
                "shape": list(tensor_nchw.shape),
                "byteLength": len(tensor_bytes),
                "sha256": tensor_sha,
            },
            "rawOutput": {
                "file": "raw_output_float32.bin",
                "dtype": "float32",
                "shape": list(raw_output_array.shape),
                "byteLength": len(raw_output_bytes),
                "sha256": raw_output_sha,
            },
        },
    }

    manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("✅ Python diagnostic artifacts exported successfully:")
    print(f"   Decoded RGB : {decoded_path} ({len(decoded_bytes)} B, SHA: {decoded_sha[:16]}...)")
    print(f"   Resized RGB : {resized_path} ({len(resized_bytes)} B, SHA: {resized_sha[:16]}...)")
    print(f"   Final Tensor: {tensor_path} ({len(tensor_bytes)} B, SHA: {tensor_sha[:16]}...)")
    print(f"   Raw Output  : {raw_output_path} ({len(raw_output_bytes)} B, SHA: {raw_output_sha[:16]}...)")
    print(f"   Manifest    : {manifest_path}")


if __name__ == "__main__":
    main()
