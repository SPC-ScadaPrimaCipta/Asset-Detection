#!/usr/bin/env python3
"""
YOLO Equipment Detection Worker for DXF P&ID drawings.

Usage:
    python yolo_worker.py <image_path> [--model <model_path>] [--conf <threshold>]

Output:
    JSON array of detections: [{"class": "Pump", "bbox": [x,y,w,h], "confidence": 0.95}, ...]
"""

import sys
import json
import argparse
from pathlib import Path
from ultralytics import YOLO
import cv2
import numpy as np

# Default model path (will be trained and saved here)
DEFAULT_MODEL = Path(__file__).parent / "models" / "pid_equipment_v1.pt"
CONFIDENCE_THRESHOLD = 0.25  # Lower threshold, OCR + legend matching refines later

def detect_equipment(image_path: str, model_path: str = None, conf: float = CONFIDENCE_THRESHOLD):
    """
    Run YOLO detection on P&ID image.
    
    Returns:
        List[dict]: Detections with class, bbox, confidence
    """
    model_path = model_path or str(DEFAULT_MODEL)
    
    # Check if model exists
    if not Path(model_path).exists():
        # Use pretrained YOLO as fallback (generic object detection)
        print(f"[WARN] Custom model not found at {model_path}, using YOLOv8n pretrained", file=sys.stderr)
        model = YOLO("yolov8n.pt")  # Nano model for speed
    else:
        model = YOLO(model_path)
    
    # Load image
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Image not found: {image_path}")
    
    # Run inference
    results = model.predict(
        source=img,
        conf=conf,
        iou=0.5,  # NMS IoU threshold
        verbose=False,
        device='cpu'  # Change to 'cuda' if GPU available
    )
    
    # Parse results
    detections = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes
        
        for i in range(len(boxes)):
            box = boxes[i]
            # bbox in xyxy format → convert to xywh
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            x, y, w, h = x1, y1, x2 - x1, y2 - y1
            
            cls_id = int(box.cls[0].cpu().numpy())
            conf_score = float(box.conf[0].cpu().numpy())
            
            # Map class ID to name (will be custom classes after training)
            class_name = result.names[cls_id] if cls_id in result.names else f"class_{cls_id}"
            
            detections.append({
                "class": class_name,
                "bbox": [float(x), float(y), float(w), float(h)],
                "confidence": conf_score
            })
    
    return detections


def main():
    parser = argparse.ArgumentParser(description="YOLO P&ID equipment detector")
    parser.add_argument("image", help="Path to input image")
    parser.add_argument("--model", help=f"Path to YOLO model (default: {DEFAULT_MODEL})")
    parser.add_argument("--conf", type=float, default=CONFIDENCE_THRESHOLD, help="Confidence threshold")
    
    args = parser.parse_args()
    
    try:
        detections = detect_equipment(args.image, args.model, args.conf)
        print(json.dumps(detections, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
