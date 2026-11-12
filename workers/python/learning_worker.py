"""
Learning Worker: Continuous learning dari approved detections
Crop → Embed → pgvector → YOLO format
"""
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, Optional
import uuid
from utils.embedding import EmbeddingGenerator
from utils.pgvector_client import PgVectorClient
from config import config

class LearningWorker:
    """
    Process approved detections:
    1. Crop BBox dari image
    2. Generate visual embedding
    3. Save ke storage/approved/
    4. Insert ke pgvector DB
    5. Generate YOLO label (optional untuk future retraining)
    """
    
    def __init__(self):
        self.embedding_gen = EmbeddingGenerator(device="cpu")  # CPU safe untuk bg worker
        self.pgvector = PgVectorClient(config.DATABASE_URL)
    
    def process_approved_detection(
        self,
        detection_id: str,
        project_id: str,
        asset_tag: str,
        asset_type: str,
        symbol_category: str,
        bbox_px: Dict[str, int],  # {x, y, width, height}
        bbox_dxf: Dict[str, float],  # {x_min, y_min, x_max, y_max}
        image_path: str,  # Path ke source image
        confidence_original: float,
        approved_by: Optional[str] = None
    ) -> str:
        """
        Process satu approved detection
        
        Returns:
            UUID dari inserted training embedding
        """
        # 1. Load image dan crop BBox
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Cannot load image: {image_path}")
        
        x, y, w, h = bbox_px['x'], bbox_px['y'], bbox_px['width'], bbox_px['height']
        
        # Clamp to image bounds
        h_img, w_img = image.shape[:2]
        x = max(0, min(x, w_img - 1))
        y = max(0, min(y, h_img - 1))
        w = min(w, w_img - x)
        h = min(h, h_img - y)
        
        crop = image[y:y+h, x:x+w]
        
        if crop.size == 0:
            raise ValueError(f"Empty crop for detection {detection_id}")
        
        # 2. Generate embedding
        embedding = self.embedding_gen.generate_embedding(crop)
        
        # 3. Save crop ke storage/approved/
        crop_filename = f"{asset_tag}_{uuid.uuid4().hex[:8]}.png"
        crop_dir = config.APPROVED_PATH / symbol_category.lower().replace(' ', '_')
        crop_dir.mkdir(parents=True, exist_ok=True)
        crop_path = crop_dir / crop_filename
        
        cv2.imwrite(str(crop_path), crop)
        
        # 4. Insert ke pgvector
        with self.pgvector:
            inserted_id = self.pgvector.insert_training_embedding(
                project_id=project_id,
                detection_id=detection_id,
                asset_tag=asset_tag,
                asset_type=asset_type,
                symbol_category=symbol_category,
                crop_path=str(crop_path),
                embedding=embedding,
                bbox_dxf=bbox_dxf,
                bbox_px=bbox_px,
                confidence_original=confidence_original,
                approved_by=approved_by
            )
        
        # 5. Generate YOLO label (optional)
        self._save_yolo_label(crop_path, bbox_px, asset_type)
        
        return inserted_id
    
    def _save_yolo_label(
        self, 
        image_path: Path, 
        bbox: Dict[str, int],
        class_name: str
    ):
        """
        Save YOLO format label untuk future training
        Format: <class_id> <x_center> <y_center> <width> <height> (normalized 0-1)
        """
        # Hardcoded class mapping (sesuaikan dengan YOLO model classes)
        class_map = {
            'Tank': 0,
            'Vessel': 0,
            'Pump': 1,
            'Valve': 2,
            'Instrument': 3,
            'Fitting': 4
        }
        
        class_id = class_map.get(class_name, 99)  # 99 = unknown
        
        # Normalize bbox
        img_h, img_w = bbox['height'], bbox['width']  # Crop dimensions
        x_center = 0.5  # Center of crop
        y_center = 0.5
        w_norm = 1.0    # Full crop width
        h_norm = 1.0    # Full crop height
        
        label_path = image_path.with_suffix('.txt')
        with open(label_path, 'w') as f:
            f.write(f"{class_id} {x_center} {y_center} {w_norm} {h_norm}\n")
    
    def batch_process(self, approved_detections: list) -> Dict[str, str]:
        """
        Process batch approved detections
        
        Args:
            approved_detections: List of detection dicts
            
        Returns:
            Dict mapping detection_id → inserted_embedding_id
        """
        results = {}
        
        for det in approved_detections:
            try:
                emb_id = self.process_approved_detection(
                    detection_id=det['detection_id'],
                    project_id=det['project_id'],
                    asset_tag=det['asset_tag'],
                    asset_type=det['asset_type'],
                    symbol_category=det['symbol_category'],
                    bbox_px=det['bbox_px'],
                    bbox_dxf=det['bbox_dxf'],
                    image_path=det['image_path'],
                    confidence_original=det['confidence'],
                    approved_by=det.get('approved_by')
                )
                results[det['detection_id']] = emb_id
            except Exception as e:
                print(f"Error processing {det['detection_id']}: {e}")
                results[det['detection_id']] = f"ERROR: {str(e)}"
        
        return results
