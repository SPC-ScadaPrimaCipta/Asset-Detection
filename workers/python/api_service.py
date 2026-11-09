"""
FastAPI HTTP Service: Wrapper untuk Python detection workers
Endpoint untuk TypeScript integration
"""
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import base64
import cv2
import numpy as np
from io import BytesIO
from PIL import Image

from detection_worker import DetectionWorker
from spatial_matcher_worker import SpatialMatcherWorker
from learning_worker import LearningWorker
from dxf_parser_worker import DxfParserWorker
from config import config

app = FastAPI(title="TagFlow Python Detection Service")

# CORS untuk TypeScript client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize workers (singleton) - lazy load untuk avoid startup failures
yolo_worker = None  # Loaded on first request

def get_yolo_worker():
    """Lazy load YOLO worker"""
    global yolo_worker
    if yolo_worker is None:
        yolo_worker = DetectionWorker(
            yolo_model_path=str(config.YOLO_MODEL_PATH),
            similarity_threshold=config.SIMILARITY_THRESHOLD,
            use_cuda=False
        )
    return yolo_worker

spatial_matcher = SpatialMatcherWorker(
    max_distance_threshold=200.0
)

learning_worker = LearningWorker()

# ============= Pydantic Models =============

class YOLODetectRequest(BaseModel):
    image_base64: str
    project_id: str
    conf_threshold: float = 0.25
    use_pgvector: bool = True
    use_ocr: bool = True

class BBox(BaseModel):
    x: int
    y: int
    width: int
    height: int

class Detection(BaseModel):
    bbox: BBox
    label: str
    confidence: float
    source: str
    similarity: Optional[float] = None
    original_yolo_class: Optional[str] = None

class YOLODetectResponse(BaseModel):
    detections: List[Detection]
    count: int

class SpatialMatchRequest(BaseModel):
    symbols: List[dict]  # [{id, bbox, label}]
    texts: List[dict]    # [{text, bbox}]
    circles: Optional[List[dict]] = None

class ApprovalRequest(BaseModel):
    detection_id: str
    project_id: str
    asset_tag: str
    asset_type: str
    symbol_category: str
    bbox_px: dict
    bbox_dxf: dict
    image_path: str
    confidence_original: float
    approved_by: Optional[str] = None

class DxfParseRequest(BaseModel):
    dxf_path: str

# ============= Endpoints =============

@app.get("/health")
async def health():
    """Health check"""
    return {"status": "ok", "service": "TagFlow Python Workers"}

@app.post("/yolo-detect", response_model=YOLODetectResponse)
async def yolo_detect(request: YOLODetectRequest):
    """
    YOLO detection dengan pgvector similarity boost
    """
    try:
        # Lazy load YOLO worker
        worker = get_yolo_worker()
        
        # Decode base64 image
        image_bytes = base64.b64decode(request.image_base64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(400, "Invalid image data")
        
        # Run detection
        detections = worker.detect(
            image=image,
            project_id=request.project_id,
            use_pgvector=request.use_pgvector,
            use_ocr=request.use_ocr
        )
        
        # Convert to response format
        response_detections = [
            Detection(
                bbox=BBox(**det['bbox']),
                label=det['label'],
                confidence=det['confidence'],
                source=det['source'],
                similarity=det.get('similarity'),
                original_yolo_class=det.get('original_yolo_class')
            )
            for det in detections
        ]
        
        return YOLODetectResponse(
            detections=response_detections,
            count=len(response_detections)
        )
        
    except Exception as e:
        raise HTTPException(500, f"Detection error: {str(e)}")

@app.post("/spatial-match")
async def spatial_match(request: SpatialMatchRequest):
    """
    Spatial matching: tag-to-symbol association
    """
    try:
        matches = spatial_matcher.match_tags_to_symbols(
            symbols=request.symbols,
            texts=request.texts,
            circles=request.circles
        )
        
        return {"matches": matches, "count": len(matches)}
        
    except Exception as e:
        raise HTTPException(500, f"Spatial matching error: {str(e)}")

@app.post("/learning/process-approval")
async def process_approval(request: ApprovalRequest):
    """
    Continuous learning: process approved detection
    """
    try:
        embedding_id = learning_worker.process_approved_detection(
            detection_id=request.detection_id,
            project_id=request.project_id,
            asset_tag=request.asset_tag,
            asset_type=request.asset_type,
            symbol_category=request.symbol_category,
            bbox_px=request.bbox_px,
            bbox_dxf=request.bbox_dxf,
            image_path=request.image_path,
            confidence_original=request.confidence_original,
            approved_by=request.approved_by
        )
        
        return {
            "success": True,
            "embedding_id": embedding_id,
            "message": "Detection learned successfully"
        }
        
    except Exception as e:
        raise HTTPException(500, f"Learning error: {str(e)}")

@app.post("/dxf/parse")
async def parse_dxf(request: DxfParseRequest):
    """
    Parse DXF dengan vertical text grouping
    """
    try:
        parser = DxfParserWorker(request.dxf_path)
        result = parser.parse()
        
        return {
            "success": True,
            "data": result
        }
        
    except Exception as e:
        raise HTTPException(500, f"DXF parsing error: {str(e)}")

# ============= Run Server =============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        log_level="info"
    )
