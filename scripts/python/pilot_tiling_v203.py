#!/usr/bin/env python3
"""
Independent Python YOLO v203 Native-Resolution Tiling & Global Merge Reference Generator

Executes standalone tiling inference on full-sheet P&ID image (3573x2526)
using identical zero-resize grid logic and class-aware global merge.

Output: fixtures/reference/yolo-v203-tiling-python-reference.json
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

MODEL_PATH = "model/yolo-pid-v8n-203.onnx"
IMAGE_PATH = "fixtures/pid-eval/sheet-1/page_1.png"
DEFAULT_OUTPUT_PATH = "fixtures/reference/yolo-v203-tiling-python-reference-v2-cap300.json"
GENERATOR_PATH = "scripts/python/pilot_tiling_v203.py"

TILE_SIZE = 1024
TILE_STRIDE = 819
PAD_VALUE = 114
CONF_THRESHOLD = 0.50
PER_TILE_NMS_IOU = 0.70
PER_TILE_MAX_DET = 300
GLOBAL_MERGE_IOU = 0.50


def compute_file_sha256(file_path: str) -> str:
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def compute_bytes_sha256(buf: bytes) -> str:
    return hashlib.sha256(buf).hexdigest()


def cap_tile_detections(detections: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    detections = sorted(
        detections,
        key=lambda c: (
            -c["score"], c["rawClassId"], c["bbox"][1], c["bbox"][0],
            c["bbox"][3], c["bbox"][2], c["anchor"],
        ),
    )
    return detections[:PER_TILE_MAX_DET], len(detections)


def generate_axis_offsets(dimension: int, tile_size: int = TILE_SIZE, stride: int = TILE_STRIDE) -> List[int]:
    if dimension <= 0 or dimension <= tile_size:
        return [0]

    offsets = [0]
    curr = 0
    while curr + stride + tile_size <= dimension:
        curr += stride
        offsets.append(curr)

    last_offset = dimension - tile_size
    if last_offset > 0:
        offsets.append(last_offset)

    return sorted(list(set(offsets)))


def compute_box_iou(box_a: List[float], box_b: List[float]) -> float:
    inter_x1 = max(box_a[0], box_b[0])
    inter_y1 = max(box_a[1], box_b[1])
    inter_x2 = min(box_a[2], box_b[2])
    inter_y2 = min(box_a[3], box_b[3])

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    if inter_area <= 0.0:
        return 0.0

    area_a = max(0.0, box_a[2] - box_a[0]) * max(0.0, box_a[3] - box_a[1])
    area_b = max(0.0, box_b[2] - box_b[0]) * max(0.0, box_b[3] - box_b[1])
    union_area = area_a + area_b - inter_area

    return inter_area / union_area if union_area > 0 else 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args()
    output_path = args.output
    print("[INFO] Running Python YOLO v203 Native-Resolution Tiling Generator...")

    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
    if not os.path.exists(IMAGE_PATH):
        raise FileNotFoundError(f"Image not found: {IMAGE_PATH}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    model_sha = compute_file_sha256(MODEL_PATH)
    image_sha = compute_file_sha256(IMAGE_PATH)

    # 1. Decode Full Page Image (BGR -> RGB)
    img_bgr = cv2.imread(IMAGE_PATH)
    if img_bgr is None:
        raise ValueError(f"cv2.imread failed on {IMAGE_PATH}")
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    page_h, page_w = img_rgb.shape[:2]
    decoded_rgb_bytes = img_rgb.tobytes()
    decoded_rgb_sha = compute_bytes_sha256(decoded_rgb_bytes)

    print(f"[INFO] Full Sheet Image: {IMAGE_PATH} ({page_w}x{page_h}, Decoded SHA: {decoded_rgb_sha[:16]}...)")

    # 2. Build Grid
    x_offsets = generate_axis_offsets(page_w, TILE_SIZE, TILE_STRIDE)
    y_offsets = generate_axis_offsets(page_h, TILE_SIZE, TILE_STRIDE)

    tiles_info = []
    tile_index = 0
    for r_idx, y in enumerate(y_offsets):
        for c_idx, x in enumerate(x_offsets):
            valid_w = max(0, min(TILE_SIZE, page_w - x))
            valid_h = max(0, min(TILE_SIZE, page_h - y))
            has_padding = valid_w < TILE_SIZE or valid_h < TILE_SIZE
            tiles_info.append({
                "tileIndex": tile_index,
                "colIndex": c_idx,
                "rowIndex": r_idx,
                "x": x,
                "y": y,
                "width": TILE_SIZE,
                "height": TILE_SIZE,
                "validWidth": valid_w,
                "validHeight": valid_h,
                "hasPadding": has_padding,
            })
            tile_index += 1

    print(f"[INFO] Generated Tile Grid: {len(x_offsets)} cols x {len(y_offsets)} rows = {len(tiles_info)} total tiles.")
    print(f"   X Offsets: {x_offsets}")
    print(f"   Y Offsets: {y_offsets}")

    # 3. Initialize ONNX Runtime Session (CPU)
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(MODEL_PATH, opts, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    # 4. Sequential Per-Tile Inference
    all_tile_results = []
    global_candidates = []

    for tile in tiles_info:
        t_idx = tile["tileIndex"]
        tx = tile["x"]
        ty = tile["y"]
        vw = tile["validWidth"]
        vh = tile["validHeight"]

        # Zero-resize slice
        canvas = np.full((TILE_SIZE, TILE_SIZE, 3), PAD_VALUE, dtype=np.uint8)
        canvas[0:vh, 0:vw] = img_rgb[ty : ty + vh, tx : tx + vw]

        tensor_hwc = canvas.astype(np.float32) / 255.0
        tensor_chw = np.transpose(tensor_hwc, (2, 0, 1))  # [3, 1024, 1024]
        tensor_nchw = np.expand_dims(tensor_chw, axis=0)  # [1, 3, 1024, 1024]
        tensor_bytes = tensor_nchw.tobytes()
        tensor_sha = compute_bytes_sha256(tensor_bytes)

        # Run ONNX inference
        raw_outputs = session.run([output_name], {input_name: tensor_nchw})
        output_array = raw_outputs[0]  # [1, 207, 21504]
        raw_output_sha = compute_bytes_sha256(output_array.tobytes())

        # Decode candidates
        cands_tile = []
        for i in range(21504):
            cx = float(output_array[0, 0, i])
            cy = float(output_array[0, 1, i])
            w = float(output_array[0, 2, i])
            h = float(output_array[0, 3, i])

            scores = output_array[0, 4:207, i]
            best_class = int(np.argmax(scores))
            best_score = float(scores[best_class])

            if best_score >= CONF_THRESHOLD:
                x1 = cx - w / 2.0
                y1 = cy - h / 2.0
                x2 = cx + w / 2.0
                y2 = cy + h / 2.0
                if (x2 - x1) >= 1.0 and (y2 - y1) >= 1.0:
                    cands_tile.append({
                        "anchor": i,
                        "rawClassId": best_class,
                        "score": best_score,
                        "bbox": [x1, y1, x2, y2],
                    })

        # Sort score descending, anchor ascending
        cands_tile.sort(key=lambda c: (-c["score"], c["anchor"]))

        # Class-aware NMS per tile
        kept_tile_dets = []
        classes_in_tile = sorted(set(c["rawClassId"] for c in cands_tile))
        for cls_id in classes_in_tile:
            cls_cands = [c for c in cands_tile if c["rawClassId"] == cls_id]
            suppressed = [False] * len(cls_cands)
            for a_idx in range(len(cls_cands)):
                if suppressed[a_idx]:
                    continue
                active = cls_cands[a_idx]
                kept_tile_dets.append(active)
                for b_idx in range(a_idx + 1, len(cls_cands)):
                    if suppressed[b_idx]:
                        continue
                    iou = compute_box_iou(active["bbox"], cls_cands[b_idx]["bbox"])
                    if iou >= PER_TILE_NMS_IOU:
                        suppressed[b_idx] = True

        # Apply the per-tile cap after NMS, before page mapping.
        kept_tile_dets, tile_detections_before_cap = cap_tile_detections(kept_tile_dets)

        # Map to page coordinates & reject padding
        tile_page_dets = []
        for d_idx, det in enumerate(kept_tile_dets):
            bx1, by1, bx2, by2 = det["bbox"]

            # Reject if box starts entirely inside padding
            if bx1 >= vw or by1 >= vh:
                continue

            clamped_x1 = max(0.0, min(float(vw), bx1))
            clamped_y1 = max(0.0, min(float(vh), by1))
            clamped_x2 = max(0.0, min(float(vw), bx2))
            clamped_y2 = max(0.0, min(float(vh), by2))

            if (clamped_x2 - clamped_x1) < 1.0 or (clamped_y2 - clamped_y1) < 1.0:
                continue

            page_x1 = max(0.0, min(float(page_w), clamped_x1 + tx))
            page_y1 = max(0.0, min(float(page_h), clamped_y1 + ty))
            page_x2 = max(0.0, min(float(page_w), clamped_x2 + tx))
            page_y2 = max(0.0, min(float(page_h), clamped_y2 + ty))

            page_det = {
                "rawClassId": det["rawClassId"],
                "confidence": det["score"],
                "tileIndex": t_idx,
                "detectionIndex": d_idx,
                "tileBox": [bx1, by1, bx2, by2],
                "pageBox": [page_x1, page_y1, page_x2, page_y2],
            }
            tile_page_dets.append(page_det)
            global_candidates.append(page_det)

        all_tile_results.append({
            "tile": tile,
            "inputTensorSha256": tensor_sha,
            "rawOutputSha256": raw_output_sha,
            "tileDetectionsBeforeCap": tile_detections_before_cap,
            "tileDetectionsCount": len(kept_tile_dets),
            "pageDetectionsCount": len(tile_page_dets),
            "detections": tile_page_dets,
        })

    print(f"[INFO] Completed {len(tiles_info)} tiles inference. Total candidates before global merge: {len(global_candidates)}")

    # 5. Class-Aware Global Merge
    distinct_classes = sorted(set(c["rawClassId"] for c in global_candidates))
    global_kept = []
    global_suppressed = []

    for cls_id in distinct_classes:
        cls_cands = [c for c in global_candidates if c["rawClassId"] == cls_id]

        # Multi-level deterministic tie-breaking
        cls_cands.sort(key=lambda c: (-c["confidence"], c["tileIndex"], c["detectionIndex"]))

        suppressed = [False] * len(cls_cands)
        for i in range(len(cls_cands)):
            if suppressed[i]:
                continue
            active = cls_cands[i]
            global_kept.append(active)
            for j in range(i + 1, len(cls_cands)):
                if suppressed[j]:
                    continue
                neighbor = cls_cands[j]
                iou = compute_box_iou(active["pageBox"], neighbor["pageBox"])
                if iou >= GLOBAL_MERGE_IOU:
                    suppressed[j] = True
                    global_suppressed.append({
                        "suppressedCandidateId": f"{neighbor['rawClassId']}:{neighbor['tileIndex']}:{neighbor['detectionIndex']}",
                        "suppressorCandidateId": f"{active['rawClassId']}:{active['tileIndex']}:{active['detectionIndex']}",
                        "rawClassId": cls_id,
                        "iou": iou,
                        "reason": "same_class_iou_at_or_above_threshold",
                        "candidate": neighbor,
                        "suppressedBy": active,
                    })

    # Final deterministic sort
    global_kept.sort(key=lambda c: (-c["confidence"], c["rawClassId"], c["pageBox"][1], c["pageBox"][0]))

    print(f"[INFO] Global Merge Complete: {len(global_candidates)} candidates -> {len(global_kept)} final kept detections ({len(global_suppressed)} suppressed).")

    # 6. Save Reference JSON
    reference_data = {
        "metadata": {
            "title": "YOLO v203 Native-Resolution Tiling & Global Merge Reference",
            "referenceSchemaVersion": 2,
            "referenceVersion": "v2-cap300",
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "generator": {
                "path": GENERATOR_PATH,
                "sha256": compute_file_sha256(GENERATOR_PATH),
                "command": "python -I scripts/python/pilot_tiling_v203.py --output <path>",
            },
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
                "sha256": model_sha,
            },
            "sourceImage": {
                "path": IMAGE_PATH,
                "dimensions": [page_w, page_h],
                "fileSha256": image_sha,
                "decodedRgbSha256": decoded_rgb_sha,
            },
            "tilingConfig": {
                "tileSize": TILE_SIZE,
                "stride": TILE_STRIDE,
                "padValue": PAD_VALUE,
                "xOffsets": x_offsets,
                "yOffsets": y_offsets,
                "totalTiles": len(tiles_info),
            },
            "detectionConfig": {
                "confidenceThreshold": CONF_THRESHOLD,
                "perTileNmsIouThreshold": PER_TILE_NMS_IOU,
                "perTileMaxDetections": PER_TILE_MAX_DET,
                "globalMergeIouThreshold": GLOBAL_MERGE_IOU,
                "perTileMaxDetectionsStage": "post-class-aware-nms-pre-page-mapping",
                "perTileSortOrder": ["confidence-desc", "rawClassId-asc", "bbox-y1-asc", "bbox-x1-asc", "bbox-y2-asc", "bbox-x2-asc", "anchor-asc"],
                "decoderOutput": "[1,207,21504] channel-major; channels 0-3 bbox, 4-206 class confidence",
            },
        },
        "tiles": all_tile_results,
        "globalMerge": {
            "totalBeforeMerge": len(global_candidates),
            "totalAfterMerge": len(global_kept),
            "totalSuppressed": len(global_suppressed),
            "keptDetections": global_kept,
            "suppressedDetections": global_suppressed,
        },
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(reference_data, f, indent=2)

    print(f"[OK] Reference successfully written to: {output_path}")


if __name__ == "__main__":
    main()
