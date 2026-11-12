"""
Configuration module untuk Python workers
Baca environment variables dan setup paths
"""
import os
from pathlib import Path
from typing import Optional
try:
    from pydantic_settings import BaseSettings
except ImportError:
    from pydantic import BaseSettings  # Fallback Pydantic v1

class Config(BaseSettings):
    """Configuration with extra fields allowed for .env.local compatibility"""
    model_config = {
        'extra': 'ignore',  # Allow extra env vars without validation error
        'env_file': '.env.local',
        'env_file_encoding': 'utf-8'
    }
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://postgres:password@localhost:5432/asset_detection"
    )
    
    # Storage paths (relative to project root)
    PROJECT_ROOT: Path = Path(__file__).parent.parent.parent
    STORAGE_PATH: Path = PROJECT_ROOT / "storage"
    LEGENDS_PATH: Path = STORAGE_PATH / "legends" / "symbols"
    APPROVED_PATH: Path = STORAGE_PATH / "approved"
    RENDERS_PATH: Path = STORAGE_PATH / "renders"
    MODELS_PATH: Path = PROJECT_ROOT / "model"  # Changed to 'model' folder
    
    # YOLO Model (support ONNX)
    YOLO_MODEL_PATH: Path = MODELS_PATH / "yolo-pid.onnx"  # Use existing ONNX model
    
    # Embedding Model
    EMBEDDING_MODEL: str = "ViT-B/32"  # CLIP model
    EMBEDDING_DIM: int = 512
    
    # OCR
    TESSERACT_CMD: Optional[str] = os.getenv("TESSERACT_CMD")  # Path to tesseract binary
    OCR_LANG: str = "eng"
    
    # Detection thresholds
    SIMILARITY_THRESHOLD: float = 0.88  # pgvector cosine similarity
    NMS_IOU_THRESHOLD: float = 0.3
    CONFIDENCE_THRESHOLD: float = 0.5
    
    # Tiling config
    TILE_SIZE: int = 1024
    TILE_OVERLAP: float = 0.2

# Global config instance
config = Config()

# Ensure directories exist
for path in [config.APPROVED_PATH, config.RENDERS_PATH]:
    path.mkdir(parents=True, exist_ok=True)
