"""
NMS (Non-Maximum Suppression): Remove duplicate/overlapping bounding boxes
Essential untuk merge detections dari multi-source (YOLO tiles, OpenCV, Legend)
"""
import numpy as np
from typing import List, Dict, Tuple

def compute_iou(bbox1: Dict[str, float], bbox2: Dict[str, float]) -> float:
    """
    Compute Intersection over Union (IoU) antara dua bounding boxes
    
    Args:
        bbox1, bbox2: Dict dengan keys {x, y, width, height} atau {x_min, y_min, x_max, y_max}
        
    Returns:
        IoU value antara 0 (no overlap) dan 1 (perfect overlap)
    """
    # Normalize ke format x_min, y_min, x_max, y_max
    if 'width' in bbox1:
        x1_min, y1_min = bbox1['x'], bbox1['y']
        x1_max = x1_min + bbox1['width']
        y1_max = y1_min + bbox1['height']
    else:
        x1_min, y1_min = bbox1['x_min'], bbox1['y_min']
        x1_max, y1_max = bbox1['x_max'], bbox1['y_max']
    
    if 'width' in bbox2:
        x2_min, y2_min = bbox2['x'], bbox2['y']
        x2_max = x2_min + bbox2['width']
        y2_max = y2_min + bbox2['height']
    else:
        x2_min, y2_min = bbox2['x_min'], bbox2['y_min']
        x2_max, y2_max = bbox2['x_max'], bbox2['y_max']
    
    # Intersection rectangle
    inter_x_min = max(x1_min, x2_min)
    inter_y_min = max(y1_min, y2_min)
    inter_x_max = min(x1_max, x2_max)
    inter_y_max = min(y1_max, y2_max)
    
    # Intersection area
    inter_width = max(0, inter_x_max - inter_x_min)
    inter_height = max(0, inter_y_max - inter_y_min)
    inter_area = inter_width * inter_height
    
    # Union area
    area1 = (x1_max - x1_min) * (y1_max - y1_min)
    area2 = (x2_max - x2_min) * (y2_max - y2_min)
    union_area = area1 + area2 - inter_area
    
    if union_area == 0:
        return 0.0
    
    return inter_area / union_area

def nms(
    detections: List[Dict],
    iou_threshold: float = 0.3,
    score_key: str = 'confidence'
) -> List[Dict]:
    """
    Non-Maximum Suppression untuk filter overlapping detections
    
    Args:
        detections: List of detection dicts, each with 'bbox' and score_key
        iou_threshold: IoU threshold untuk consider as duplicate (default 0.3)
        score_key: Key untuk confidence score ('confidence', 'score', dll)
        
    Returns:
        Filtered list of detections (high-confidence, non-overlapping)
    """
    if len(detections) == 0:
        return []
    
    # Sort by confidence descending
    sorted_dets = sorted(detections, key=lambda x: x.get(score_key, 0), reverse=True)
    
    keep = []
    suppressed = set()
    
    for i, det in enumerate(sorted_dets):
        if i in suppressed:
            continue
        
        keep.append(det)
        
        # Suppress semua detections berikutnya yang overlap signifikan
        for j in range(i + 1, len(sorted_dets)):
            if j in suppressed:
                continue
            
            iou = compute_iou(det['bbox'], sorted_dets[j]['bbox'])
            
            if iou > iou_threshold:
                suppressed.add(j)
    
    return keep

def merge_multi_source_detections(
    detections_by_source: Dict[str, List[Dict]],
    iou_threshold: float = 0.3,
    source_priority: List[str] = None
) -> List[Dict]:
    """
    Merge detections dari multiple sources (YOLO, OpenCV, Legend, OCR) dengan NMS
    
    Args:
        detections_by_source: Dict mapping source name → list of detections
        iou_threshold: IoU threshold untuk NMS
        source_priority: Priority order untuk prefer certain source when overlap
                        e.g., ['Legend', 'YOLO', 'OpenCV', 'OCR']
                        
    Returns:
        Merged list of detections dengan duplicate removed
    """
    if source_priority is None:
        source_priority = ['Legend', 'YOLO', 'OpenCV', 'OCR']
    
    # Flatten all detections dan add source info
    all_detections = []
    for source, dets in detections_by_source.items():
        for det in dets:
            det_copy = det.copy()
            det_copy['source'] = source
            all_detections.append(det_copy)
    
    if len(all_detections) == 0:
        return []
    
    # Sort by source priority first, then confidence
    priority_map = {src: idx for idx, src in enumerate(source_priority)}
    all_detections.sort(
        key=lambda x: (
            priority_map.get(x.get('source', 'Unknown'), 999),
            -x.get('confidence', 0)
        )
    )
    
    # Apply NMS
    merged = nms(all_detections, iou_threshold=iou_threshold)
    
    return merged

def bbox_contains_point(bbox: Dict[str, float], point: Tuple[float, float]) -> bool:
    """Check apakah point berada di dalam bbox"""
    x, y = point
    
    if 'width' in bbox:
        x_min, y_min = bbox['x'], bbox['y']
        x_max = x_min + bbox['width']
        y_max = y_min + bbox['height']
    else:
        x_min, y_min = bbox['x_min'], bbox['y_min']
        x_max, y_max = bbox['x_max'], bbox['y_max']
    
    return x_min <= x <= x_max and y_min <= y <= y_max
