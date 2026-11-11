"""
Detection Worker: Multi-source hybrid detection
Priority: pgvector (legend match) > YOLO > OpenCV > OCR
"""
import cv2
import numpy as np
from typing import List, Dict, Optional, Tuple
from pathlib import Path
import torch
from ultralytics import YOLO

from utils.embedding import EmbeddingGenerator
from utils.pgvector_client import PgVectorClient
from utils.ocr_utils import OCREngine
from utils.nms import nms, merge_multi_source_detections
from config import config

class DetectionWorker:
    """
    Hybrid detection pipeline:
    1. YOLO detection (baseline)
    2. For each detection: crop → embed → pgvector similarity search
    3. If similarity > threshold: use pgvector label + boost confidence
    4. If no match: keep YOLO label
    5. OCR fallback untuk deteksi tanpa TEXT match
    """
    
    def __init__(
        self, 
        yolo_model_path: str = "model/yolo-pid.onnx",  # Support ONNX
        similarity_threshold: float = 0.88,
        use_cuda: bool = False
    ):
        # YOLO (support both .pt and .onnx)
        self.yolo = YOLO(yolo_model_path)
        self.yolo.conf = 0.25  # Base confidence threshold
        
        # Embedding & pgvector
        device = "cuda" if use_cuda and torch.cuda.is_available() else "cpu"
        self.embedding_gen = EmbeddingGenerator(device=device)
        self.pgvector = PgVectorClient(config.DATABASE_URL)
        self.similarity_threshold = similarity_threshold
        
        # OCR
        self.ocr = OCREngine()
    
    def detect(
        self, 
        image: np.ndarray,
        project_id: str,
        use_pgvector: bool = True,
        use_ocr: bool = True
    ) -> List[Dict]:
        """
        Run hybrid detection
        
        Args:
            image: Input image (BGR)
            project_id: Project ID untuk filter pgvector search
            use_pgvector: Enable pgvector similarity boost
            use_ocr: Enable OCR fallback
            
        Returns:
            List of detections:
            {
                'bbox': {x, y, width, height},
                'label': str,
                'confidence': float,
                'source': 'YOLO' | 'pgvector' | 'OCR',
                'similarity': float (jika source=pgvector),
                'original_yolo_class': str (jika source=pgvector)
            }
        """
        detections = []
        
        # 1. YOLO baseline
        results = self.yolo(image)[0]
        
        for det in results.boxes.data:
            x1, y1, x2, y2, conf, cls = det.cpu().numpy()
            
            bbox = {
                'x': int(x1),
                'y': int(y1),
                'width': int(x2 - x1),
                'height': int(y2 - y1)
            }
            
            yolo_class = results.names[int(cls)]
            
            # 2. pgvector similarity check
            if use_pgvector:
                pgvector_match = self._check_pgvector_similarity(
                    image, bbox, project_id
                )
                
                if pgvector_match:
                    # Override dengan pgvector label
                    detections.append({
                        'bbox': bbox,
                        'label': pgvector_match['asset_type'],
                        'confidence': min(0.99, float(conf) + pgvector_match['similarity'] * 0.2),  # Boost
                        'source': 'pgvector',
                        'similarity': pgvector_match['similarity'],
                        'original_yolo_class': yolo_class,
                        'training_id': pgvector_match.get('id')
                    })
                    continue
            
            # 3. Fallback: YOLO label
            detections.append({
                'bbox': bbox,
                'label': yolo_class,
                'confidence': float(conf),
                'source': 'YOLO'
            })
        
        # 4. OCR fallback (regions tidak detected)
        if use_ocr:
            ocr_detections = self._ocr_fallback(image, detections)
            detections.extend(ocr_detections)
        
        # 5. NMS deduplication
        detections = self._apply_nms(detections)
        
        return detections
    
    def _check_pgvector_similarity(
        self, 
        image: np.ndarray, 
        bbox: Dict[str, int],
        project_id: str
    ) -> Optional[Dict]:
        """
        Crop → embed → pgvector search
        
        Returns:
            None jika no match, dict dengan {asset_type, similarity, id} jika match
        """
        try:
            # Crop
            x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
            crop = image[y:y+h, x:x+w]
            
            if crop.size == 0:
                return None
            
            # Embed
            embedding = self.embedding_gen.generate_embedding(crop)
            
            # Search
            with self.pgvector:
                results = self.pgvector.search_similar_symbols(
                    query_embedding=embedding,
                    project_id=project_id,
                    threshold=self.similarity_threshold,
                    limit=1
                )
            
            if results:
                top = results[0]
                return {
                    'id': top['id'],
                    'asset_type': top['asset_type'],
                    'similarity': top['confidence']
                }
            
            return None
            
        except Exception as e:
            print(f"pgvector similarity check error: {e}")
            return None
    
    def _ocr_fallback(
        self, 
        image: np.ndarray, 
        existing_detections: List[Dict]
    ) -> List[Dict]:
        """
        OCR fallback untuk regions tidak ada YOLO detection
        Cari asset tags tanpa bounding box
        """
        ocr_detections = []
        
        try:
            tags = self.ocr.extract_tags_only(image)
            
            for tag_info in tags:
                # Check: apakah tag sudah ada di existing detections?
                already_detected = False
                for det in existing_detections:
                    det_bbox = det['bbox']
                    # Simple bbox overlap check
                    if self._bbox_overlap(det_bbox, tag_info['bbox']):
                        already_detected = True
                        break
                
                if not already_detected:
                    # Add as low-confidence OCR detection
                    ocr_detections.append({
                        'bbox': tag_info['bbox'],
                        'label': f"Tag-{tag_info['text']}",  # Generic tag label
                        'confidence': tag_info['confidence'] * 0.5,  # OCR confidence penalty
                        'source': 'OCR',
                        'text': tag_info['text']
                    })
        except Exception as e:
            print(f"OCR fallback error: {e}")
        
        return ocr_detections
    
    def _bbox_overlap(self, bbox1: Dict, bbox2: Dict) -> bool:
        """Check if two bboxes overlap"""
        x1_min, y1_min = bbox1['x'], bbox1['y']
        x1_max, y1_max = x1_min + bbox1['width'], y1_min + bbox1['height']
        
        x2_min, y2_min = bbox2['x'], bbox2['y']
        x2_max, y2_max = x2_min + bbox2['width'], y2_min + bbox2['height']
        
        return not (x1_max < x2_min or x2_max < x1_min or y1_max < y2_min or y2_max < y1_min)
    
    def _apply_nms(self, detections: List[Dict], iou_threshold: float = 0.5) -> List[Dict]:
        """Apply NMS untuk remove duplicates"""
        if not detections:
            return []
        
        # Convert to NMS format
        boxes = [
            {
                'bbox': det['bbox'],
                'score': det['confidence'],
                'class': det['label'],
                'source': det['source']
            }
            for det in detections
        ]
        
        kept = nms(boxes, iou_threshold=iou_threshold)
        
        # Rebuild detection list
        return [detections[i] for i in kept]
