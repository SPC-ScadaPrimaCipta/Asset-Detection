#!/usr/bin/env python3
"""
Independent Python YOLO v203 Reference Generator

Performs standalone inference on P&ID image fixtures using ONNX Runtime Python (CPUExecutionProvider)
to generate ground-truth cross-runtime parity references.

Pipeline:
  1. File integrity & SHA-256 calculation (model + fixtures)
  2. Independent Letterbox Preprocessing (OpenCV / PIL -> Float32 RGB / 255.0 NCHW [1, 3, 1024, 1024])
  3. ONNX Runtime Execution (CPUExecutionProvider only)
  4. Candidate Filtering (confidence >= threshold, single-label argmax across 203 classes at channel offset 4)
  5. Sorting (score descending, deterministic tie-breaking on anchor index)
  6. Class-Aware NMS (IoU >= threshold per class in letterbox space, prior to inverse transform)
  7. Max Detections Truncation (<= 300)
  8. Inverse Letterbox Transform to original pixel coordinates
  9. Boundary Clipping to [0, W] and [0, H]
  10. Invalid BBox Rejection (width < 1 or height < 1)
  11. Export full-precision JSON reference

Usage:
  python scripts/python/generate_reference_v203.py
  python scripts/python/generate_reference_v203.py --output fixtures/reference/yolo-v203-python-reference.json
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import platform
import sys
from typing import Any, Dict, List, Tuple

import cv2
import numpy as np
import onnxruntime as ort

EXPECTED_MODEL_SHA256 = "92f22175ade687a0f7e29617c3a3ae9cbf80266dda6df30d74fb9c3c95917e6c"
DEFAULT_MODEL_PATH = "model/yolo-pid-v8n-203.onnx"
DEFAULT_OUTPUT_PATH = "fixtures/reference/yolo-v203-python-reference.json"

DEFAULT_FIXTURES = {
    "square": "fixtures/Sheet_1-1__x0_y0.png",
    "nonSquareOddPadding": "fixtures/Sheet_1-1__non_square.png",
    "nonSquareResize": "fixtures/Sheet_1-1__crop_1600x1001.png",
}

SOURCE_FULLSHEET_PATH = "fixtures/pid-eval/sheet-1/page_1.png"


def compute_sha256(file_path: str) -> str:
    """Compute SHA-256 hex digest of a file."""
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def compute_iou(box_a: Tuple[float, float, float, float], box_b: Tuple[float, float, float, float]) -> float:
    """Compute Intersection-over-Union (IoU) between two [x1, y1, x2, y2] boxes."""
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])

    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(0.0, box_a[2] - box_a[0]) * max(0.0, box_a[3] - box_a[1])
    area_b = max(0.0, box_b[2] - box_b[0]) * max(0.0, box_b[3] - box_b[1])
    union = area_a + area_b - intersection

    if union <= 0.0:
        return 0.0
    return intersection / union


def preprocess_image(
    image_path: str, target_size: int = 1024
) -> Tuple[np.ndarray, Dict[str, Any], Tuple[int, int]]:
    """
    Perform letterbox preprocessing directly in Python.
    Preserves aspect ratio, fits into target_size x target_size canvas with fill value 114.
    """
    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise FileNotFoundError(f"Failed to read image at: {image_path}")

    orig_h, orig_w = img_bgr.shape[:2]

    scale = min(target_size / orig_w, target_size / orig_h)
    scaled_w = int(round(orig_w * scale))
    scaled_h = int(round(orig_h * scale))

    pad_x = (target_size - scaled_w) // 2
    pad_y = (target_size - scaled_h) // 2
    bottom_pad = target_size - scaled_h - pad_y
    right_pad = target_size - scaled_w - pad_x

    resized = cv2.resize(img_bgr, (scaled_w, scaled_h), interpolation=cv2.INTER_LINEAR)
    resized_rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    canvas = np.full((target_size, target_size, 3), 114, dtype=np.uint8)
    canvas[pad_y : pad_y + scaled_h, pad_x : pad_x + scaled_w] = resized_rgb

    # Normalize to Float32 [0.0, 1.0] and format to NCHW
    tensor = canvas.astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))  # [3, 1024, 1024]
    tensor = np.expand_dims(tensor, axis=0)  # [1, 3, 1024, 1024]

    letterbox_meta = {
        "scale": float(scale),
        "scaledWidth": scaled_w,
        "scaledHeight": scaled_h,
        "padX": pad_x,
        "padY": pad_y,
        "bottomPad": bottom_pad,
        "rightPad": right_pad,
    }

    return tensor, letterbox_meta, (orig_w, orig_h)


def run_inference_and_decode(
    session: ort.InferenceSession,
    input_tensor: np.ndarray,
    letterbox_meta: Dict[str, Any],
    orig_dims: Tuple[int, int],
    conf_threshold: float = 0.50,
    nms_iou_threshold: float = 0.70,
    max_detections: int = 300,
) -> List[Dict[str, Any]]:
    """
    Executes ONNX inference and applies the documented decoding + class-aware NMS pipeline.

    Order of operations:
      1. ONNX Model forward pass -> output0 tensor [1, 207, 21504]
      2. Candidate extraction (cx, cy, w, h, best_class = argmax(scores[4..206]), best_score)
      3. Threshold filtering (score >= conf_threshold)
      4. Sorting (score descending, anchor_index ascending for deterministic tie-breaking)
      5. Class-aware NMS in letterbox space (IoU >= nms_iou_threshold)
      6. Max detections truncation (limit to max_detections)
      7. Inverse letterbox transform to original pixel coordinates
      8. Boundary clipping to [0, W] and [0, H]
      9. Invalid box rejection (width < 1 or height < 1)
    """
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    raw_outputs = session.run([output_name], {input_name: input_tensor})
    output_data = raw_outputs[0]  # Shape: [1, 207, 21504]

    if output_data.shape != (1, 207, 21504):
        raise ValueError(f"Unexpected output shape: {output_data.shape}, expected (1, 207, 21504)")

    orig_w, orig_h = orig_dims
    scale = letterbox_meta["scale"]
    pad_x = letterbox_meta["padX"]
    pad_y = letterbox_meta["padY"]

    candidates = []

    # Step 1 & 2: Extract candidate boxes and class argmax
    for i in range(21504):
        cx = float(output_data[0, 0, i])
        cy = float(output_data[0, 1, i])
        w = float(output_data[0, 2, i])
        h = float(output_data[0, 3, i])

        class_scores = output_data[0, 4:207, i]
        best_class_id = int(np.argmax(class_scores))
        best_score = float(class_scores[best_class_id])

        # Step 3: Confidence threshold filter
        if best_score < conf_threshold:
            continue

        # Box in letterbox coordinate space [1024 x 1024]
        lx1 = cx - w / 2.0
        ly1 = cy - h / 2.0
        lx2 = cx + w / 2.0
        ly2 = cy + h / 2.0

        candidates.append({
            "anchor_index": i,
            "raw_class_id": best_class_id,
            "score": best_score,
            "letterbox_box": (lx1, ly1, lx2, ly2),
        })

    # Step 4: Sorting by score descending, with deterministic tie-breaking on anchor_index
    candidates.sort(key=lambda c: (-c["score"], c["anchor_index"]))

    # Step 5: Class-aware NMS in letterbox space
    candidates_by_class: Dict[int, List[Dict[str, Any]]] = {}
    for c in candidates:
        cid = c["raw_class_id"]
        if cid not in candidates_by_class:
            candidates_by_class[cid] = []
        candidates_by_class[cid].append(c)

    nms_kept: List[Dict[str, Any]] = []
    for cid, class_candidates in candidates_by_class.items():
        kept_for_class: List[Dict[str, Any]] = []
        for cand in class_candidates:
            suppress = False
            for kept in kept_for_class:
                iou = compute_iou(cand["letterbox_box"], kept["letterbox_box"])
                if iou >= nms_iou_threshold:
                    suppress = True
                    break
            if not suppress:
                kept_for_class.append(cand)
        nms_kept.extend(kept_for_class)

    # Step 6: Max detections truncation
    nms_kept.sort(key=lambda c: (-c["score"], c["anchor_index"]))
    if len(nms_kept) > max_detections:
        nms_kept = nms_kept[:max_detections]

    # Step 7, 8, 9: Inverse transform, clipping, and invalid box rejection
    final_detections: List[Dict[str, Any]] = []
    for item in nms_kept:
        lx1, ly1, lx2, ly2 = item["letterbox_box"]

        # Inverse transform to original image pixel coordinates
        sx1 = (lx1 - pad_x) / scale
        sy1 = (ly1 - pad_y) / scale
        sx2 = (lx2 - pad_x) / scale
        sy2 = (ly2 - pad_y) / scale

        # Boundary clipping to [0, W] and [0, H]
        x1 = max(0.0, min(float(orig_w), sx1))
        y1 = max(0.0, min(float(orig_h), sy1))
        x2 = max(0.0, min(float(orig_w), sx2))
        y2 = max(0.0, min(float(orig_h), sy2))

        # Rejection of degenerate boxes
        if (x2 - x1) < 1.0 or (y2 - y1) < 1.0:
            continue

        # Verify finite numbers
        if not all(math.isfinite(v) for v in [x1, y1, x2, y2, item["score"]]):
            continue

        final_detections.append({
            "rawClassId": item["raw_class_id"],
            "score": float(item["score"]),
            "bbox": [float(x1), float(y1), float(x2), float(y2)],
        })

    return final_detections


def main():
    parser = argparse.ArgumentParser(description="Generate Python Ground-Truth Reference for YOLO v203")
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH, help="Path to yolo-pid-v8n-203.onnx")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH, help="Path for generated JSON reference")
    parser.add_argument("--conf", type=float, default=0.50, help="Confidence threshold")
    parser.add_argument("--iou", type=float, default=0.70, help="NMS IoU threshold")
    parser.add_argument("--max-det", type=int, default=300, help="Max detections")
    args = parser.parse_args()

    print("🚀 Running YOLO v203 Python Reference Generator")
    print(f"   Model  : {args.model}")
    print(f"   Output : {args.output}")

    if not os.path.exists(args.model):
        print(f"❌ Error: Model file not found at: {args.model}")
        sys.exit(1)

    model_sha = compute_sha256(args.model)
    print(f"   Model SHA-256: {model_sha}")

    # Initialize ONNX Runtime with CPUExecutionProvider only
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(args.model, opts, providers=["CPUExecutionProvider"])
    actual_providers = session.get_providers()
    print(f"   Execution Providers: {actual_providers}")

    # Inspect source fullsheet if present
    source_fullsheet_info = None
    if os.path.exists(SOURCE_FULLSHEET_PATH):
        src_sha = compute_sha256(SOURCE_FULLSHEET_PATH)
        src_img = cv2.imread(SOURCE_FULLSHEET_PATH)
        src_h, src_w = src_img.shape[:2] if src_img is not None else (0, 0)
        source_fullsheet_info = {
            "sourceFile": SOURCE_FULLSHEET_PATH,
            "sourceDimensions": [src_w, src_h],
            "sourceSha256": src_sha,
            "cropBox": [0, 0, 1600, 1001],
        }

    results_data: Dict[str, Any] = {
        "metadata": {
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "environment": {
                "pythonVersion": platform.python_version(),
                "onnxruntimeVersion": ort.__version__,
                "numpyVersion": np.__version__,
                "opencvVersion": cv2.__version__,
                "executionProvider": "CPUExecutionProvider",
                "platform": platform.platform(),
            },
            "model": {
                "filename": os.path.basename(args.model),
                "sha256": model_sha,
            },
            "config": {
                "imgsz": 1024,
                "rect": False,
                "confidenceThreshold": args.conf,
                "nmsIouThreshold": args.iou,
                "maxDetections": args.max_det,
                "classAware": True,
                "labelAssignment": "single-label-argmax",
                "dtype": "float32",
            },
        },
        "fixtures": {},
    }

    for fix_key, fix_path in DEFAULT_FIXTURES.items():
        if not os.path.exists(fix_path):
            print(f"❌ Error: Fixture not found at: {fix_path}")
            sys.exit(1)

        fix_sha = compute_sha256(fix_path)
        tensor, letterbox_meta, orig_dims = preprocess_image(fix_path, target_size=1024)
        detections = run_inference_and_decode(
            session=session,
            input_tensor=tensor,
            letterbox_meta=letterbox_meta,
            orig_dims=orig_dims,
            conf_threshold=args.conf,
            nms_iou_threshold=args.iou,
            max_detections=args.max_det,
        )

        fixture_entry: Dict[str, Any] = {
            "filename": os.path.basename(fix_path),
            "dimensions": [orig_dims[0], orig_dims[1]],
            "sha256": fix_sha,
            "letterbox": letterbox_meta,
            "detections": detections,
        }

        if fix_key == "nonSquareResize" and source_fullsheet_info is not None:
            fixture_entry["sourceCrop"] = source_fullsheet_info

        results_data["fixtures"][fix_key] = fixture_entry
        print(f"✅ Processed {fix_key} ({fix_path}): {len(detections)} detections, SHA-256={fix_sha}")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results_data, f, indent=2)

    print(f"\n✨ Reference JSON successfully written to: {args.output}")


if __name__ == "__main__":
    main()
